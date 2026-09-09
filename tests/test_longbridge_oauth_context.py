"""OAuth 与现有 SDK context、配置响应之间的回归测试。"""

from unittest.mock import MagicMock, patch

from app.api.config import _readiness_checks, _settings_to_response
from app.config import Settings
from app.core.market.longbridge_context import credential_signature, longbridge_config
from app.core.watchlist.service import LongbridgeUnavailableError
from app.schemas.config import ConfigUpdate


def test_oauth_configuration_uses_sdk_handle_and_preserves_endpoints_and_language():
    from longbridge.openapi import Language

    settings = Settings(
        longbridge_auth_mode="oauth",
        longbridge_oauth_client_id="client-a",
        app_language="en",
        longbridge_http_url="https://openapi.longbridge.com",
    )
    handle = object()
    with (
        patch("app.core.market.longbridge_oauth.get_oauth", return_value=handle),
        patch("longbridge.openapi.Config") as config,
    ):
        longbridge_config(settings)
        config.from_oauth.assert_called_once_with(
            handle,
            http_url="https://openapi.longbridge.com",
            quote_ws_url=None,
            language=Language.EN,
        )
        config.from_apikey.assert_not_called()
        config.from_apikey_env.assert_not_called()


def test_oauth_does_not_fall_back_to_a_different_apikey_account():
    import pytest

    settings = Settings(
        longbridge_auth_mode="oauth",
        longbridge_app_key="legacy-key",
        longbridge_app_secret="legacy-secret",
        longbridge_access_token="legacy-token",
    )
    with (
        patch(
            "app.core.market.longbridge_oauth.get_oauth",
            side_effect=LongbridgeUnavailableError("please authorize"),
        ),
        patch("longbridge.openapi.Config") as config,
    ):
        with pytest.raises(LongbridgeUnavailableError):
            longbridge_config(settings)
        config.from_apikey.assert_not_called()
        config.from_apikey_env.assert_not_called()


def test_oauth_account_and_mode_partition_context_cache():
    first = Settings(longbridge_auth_mode="oauth", longbridge_oauth_client_id="client-a")
    second = first.model_copy(update={"longbridge_oauth_client_id": "client-b"})
    legacy = first.model_copy(update={"longbridge_auth_mode": "apikey"})
    assert (
        len(
            {
                credential_signature(first),
                credential_signature(second),
                credential_signature(legacy),
            }
        )
        == 3
    )


def test_readiness_honors_selected_authentication_and_response_hides_inherited_id():
    settings = Settings(longbridge_auth_mode="oauth", longbridge_oauth_client_id="shared-client")
    with patch("app.api.config.oauth_connected", return_value=True):
        assert next(
            check for check in _readiness_checks(settings) if check.component == "longbridge"
        ).configured
        own = _settings_to_response(settings)
        inherited = _settings_to_response(settings, hide_inherited_personal=True)
    assert own.longbridge_oauth_connected
    assert own.longbridge_oauth_client_id == "shared-client"
    assert inherited.longbridge_auth_mode == "oauth"
    assert inherited.longbridge_oauth_client_id == ""
    assert not inherited.longbridge_oauth_connected
    assert "longbridge_oauth_client_id" not in ConfigUpdate.model_fields


def test_readiness_does_not_treat_legacy_keys_as_an_oauth_connection():
    settings = Settings(
        longbridge_auth_mode="oauth",
        longbridge_app_key="key",
        longbridge_app_secret="secret",
        longbridge_access_token="token",
    )
    with patch("app.api.config.oauth_connected", return_value=False):
        assert not next(
            check for check in _readiness_checks(settings) if check.component == "longbridge"
        ).configured


def test_personal_credentials_do_not_silently_switch_to_a_system_oauth_account():
    import app.config as config_module

    store = MagicMock()
    store.get_config.return_value = {
        "longbridge_auth_mode": "oauth",
        "longbridge_oauth_client_id": "system-client",
    }
    cases = [
        ({}, "oauth", "system-client"),
        ({"longbridge_app_key": "personal-legacy"}, "apikey", ""),
        ({"longbridge_auth_mode": "oauth"}, "oauth", ""),
        (
            {"longbridge_auth_mode": "oauth", "longbridge_oauth_client_id": "personal-client"},
            "oauth",
            "personal-client",
        ),
    ]
    try:
        with patch("app.core.app_store.get_app_store", return_value=store):
            for personal, mode, client_id in cases:
                config_module.clear_effective_settings_cache()
                store.get_user_config.return_value = personal
                effective = config_module.get_effective_config("alice")
                assert effective["longbridge_auth_mode"] == mode
                assert effective["longbridge_oauth_client_id"] == client_id
    finally:
        config_module.clear_effective_settings_cache()
