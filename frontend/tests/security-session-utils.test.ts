import assert from "node:assert/strict";
import { test } from "node:test";

import { deviceInfo, hasValidLogin, sessionKey } from "../src/components/security/session-utils";
import type { LoginRecord, LoginSession } from "../src/types/app";

const NOW = Date.parse("2026-09-09T12:00:00Z");
const PAST = "2026-09-08T12:00:00Z";
const FUTURE = "2026-09-10T12:00:00Z";

function login(overrides: Partial<LoginRecord> = {}): LoginRecord {
  return {
    id: "login-1", device_id: "browser-1", user_id: "user-1", username: "trader", display_name: "",
    created_at: PAST, last_seen_at: PAST, expires_at: FUTURE, revoked_at: null,
    user_agent: "", ip_address: "127.0.0.1", last_ip_address: "127.0.0.1", session_count: 1,
    active_refresh_tokens: 0, is_current: false, is_active: false, is_online: false,
    ...overrides,
  };
}

test("an offline login remains revocable without a refresh token or activity flag", () => {
  assert.equal(hasValidLogin(login(), NOW), true);
});

test("revocation and expiration override stale active or online flags", () => {
  const staleActivity = { is_active: true, is_online: true, active_refresh_tokens: 1 };
  assert.equal(hasValidLogin(login({ ...staleActivity, revoked_at: PAST }), NOW), false);
  assert.equal(hasValidLogin(login({ ...staleActivity, expires_at: PAST }), NOW), false);
  assert.equal(hasValidLogin(login({ ...staleActivity, expires_at: "invalid-date" }), NOW), false);
  assert.equal(hasValidLogin(login({ expires_at: "2026-09-09T20:00:00+08:00" }), NOW), false);
  assert.equal(hasValidLogin(login({ expires_at: "2026-09-09T20:00:01+08:00" }), NOW), true);
});

test("a device remains valid when an older login survives an expired representative", () => {
  const device: LoginSession = {
    ...login({ expires_at: PAST, revoked_at: PAST }),
    records: [login({ revoked_at: PAST }), login({ expires_at: PAST }), login({ id: "surviving-login" })],
  };
  assert.equal(hasValidLogin(device, NOW), true);
});

test("actual device records take precedence over a stale valid device summary", () => {
  const device: LoginSession = {
    ...login({ is_active: true }),
    records: [login({ revoked_at: PAST }), login({ expires_at: PAST })],
  };
  assert.equal(hasValidLogin(device, NOW), false);
});

test("a device without detailed records falls back to its own validity", () => {
  assert.equal(hasValidLogin(login(), NOW), true);
  assert.equal(hasValidLogin({ ...login(), records: [] }, NOW), true);
  assert.equal(hasValidLogin({ ...login({ revoked_at: PAST }), records: [] }, NOW), false);
  assert.equal(hasValidLogin({ ...login({ expires_at: PAST }), records: [] }, NOW), false);
});

test("iOS browser identifiers win over the shared macOS and Safari UA tokens", () => {
  const prefix = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
  for (const [token, browser] of [["Version/18.0", "Safari"], ["CriOS/140.0", "Chrome"], ["FxiOS/140.0", "Firefox"], ["EdgiOS/140.0", "Edge"]]) {
    const info = deviceInfo(`${prefix} ${token} Mobile/15E148 Safari/604.1`, "Unknown device");
    assert.deepEqual(info, { name: `${browser} · iOS`, os: "iOS", browser, kind: "phone" });
  }
  const ipad = deviceInfo("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1", "Unknown device");
  assert.deepEqual(ipad, { name: "Safari · iPadOS", os: "iPadOS", browser: "Safari", kind: "tablet" });
});

test("Android tablet and Edge are not mislabeled by their shared Chrome identifiers", () => {
  const tablet = deviceInfo("Mozilla/5.0 (Linux; Android 15; Tablet) Chrome/140.0 Safari/537.36 SamsungBrowser/28.0", "Unknown device");
  assert.deepEqual(tablet, { name: "Samsung Internet · Android", os: "Android", browser: "Samsung Internet", kind: "tablet" });
  const edge = deviceInfo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36 Edg/140.0", "Unknown device");
  assert.deepEqual(edge, { name: "Edge · Windows", os: "Windows", browser: "Edge", kind: "desktop" });
  assert.equal(deviceInfo("unrecognized-client", "未知设备").name, "未知设备");
});

test("identical device identifiers remain distinct across user accounts", () => {
  assert.notEqual(sessionKey(login({ user_id: "alice" })), sessionKey(login({ user_id: "bob" })));
  assert.equal(sessionKey(login()), sessionKey(login({ last_seen_at: FUTURE })));
});
