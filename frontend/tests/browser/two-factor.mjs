// Real auth/settings components in StrictMode; all network traffic uses fixtures.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import jsQR from "jsqr";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const compiled = await build({
  entryPoints: [new URL("./two-factor-fixture.tsx", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"development"' },
  tsconfig: new URL("../../tsconfig.app.json", import.meta.url).pathname,
});
const assets = new URL("../../dist/assets/", import.meta.url);
const css = (await Promise.all((await readdir(assets)).filter((file) => file.endsWith(".css")).map((file) => readFile(new URL(file, assets), "utf8")))).join("\n");
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
page.setDefaultTimeout(10000);
const errors = [], calls = [];
page.on("pageerror", (error) => errors.push(error.message));
const origin = "http://127.0.0.1:4183";
const user = { id: "fixture", username: "fixture", display_name: "Fixture", roles: ["admin"], permissions: ["*"], is_active: true, two_factor_enabled: true };
const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const replacementSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const recovery = "ABCD-EF01-2345-6789";
let password = "Password123!";
let provisioningUri = "";
let setupCount = 0;
await page.route("**/*", async (route) => {
  const req = route.request(), url = new URL(req.url());
  assert.equal(url.origin, origin, "No external requests");
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>' });
  if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
  if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "application/javascript", body: compiled.outputFiles[0].text });
  const payload = req.postData() ? req.postDataJSON() : null;
  calls.push({ path: url.pathname, payload });
  if (url.pathname.endsWith("/setup/status")) return json({ setup_required: false });
  if (url.pathname.endsWith("/device/heartbeat")) return json({ status: "ok" });
  if (url.pathname === "/api/v1/auth/me") return json(user);
  if (url.pathname.endsWith("/login")) {
    if (payload.password !== password) return json({ detail: "Invalid username or password" }, 401);
    if (user.two_factor_enabled && !payload.two_factor_code) return json({ detail: "Two-factor code required" }, 400);
    if (user.two_factor_enabled && !["123456", recovery].includes(payload.two_factor_code)) return json({ detail: "Invalid or already used two-factor code" }, 400);
    return json({ access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 900, user });
  }
  if (url.pathname.endsWith("/me/password")) {
    assert.equal(payload.current_password, password);
    if (payload.two_factor_code !== "123456") return json({ detail: "Invalid or already used two-factor code" }, 400);
    password = payload.new_password;
    return json({ status: "ok" });
  }
  if (url.pathname.endsWith("/two-factor/disable")) {
    assert.equal(payload.current_password, password);
    assert.equal(payload.code, recovery);
    user.two_factor_enabled = false;
    return json({ status: "ok" });
  }
  if (url.pathname.endsWith("/two-factor/setup")) {
    assert.equal(payload.current_password, password);
    const setupSecret = setupCount++ === 0 ? secret : replacementSecret;
    provisioningUri = `otpauth://totp/Stocks%20Assistant%3Afixture?secret=${setupSecret}&issuer=Stocks+Assistant&algorithm=SHA1&digits=6&period=30`;
    return json({ secret: setupSecret, provisioning_uri: provisioningUri, expires_at: Math.floor(Date.now() / 1000) + 600 });
  }
  if (url.pathname.endsWith("/two-factor/enable")) {
    assert.equal(payload.current_password, password);
    assert.equal(payload.code, "123456");
    user.two_factor_enabled = true;
    return json({ recovery_codes: [recovery, "FFFF-0000-1111-2222"] });
  }
  throw new Error(`Unexpected request ${url.pathname}`);
});

const qrCode = page.getByRole("img", { name: "双重验证绑定二维码", exact: true });
async function assertSetupQrCode() {
  // 独立解码器读取渲染尺寸下的二维码像素，验证扫码结果包含完整绑定 URI。
  const pixels = await qrCode.evaluate(async (svg) => {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(svg.getBoundingClientRect().width);
    canvas.height = Math.round(svg.getBoundingClientRect().height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data), width: canvas.width, height: canvas.height };
  });
  assert.equal(jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)?.data, provisioningUri);
  const exposed = await page.evaluate(() => [document.body.innerText, ...Array.from(document.querySelectorAll("input"), (input) => input.value)].join("\n"));
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  for (const sensitive of [secret, replacementSecret, provisioningUri]) {
    assert.ok(!exposed.includes(sensitive), "Setup must not display a plaintext secret or URI");
    assert.ok(!stored.includes(sensitive), "Setup material must never enter browser storage");
  }
}

