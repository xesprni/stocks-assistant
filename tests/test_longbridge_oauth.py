import asyncio
import json
import stat
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
from fastapi import FastAPI
from httpx import AsyncClient as ASGIClient

from app.core.market import longbridge_oauth as oauth_module
from app.core.security import CurrentUser, get_current_user
from app.core.watchlist.service import LongbridgeUnavailableError
from app.schemas.config import ConfigUpdate


def actor(user_id, *, admin=False):
    return CurrentUser(
        id=user_id,
        username=user_id,
        display_name=user_id,
        roles=("admin",) if admin else ("user",),
        permissions=frozenset({"*"} if admin else {"config:read"}),
        is_active=True,
    )


def token_data(stored_client_id, **overrides):
    return {
        "client_id": stored_client_id,
        "access_token": "private-access-token",
        "refresh_token": "private-refresh-token",
        "expires_at": time.time() + 3600,
        **overrides,
    }


def write_token(requested_client_id, **overrides):
    path = oauth_module._token_path(requested_client_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(token_data(requested_client_id, **overrides)), encoding="utf-8")
    return path


class FakeStore:
    def __init__(self, db_path, users):
        self.db_path = db_path
        self.system = {}
        self.personal = {}
        self.users = {
            user.id: {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
                "roles": list(user.roles),
                "permissions": list(user.permissions),
                "is_active": True,
            }
            for user in users
        }
        self.audits = []

    def get_config(self):
        return dict(self.system)

    def get_user_config(self, user_id):
        return dict(self.personal.get(user_id, {}))

    def set_config_values(self, values):
        self.system.update(values)

    def set_user_config_values(self, user_id, values):
        self.personal.setdefault(user_id, {}).update(values)

    def get_user(self, user_id):
        return self.users.get(user_id)

    def audit(self, *args):
        self.audits.append(args)


class FakeSocket:
    next_port = 41000

    def __enter__(self):
        self.port = type(self).next_port
        type(self).next_port += 1
        return self

    def __exit__(self, *_args):
        return False

    def bind(self, address):
        if address != ("127.0.0.1", 0):
            raise AssertionError(address)

    def getsockname(self):
        return ("127.0.0.1", self.port)


class FakeOAuthRuntime:
    """模拟 SDK URL 回调及授权结果，测试从不注册远程 OAuth 客户端。"""

    def __init__(self):
        self.registrations = []
        self.builders = []
        self.pending = {}
        self.handles = {}
        self.cancelled = set()
        self.registration_error = None
        self.next_client_id = None
        self.restore_mode = False
        self.restore_opens_browser = False
        self.callback_errors = []
        runtime = self

        class Builder:
            def __init__(self, client_id, callback_port=None):
                self.client_id = client_id
                self.port = callback_port or 60355
                runtime.builders.append((client_id, callback_port))

            async def build_async(self, on_open_url):
                if runtime.restore_mode and not runtime.restore_opens_browser:
                    return runtime.handles.setdefault(self.client_id, object())
                future = asyncio.get_running_loop().create_future()
                runtime.pending[self.client_id] = (future, self.port)
                on_open_url(
                    "https://openapi.longbridge.com/oauth2/authorize?"
                    + urlencode(
                        {
                            "client_id": self.client_id,
                            "redirect_uri": f"http://localhost:{self.port}/callback",
                            "state": "opaque-sdk-state",
                        }
                    )
                )
                try:
                    return await future
                except asyncio.CancelledError:
                    runtime.cancelled.add(self.client_id)
                    raise

        class AsyncClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, url, *, json):
                runtime.registrations.append((url, json))
                if runtime.registration_error:
                    raise runtime.registration_error
                client_id = (
                    runtime.next_client_id or f"registered-client-{len(runtime.registrations)}"
                )
                return httpx.Response(
                    201,
                    json={"client_id": client_id},
                    request=httpx.Request("POST", url),
                )

            async def get(self, url, **kwargs):
                query = parse_qs(urlparse(url).query)
                params = kwargs.get("params", {})
                error = params.get("error") or query.get("error", [None])[0]
                if not error:
                    raise AssertionError("Cancellation must use an OAuth error callback")
                port = urlparse(url).port
                runtime.callback_errors.append((port, error))
                for future, callback_port in runtime.pending.values():
                    if callback_port == port and not future.done():
                        future.set_exception(RuntimeError("OAuth authorization denied"))
                return httpx.Response(400, request=httpx.Request("GET", url))

        self.Builder = Builder
        self.AsyncClient = AsyncClient

    def complete(self, client_id):
        write_token(client_id)
        handle = self.handles.setdefault(client_id, object())
        self.pending[client_id][0].set_result(handle)
        return handle

    def fail(self, client_id, message):
        self.pending[client_id][0].set_exception(RuntimeError(message))