try {
  await page.goto(origin);
  await page.getByLabel("用户名", { exact: true }).fill("fixture");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("验证码或恢复码", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("stocks_assistant_access_token")), null);
  await page.getByLabel("验证码或恢复码", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "验证码无效" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/stocks-2fa-login-mobile.png", fullPage: true, animations: "disabled" });
  await page.getByLabel("验证码或恢复码", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { name: "账号安全", exact: true }).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await page.getByLabel("当前密码", { exact: true }).fill(password);
  await page.getByLabel("新密码", { exact: true }).fill("Changed123!");
  await page.getByLabel("确认新密码", { exact: true }).fill("Changed123!");
  assert.equal(await page.getByRole("button", { name: "更新密码", exact: true }).isDisabled(), true);
  await page.getByLabel("验证码或恢复码", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "更新密码", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "验证码无效" }).waitFor();
  await page.screenshot({ path: "/tmp/stocks-2fa-password.png", animations: "disabled" });
  await page.getByLabel("验证码或恢复码", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "更新密码", exact: true }).click();
  await page.getByRole("button", { name: "更新密码", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "测试重新认证", exact: true }).click();
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByLabel("验证码或恢复码", { exact: true }).fill("123456");
  await page.locator('form button[type="submit"]').click();
  await page.getByLabel("验证码或恢复码", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "关闭双重验证", exact: true }).click();
  await page.getByLabel("当前密码", { exact: true }).fill(password);
  await page.getByLabel("验证码或恢复码", { exact: true }).fill(recovery);
  await page.getByRole("button", { name: "验证并关闭", exact: true }).click();
  await page.getByRole("button", { name: "启用双重验证", exact: true }).click();
  await page.getByLabel("当前密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "生成绑定二维码", exact: true }).click();
  await qrCode.waitFor();
  await assertSetupQrCode();
  const firstUri = provisioningUri;
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await qrCode.count(), 0, "Cancel removes the setup QR code");
  await page.getByRole("button", { name: "启用双重验证", exact: true }).click();
  await page.getByLabel("当前密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "生成绑定二维码", exact: true }).click();
  await qrCode.waitFor();
  assert.notEqual(provisioningUri, firstUri, "Restart uses fresh setup material");
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), dark);
      await assertSetupQrCode();
      await page.screenshot({ path: `/tmp/stocks-2fa-setup-${width}${dark ? "-dark" : ""}.png`, fullPage: true, animations: "disabled" });
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.getByLabel("六位验证码", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "验证并启用", exact: true }).click();
  await page.getByRole("heading", { name: "保存恢复码", exact: true }).waitFor();
  assert.equal(await qrCode.count(), 0, "Successful enrollment removes the setup QR code");
  assert.equal(await page.getByRole("button", { name: "完成", exact: true }).isDisabled(), true);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  assert.ok(!stored.includes(secret) && !stored.includes(replacementSecret) && !stored.includes(recovery), "Secrets must never enter browser storage");
  await page.screenshot({ path: "/tmp/stocks-2fa-recovery-mobile.png", fullPage: true, animations: "disabled" });
  await page.getByLabel("我已安全保存", { exact: true }).check();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  assert.equal(await page.getByText(recovery, { exact: true }).count(), 0);
  assert.equal(calls.filter((call) => call.path.endsWith("/two-factor/enable")).length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith("/me/password")).length, 2);
  assert.deepEqual(errors, []);
  console.log("PASS: login challenge/retry, password 2FA, reauthentication, local QR decoding, cancel/restart, recovery codes, StrictMode and light/dark desktop/mobile layouts.");
} catch (error) {
  await page.screenshot({ path: "/tmp/stocks-2fa-failure.png", fullPage: true, animations: "disabled" });
  throw error;
} finally {
  await browser.close();
}