class LongbridgeOAuthTokenTest(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.home = self.directory / "home"
        self.home.mkdir()
        self.stack.enter_context(patch.object(Path, "home", return_value=self.home))
        self.stack.enter_context(patch.object(oauth_module, "_handles", {}))
        self.stack.enter_context(patch.object(oauth_module, "_restorations", {}))
        self.stack.enter_context(patch.object(oauth_module, "_revoked_clients", set()))
        self.stack.enter_context(
            patch.object(oauth_module, "socket", SimpleNamespace(socket=FakeSocket))
        )

    def test_reservation_is_private_and_does_not_overwrite_existing_credentials(self):
        client_id = "registered-client-1"
        oauth_module._reserve_token(client_id)
        path = oauth_module._token_path(client_id)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
        self.assertEqual(path.read_bytes(), b"")
        path.write_bytes(b"existing-credentials")
        with self.assertRaises((FileExistsError, LongbridgeUnavailableError)):
            oauth_module._reserve_token(client_id)
        self.assertEqual(path.read_bytes(), b"existing-credentials")

    def test_untrusted_client_ids_cannot_choose_a_token_path(self):
        for client_id in ("../outside", "/tmp/credentials", "a/bbbbbbbb", "", "short", "x" * 129):
            with self.subTest(client_id=client_id), self.assertRaises(LongbridgeUnavailableError):
                oauth_module._reserve_token(client_id)

    def test_reservation_rejects_symlink_in_every_cache_directory(self):
        for component in (".longbridge", ".longbridge/openapi", ".longbridge/openapi/tokens"):
            with (
                self.subTest(component=component),
                tempfile.TemporaryDirectory(dir=self.directory) as directory,
            ):
                test_home = Path(directory) / "home"
                test_home.mkdir()
                external = Path(directory) / "external"
                external.mkdir()
                link = test_home / component
                link.parent.mkdir(parents=True, exist_ok=True)
                link.symlink_to(external, target_is_directory=True)
                with (
                    patch.object(Path, "home", return_value=test_home),
                    self.assertRaises(LongbridgeUnavailableError),
                ):
                    oauth_module._reserve_token("registered-client-1")
                self.assertEqual(list(external.iterdir()), [])

    def test_read_and_disconnect_do_not_follow_ancestor_symlinks(self):
        for component in (".longbridge", ".longbridge/openapi", ".longbridge/openapi/tokens"):
            with (
                self.subTest(component=component),
                tempfile.TemporaryDirectory(dir=self.directory) as directory,
            ):
                test_home = Path(directory) / "home"
                test_home.mkdir()
                external = Path(directory) / "external"
                external.mkdir()
                link = test_home / component
                link.parent.mkdir(parents=True, exist_ok=True)
                link.symlink_to(external, target_is_directory=True)
                with patch.object(Path, "home", return_value=test_home):
                    path = write_token("registered-client-1")
                    path.chmod(0o644)
                    expected = path.read_bytes()
                    self.assertEqual(oauth_module._read_token("registered-client-1"), {})
                    oauth_module._forget_client("registered-client-1")
                    self.assertTrue(path.exists())
                    self.assertEqual(path.read_bytes(), expected)
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)

    def test_token_file_symlink_is_neither_read_nor_deleted(self):
        client_id = "registered-client-1"
        path = oauth_module._token_path(client_id)
        path.parent.mkdir(parents=True)
        external = self.directory / "external-token"
        external.write_text(json.dumps(token_data(client_id)), encoding="utf-8")
        path.symlink_to(external)
        self.assertEqual(oauth_module._read_token(client_id), {})
        oauth_module._forget_client(client_id)
        self.assertTrue(path.is_symlink())
        self.assertTrue(external.exists())

    def test_connection_requires_matching_usable_token(self):
        client_id = "registered-client-1"
        settings = SimpleNamespace(longbridge_oauth_client_id=client_id)
        path = write_token(client_id)
        path.chmod(0o644)
        self.assertTrue(oauth_module.oauth_connected(settings))
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
        for values in (
            {"client_id": "other-client"},
            {"access_token": ""},
            {"expires_at": time.time() - 10, "refresh_token": None},
            {"expires_at": "invalid-time", "refresh_token": None},
        ):
            with self.subTest(values=values):
                write_token(client_id, **values)
                self.assertFalse(oauth_module.oauth_connected(settings))
        write_token(client_id, expires_at=time.time() - 10)
        self.assertTrue(oauth_module.oauth_connected(settings))
        for invalid in ("", "not-json", "[]", "x" * (64 * 1024 + 1)):
            path.write_text(invalid, encoding="utf-8")
            self.assertFalse(oauth_module.oauth_connected(settings))

    def test_client_id_is_not_a_writable_configuration_field(self):
        update = ConfigUpdate.model_validate(
            {
                "longbridge_auth_mode": "oauth",
                "longbridge_oauth_client_id": "another-users-client",
                "longbridge_oauth_connected": True,
            }
        )
        self.assertEqual(update.model_dump(exclude_unset=True), {"longbridge_auth_mode": "oauth"})

    def test_get_oauth_restores_once_and_never_uses_another_client_handle(self):
        runtime = FakeOAuthRuntime()
        runtime.restore_mode = True
        first = "registered-client-first"
        second = "registered-client-second"
        write_token(first)
        write_token(second)
        with patch("longbridge.openapi.OAuthBuilder", runtime.Builder):
            first_settings = SimpleNamespace(longbridge_oauth_client_id=first)
            handle = oauth_module.get_oauth(first_settings)
            self.assertIs(oauth_module.get_oauth(first_settings), handle)
            other = oauth_module.get_oauth(SimpleNamespace(longbridge_oauth_client_id=second))
        self.assertIsNot(handle, other)
        self.assertEqual([entry[0] for entry in runtime.builders], [first, second])

    def test_get_oauth_without_usable_cache_does_not_start_sdk(self):
        with (
            patch("longbridge.openapi.OAuthBuilder") as builder,
            self.assertRaises(LongbridgeUnavailableError),
        ):
            oauth_module.get_oauth(
                SimpleNamespace(longbridge_oauth_client_id="registered-client-1")
            )
        builder.assert_not_called()

    def test_simultaneous_requests_share_one_restore(self):
        client_id = "registered-client-concurrent"
        write_token(client_id)
        settings = SimpleNamespace(longbridge_oauth_client_id=client_id)
        handle = object()
        started = threading.Barrier(8)

        async def restore(_client_id):
            await asyncio.sleep(0.04)
            return handle

        def request():
            started.wait(timeout=2)
            return oauth_module.get_oauth(settings)

        with (
            patch.object(oauth_module, "_restore_oauth", side_effect=restore) as restore_call,
            ThreadPoolExecutor(max_workers=8) as executor,
        ):
            results = list(executor.map(lambda _: request(), range(8)))
        self.assertTrue(all(result is handle for result in results))
        self.assertEqual(restore_call.call_count, 1)
        self.assertNotIn(client_id, oauth_module._restorations)

    def test_refresh_finishing_after_disconnect_cannot_restore_credentials(self):
        client_id = "registered-client-disconnecting"
        write_token(client_id)
        settings = SimpleNamespace(longbridge_oauth_client_id=client_id)
        started = threading.Event()
        release = threading.Event()

        async def refresh(_client_id):
            started.set()
            await asyncio.to_thread(release.wait, 2)
            # 模拟 Rust SDK 在收到刷新响应之后重新覆盖缓存文件。
            write_token(client_id)
            return object()

        with (
            patch.object(oauth_module, "_restore_oauth", side_effect=refresh),
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            request = executor.submit(oauth_module.get_oauth, settings)
            self.assertTrue(started.wait(timeout=2))
            oauth_module._forget_client(client_id)
            release.set()
            with self.assertRaises(LongbridgeUnavailableError):
                request.result(timeout=2)
        self.assertNotIn(client_id, oauth_module._handles)
        self.assertNotIn(client_id, oauth_module._restorations)
        self.assertFalse(oauth_module._token_path(client_id).exists())

    def test_restore_that_needs_browser_auth_ends_callback_without_cancelling_sdk(self):
        client_id = "registered-client-restore"
        write_token(client_id, expires_at=time.time() - 60)
        runtime = FakeOAuthRuntime()
        runtime.restore_mode = True
        runtime.restore_opens_browser = True
        with (
            patch("longbridge.openapi.OAuthBuilder", runtime.Builder),
            patch.object(oauth_module.httpx, "AsyncClient", runtime.AsyncClient),
        ):
            started = time.monotonic()
            with self.assertRaises(LongbridgeUnavailableError):
                oauth_module.get_oauth(SimpleNamespace(longbridge_oauth_client_id=client_id))
        self.assertLess(time.monotonic() - started, 2)
        self.assertTrue(runtime.callback_errors)
        self.assertEqual(runtime.cancelled, set())
        self.assertNotIn(client_id, oauth_module._handles)
        self.assertNotIn(client_id, oauth_module._restorations)


class LongbridgeOAuthServiceTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.home = self.directory / "home"
        self.home.mkdir()
        self.admin = actor("admin-user", admin=True)
        self.alice = actor("alice-user")
        self.bob = actor("bob-user")
        self.store = FakeStore(self.directory / "app.db", [self.admin, self.alice, self.bob])
        self.runtime = FakeOAuthRuntime()
        self.service = oauth_module.LongbridgeOAuthService()
        self.stack.enter_context(patch.object(Path, "home", return_value=self.home))
        self.stack.enter_context(
            patch.object(oauth_module, "get_app_store", return_value=self.store)
        )
        self.stack.enter_context(patch.object(oauth_module, "_handles", {}))
        self.stack.enter_context(patch.object(oauth_module, "_restorations", {}))
        self.stack.enter_context(patch.object(oauth_module, "_revoked_clients", set()))
        self.stack.enter_context(patch.object(oauth_module, "_refresh_caches"))
        self.stack.enter_context(
            patch(
                "app.config.get_effective_settings",
                side_effect=lambda user_id: SimpleNamespace(
                    longbridge_auth_mode=self.store.personal.get(user_id, {}).get(
                        "longbridge_auth_mode",
                        self.store.system.get("longbridge_auth_mode", "apikey"),
                    )
                ),
            )
        )
        # 只替换业务模块的 socket 名称，不能影响 asyncio 的事件循环 socketpair。
        self.stack.enter_context(
            patch.object(oauth_module, "socket", SimpleNamespace(socket=FakeSocket))
        )
        self.stack.enter_context(
            patch.object(oauth_module.httpx, "AsyncClient", self.runtime.AsyncClient)
        )
        self.stack.enter_context(patch("longbridge.openapi.OAuthBuilder", self.runtime.Builder))

    async def asyncTearDown(self):
        tasks = [
            session.task
            for session in self.service._sessions.values()
            if session.task and not session.task.done()
        ]
        for future, _port in self.runtime.pending.values():
            if not future.done():
                future.set_exception(RuntimeError("test cleanup"))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def finish(self, current):
        session = self.service._sessions[self.service._key(current)]
        self.runtime.complete(session.client_id)
        await asyncio.wait_for(asyncio.shield(session.task), 2)
        return self.service.status(current)

    async def test_authorization_is_isolated_between_system_and_personal_scopes(self):
        for user in (self.admin, self.alice, self.bob):
            status = await self.service.start(user)
            self.assertEqual(status.status, "pending")
            self.assertEqual(status.scope, "system" if user is self.admin else "personal")
        self.assertEqual(len(self.runtime.registrations), 3)
        self.assertEqual(self.store.system, {})
        self.assertEqual(self.store.personal, {})
        statuses = [await self.finish(user) for user in (self.admin, self.alice, self.bob)]
        self.assertTrue(all(status.status == "connected" for status in statuses))
        client_ids = [status.client_id for status in statuses]
        self.assertEqual(len(set(client_ids)), 3)
        self.assertEqual(self.store.system["longbridge_oauth_client_id"], client_ids[0])
        self.assertEqual(
            self.store.personal[self.alice.id]["longbridge_oauth_client_id"], client_ids[1]
        )
        self.assertEqual(
            self.store.personal[self.bob.id]["longbridge_oauth_client_id"], client_ids[2]
        )
        for (url, payload), status in zip(self.runtime.registrations, statuses, strict=True):
            self.assertEqual(url, oauth_module.REGISTER_URL)
            self.assertEqual(payload["grant_types"], ["authorization_code", "refresh_token"])
            self.assertNotIn("client_id", payload)
            self.assertNotIn("private-access-token", status.model_dump_json())
            self.assertNotIn("private-refresh-token", status.model_dump_json())

    async def test_repeated_start_reuses_pending_authorization(self):
        first, second = await asyncio.gather(
            self.service.start(self.alice), self.service.start(self.alice)
        )
        self.assertEqual(first.authorization_url, second.authorization_url)
        self.assertEqual(len(self.runtime.registrations), 1)
        self.assertEqual(len(self.runtime.builders), 1)
        self.assertEqual((await self.finish(self.alice)).status, "connected")

    async def test_registration_cannot_reuse_existing_sdk_credentials(self):
        client_id = "already-owned-client"
        path = write_token(client_id)
        original = path.read_bytes()
        self.runtime.next_client_id = client_id
        status = await self.service.start(self.alice)
        self.assertEqual(status.status, "error")
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(self.runtime.builders, [])
        self.assertEqual(self.store.personal, {})

    async def test_failed_authorization_preserves_previous_account_and_redacts_errors(self):
        previous = "previous-client-id"
        previous_path = write_token(previous)
        self.store.personal[self.alice.id] = {
            "longbridge_auth_mode": "oauth",
            "longbridge_oauth_client_id": previous,
        }
        await self.service.start(self.alice)
        session = self.service._sessions[self.service._key(self.alice)]
        with self.assertLogs(oauth_module.logger, level="WARNING") as logs:
            self.runtime.fail(
                session.client_id, "secret-access-token https://example.test/?code=secret-code"
            )
            await session.task
        status = self.service.status(self.alice)
        self.assertEqual(status.status, "error")
        self.assertEqual(self.store.personal[self.alice.id]["longbridge_oauth_client_id"], previous)
        self.assertTrue(previous_path.exists())
        self.assertFalse(oauth_module._token_path(session.client_id).exists())
        self.assertNotIn("secret-access-token", status.model_dump_json() + str(logs.output))
        self.assertNotIn("secret-code", status.model_dump_json() + str(logs.output))

    async def test_successful_reauthorization_removes_only_the_replaced_account(self):
        previous = "previous-client-id"
        other = "other-users-client"
        previous_path = write_token(previous)
        other_path = write_token(other)
        oauth_module._handles[previous] = object()
        oauth_module._handles[other] = object()
        self.store.personal[self.alice.id] = {"longbridge_oauth_client_id": previous}
        self.store.personal[self.bob.id] = {"longbridge_oauth_client_id": other}
        await self.service.start(self.alice)
        status = await self.finish(self.alice)
        self.assertEqual(status.status, "connected")
        self.assertFalse(previous_path.exists())
        self.assertNotIn(previous, oauth_module._handles)
        self.assertTrue(other_path.exists())
        self.assertIn(other, oauth_module._handles)

    async def test_disabled_user_cannot_commit_authorization(self):
        await self.service.start(self.alice)
        session = self.service._sessions[self.service._key(self.alice)]
        self.store.users[self.alice.id]["is_active"] = False
        self.assertEqual((await self.finish(self.alice)).status, "error")
        self.assertEqual(self.store.personal, {})
        self.assertFalse(oauth_module._token_path(session.client_id).exists())

    async def test_revoked_admin_permission_cannot_commit_system_authorization(self):
        await self.service.start(self.admin)
        self.store.users[self.admin.id]["roles"] = ["user"]
        self.store.users[self.admin.id]["permissions"] = ["config:read"]
        self.assertEqual((await self.finish(self.admin)).status, "error")
        self.assertEqual(self.store.system, {})

    async def test_disconnect_removes_only_the_current_scope(self):
        await self.service.start(self.admin)
        system = (await self.finish(self.admin)).client_id
        await self.service.start(self.alice)
        personal = (await self.finish(self.alice)).client_id
        status = await self.service.disconnect(self.alice)
        self.assertEqual(status.status, "disconnected")
        self.assertEqual(status.auth_mode, "oauth")
        self.assertFalse(oauth_module._token_path(personal).exists())
        self.assertNotIn(personal, oauth_module._handles)
        self.assertTrue(oauth_module._token_path(system).exists())
        self.assertIn(system, oauth_module._handles)
        self.assertEqual(self.service.status(self.admin).status, "connected")

    async def test_disconnect_pending_authorization_finishes_sdk_error_callback(self):
        await self.service.start(self.alice)
        session = self.service._sessions[self.service._key(self.alice)]
        status = await asyncio.wait_for(self.service.disconnect(self.alice), 2)
        self.assertEqual(status.status, "disconnected")
        self.assertTrue(session.task.done())
        self.assertTrue(self.runtime.callback_errors)
        self.assertEqual(self.runtime.cancelled, set())
        self.assertFalse(oauth_module._token_path(session.client_id).exists())
        self.assertEqual(self.store.personal, {})

    async def test_cancel_pending_authorization_preserves_previous_connection(self):
        previous = "previous-client-id"
        previous_path = write_token(previous)
        original = {"longbridge_auth_mode": "oauth", "longbridge_oauth_client_id": previous}
        self.store.personal[self.alice.id] = dict(original)
        await self.service.start(self.alice)
        status = await self.service.disconnect(self.alice)
        self.assertEqual(status.status, "connected")
        self.assertEqual(self.store.personal[self.alice.id], original)
        self.assertTrue(previous_path.exists())

    async def test_disconnect_without_oauth_does_not_disable_api_key(self):
        original = {"longbridge_auth_mode": "apikey", "longbridge_app_key": "configured-key"}
        self.store.personal[self.alice.id] = dict(original)
        await self.service.disconnect(self.alice)
        self.assertEqual(self.store.personal[self.alice.id], original)

    async def test_oauth_api_enforces_permissions_and_hides_other_users_authorization(self):
        import app.api.config as config_api

        app = FastAPI()
        app.include_router(config_api.router, prefix="/config")
        selected = {"current": actor("forbidden-user")}
        selected["current"] = CurrentUser(
            id="forbidden-user",
            username="forbidden",
            display_name="Forbidden",
            roles=(),
            permissions=frozenset(),
            is_active=True,
        )
        app.dependency_overrides[get_current_user] = lambda: selected["current"]
        with patch.object(config_api, "longbridge_oauth_service", self.service):
            async with ASGIClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                forbidden = await client.post("/config/longbridge/oauth/start")
                self.assertEqual(forbidden.status_code, 403)
                self.assertEqual(self.runtime.registrations, [])
                selected["current"] = self.alice
                started = await client.post(
                    "/config/longbridge/oauth/start",
                    json={"client_id": "another-users-client", "scope": "system"},
                )
                self.assertEqual(started.status_code, 200, started.text)
                self.assertEqual(started.json()["scope"], "personal")
                self.assertEqual(self.runtime.builders[0][0], "registered-client-1")
                selected["current"] = self.bob
                hidden = await client.get("/config/longbridge/oauth/status")
                self.assertEqual(hidden.status_code, 200, hidden.text)
                self.assertEqual(hidden.json()["status"], "disconnected")
                self.assertIsNone(hidden.json()["authorization_url"])
                self.assertEqual(hidden.json()["client_id"], "")
                await self.finish(self.alice)
                selected["current"] = self.alice
                connected = await client.get("/config/longbridge/oauth/status")
                self.assertEqual(connected.json()["status"], "connected")
                self.assertNotIn("private-access-token", connected.text)
                self.assertNotIn("private-refresh-token", connected.text)


if __name__ == "__main__":
    unittest.main()
