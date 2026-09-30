// Smoke-test the built workspace, theme preferences and removed-feature boundaries.
// Every request uses fixtures. No real account, backend or external service is contacted.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkMobileScroll } from "./mobile-scroll.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const dist = new URL("../../dist/", import.meta.url);
const origin = "http://127.0.0.1:4178";
const failures = [], errors = [], calls = [];
const user = { id: "fixture", username: "fixture", display_name: "Fixture", roles: ["admin"], permissions: ["*"], is_active: true };
const config = {
  app_language: "zh", app_theme_color: "blue", workspace_dir: "/fixture", llm_provider: "openai_compatible", llm_auth_mode: "api_key", llm_model: "fixture",
  llm_api_base: "https://example.invalid/v1", llm_temperature: 0, llm_max_output_tokens: 4096,
  llm_reasoning_effort: "medium", llm_tool_choice: "auto", agent_max_steps: 20, agent_max_context_tokens: 50000, agent_max_context_turns: 20,
  agent_tool_allowlist: [], embedding_provider: "openai", embedding_model: "fixture", embedding_api_base: "", embedding_api_key_masked: "",
  memory_enabled: true, memory_auto_curate_enabled: false, memory_curator_min_importance: 0.5, multi_agent_roles: {}, multi_agent_enabled: true,
  multi_agent_max_parallel_agents: 3, multi_agent_max_depth: 1, multi_agent_max_tasks_per_batch: 12, multi_agent_task_timeout_seconds: 180,
  telegram_enabled: false, telegram_chat_id: "", mcp_servers: {}, product_analytics_enabled: false, tracing_enabled: false,
  debug: false, log_level: "INFO", auth_max_devices_per_user: 5,
};
const marketConfig = { refresh_interval: 60, indices: Array.from({ length: 8 }, (_, i) => ({ symbol: `FIXTURE${i + 1}.US`, name: `Fixture index ${i + 1}`, enabled: true })) };
const secondUser = { ...user, id: "second", username: "second", roles: ["user"], permissions: ["config:read", "chat:read"] };
const secondConfig = structuredClone(config);
const marketWrites = [], configWrites = [];
let marketSaveGate = null;
const marketModule = () => ({ available: true, error: null, stale: false, source: "live", fetched_at: "2026-09-30", indices: marketConfig.indices.filter((item) => item.enabled).map((item) => ({ ...item, last_done: "100", change_rate: "1" })) });
const closingSnapshots = [
  { market: "US", date: "2026-09-28", total_assets: "1800.00", total_capital: "500", equity_value: "1300", scheduled_at: "2026-09-28T16:00:00-04:00", captured_at: "2026-09-28T20:05:00Z", source: "fixture close" },
  { market: "US", date: "2026-09-29", total_assets: "2000.00", total_capital: "500", equity_value: "1500", scheduled_at: "2026-09-29T16:00:00-04:00", captured_at: "2026-09-29T20:05:00Z", source: "fixture close" },
];
let portfolioQuotesComplete = true;
const symbol = "AAPL.US";
const position = { id: 1, symbol, name: "Apple", market: "US", shares: "12", cost_price: "100", currency: "USD", current_price: "110", stock_value: "1320", note: "", change_rate: "1%", valuation_price_source: "live" };
const session = { id: "session", title: "Fixture chat", created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z", messages: [], inputs: [], message_count: 0, active_run: null };
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  localStorage.setItem("stocks_assistant_access_token", "fixture");
  localStorage.setItem("stocks_assistant_refresh_token", "fixture");
  localStorage.setItem("stocks-assistant.news.mode", "guardian"); // Old preferences must not revive removed features.
});
const routeFixture = async (route) => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.origin !== origin) { failures.push(request.url()); return route.abort(); }
  if (!path.startsWith("/api/")) {
    const asset = path.startsWith("/assets/") ? path.slice(1) : "index.html";
    return route.fulfill({ body: await readFile(new URL(asset, dist)), contentType: asset.endsWith(".css") ? "text/css" : asset.endsWith(".js") ? "application/javascript" : "text/html" });
  }
  calls.push(path);
  if (path === "/api/v1/auth/setup/status") return json({ setup_required: false });
  const currentUser = request.headers().authorization === "Bearer second" ? secondUser : user;
  if (path === "/api/v1/auth/me") return json(currentUser);
  if (path === "/api/v1/auth/login") {
    const account = request.postDataJSON().username === "second" ? secondUser : user;
    return json({ access_token: account.id, refresh_token: account.id, token_type: "bearer", user: account });
  }
  if (path === "/api/v1/auth/logout") return json({ status: "ok" });
  if (path === "/api/v1/auth/device/heartbeat") return json({ status: "ok" });
  if (path === "/api/v1/config") {
    const accountConfig = currentUser.id === "second" ? secondConfig : config;
    if (request.method() === "PATCH" || request.method() === "PUT") {
      configWrites.push(request.postDataJSON());
      Object.assign(accountConfig, request.postDataJSON());
    }
    return json(accountConfig);
  }
  if (path === "/api/v1/tools") return json({ tools: [], total: 0 });
  if (path === "/api/v1/config/readiness") return json({ ready: true, checks: [] });
  if (path === "/api/v1/config/longbridge/oauth/status") return json({ auth_mode: "apikey", status: "disconnected", client_id: "", error: null });
  if (path === "/api/v1/market/config") {
    if (request.method() === "PUT") {
      const submitted = request.postDataJSON();
      marketWrites.push(submitted);
      if (marketSaveGate) await marketSaveGate;
      Object.assign(marketConfig, submitted);
    }
    return json(marketConfig);
  }
  if (path === "/api/v1/agent/sessions") return json({ sessions: [session], total: 1 });
  if (path === "/api/v1/agent/sessions/session") return json(session);
  if (path === "/api/v1/agent/stream") {
    const message = request.postDataJSON().message;
    session.messages = [{ id: "question", role: "user", content: message, created_at: session.created_at }, { id: "answer", role: "assistant", content: "Fixture reply", created_at: session.created_at }];
    session.message_count = 2;
    const data = [{ type: "run_started", data: {} }, { type: "message_update", data: { delta: "Fixture reply" } }, { type: "agent_end", data: { message_id: "answer", final_response: "Fixture reply", sources: [] } }];
    return route.fulfill({ contentType: "text/event-stream", body: data.map((event, i) => `data: ${JSON.stringify({ ...event, event_id: i + 1, run_id: "run" })}\n\n`).join("") });
  }
  if (path === "/api/v1/watchlist") return json({ items: [], total: 0 });
  if (path === "/api/v1/market/candlesticks") return json({ symbol, bars: Array.from({ length: 500 }, (_, i) => ({ timestamp: 1720000000 + i * 86400, open: String(100 + i / 10), high: String(103 + i / 10), low: String(98 + i / 10), close: String(101 + i / 10), volume: "10000", turnover: "1000000" })) });
  if (path === "/api/v1/news") return json({ symbol, news: [{ id: "story", title: "Fixture company news", description: "Longbridge news remains available", published_at: "2026-09-30", url: "https://example.invalid/story", likes_count: 0, comments_count: 0, shares_count: 0 }], total: 1 });
  if (path === "/api/v1/fundamentals/financial-reports") return json({ symbol, kind: "All", statements: [] });
  if (path === "/api/v1/portfolio") {
    assert.equal(request.method(), "GET", "Viewing snapshots must never write portfolio data");
    return json({ market: "US", total_capital: "2000", total_assets: "2120", cash_ratio: "30%", items: [position], total: 1, valuation_complete: portfolioQuotesComplete, unpriced_symbols: portfolioQuotesComplete ? [] : [symbol], asset_snapshots: closingSnapshots });
  }
  if (path === "/api/v1/portfolio/transactions") return json({ market: "US", transactions: [], total: 0 });
  if (path === "/api/v1/knowledge/tree") return json({ tree: { root_files: [{ name: "note.md", title: "Fixture note", size: 20 }], tree: [], stats: { pages: 1, size: 20 }, enabled: true } });
  if (path === "/api/v1/knowledge/graph") return json({ nodes: [], links: [] });
  if (path === "/api/v1/knowledge/read") return json({ path: "note.md", content: "Knowledge is retained", size: 20 });
  if (path === "/api/v1/scheduler/tasks") return json({ tasks: [], total: 0 });
  if (path === "/api/v1/market/temperature") return json({ market: url.searchParams.get("market"), temperature: 50, sentiment: 50, description: "Fixture", updated_at: 1780000000 });
  if (path === "/api/v1/dashboard") return json({
    market: marketModule(),
    watchlist: { status: "ok", items: [], views: { movers: [], gainers: [], losers: [], active: [] }, total: 0, counts_by_category: {} },
    portfolio: { status: "ok", markets: [] },
  });
  if (path === "/api/v1/dashboard/market") return json(marketModule());
  if (path === "/api/v1/dashboard/watchlist") return json({ status: "ok", items: [], views: { movers: [], gainers: [], losers: [], active: [] }, total: 0, counts_by_category: {} });
  if (path === "/api/v1/dashboard/portfolio") return json({ status: "ok", markets: [] });
  failures.push(`${request.method()} ${path}`); return json({ detail: "Unexpected request" }, 500);
};
await context.route("**/*", routeFixture);
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
async function navigate(href) {
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.locator(`a[href="${href}"]`).first().click();
}
async function checkMarketConfigSaves() {
  await page.goto(`${origin}/market/config`);
  const interval = page.getByRole("spinbutton", { name: "自动刷新间隔（秒）" });
  await interval.waitFor();
  assert.equal(await page.locator(".app-toast, .config-toast").count(), 0, "Loading settings must not announce a save");
  let releaseSave;
  marketSaveGate = new Promise((resolve) => { releaseSave = resolve; });
  await page.getByPlaceholder("输入名称、代码或关键词搜索指数，如 恒生、SPX、上证...").fill("HSTECH");
  await page.getByRole("button", { name: /恒生科技指数.*HSTECH.HK/ }).click();
  await page.getByRole("button", { name: "保存中", exact: true }).last().waitFor();
  await page.getByRole("tab", { name: "模型", exact: true }).click();
  await page.getByRole("tab", { name: "行情", exact: true }).click();
  await page.getByText("HSTECH.HK", { exact: true }).waitFor();
  await navigate("/dashboard");
  await page.locator(".finance-index-item").first().waitFor();
  releaseSave();
  marketSaveGate = null;
  await page.locator(".finance-index-item").filter({ hasText: "HSTECH.HK" }).waitFor();
  assert.equal(await page.locator(".finance-index-item").count(), 9, "All configured indices must be rendered, including the ninth");
  await page.locator(".app-toast").filter({ hasText: "行情配置" }).getByText("已保存", { exact: true }).waitFor();
  assert.equal(marketWrites.length, 1, "One add must produce one write under StrictMode");
  await navigate("/settings");
  await page.getByRole("tab", { name: "行情", exact: true }).click();
  await page.getByText("HSTECH.HK", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("tab", { name: "行情", exact: true }).click();
  await page.getByText("HSTECH.HK", { exact: true }).waitFor();
  await interval.fill("90");
  await page.waitForResponse((response) => response.url().endsWith("/market/config") && response.request().method() === "PUT");
  await page.locator(".app-toast").getByText("已保存", { exact: true }).waitFor();
  assert.equal(marketConfig.refresh_interval, 90);
  await page.locator(".app-toast").getByRole("button", { name: "Close" }).click();
  await page.locator(".app-toast").waitFor({ state: "detached" });
  await interval.fill("120");
  await page.getByRole("button", { name: "立即保存", exact: true }).click();
  await page.locator(".app-toast").getByText("已保存", { exact: true }).waitFor();
  assert.equal(marketConfig.refresh_interval, 120, "Header save must also flush market settings");
  await page.getByRole("tab", { name: "模型", exact: true }).click();
  await page.getByRole("textbox", { name: "LLM Model", exact: true }).fill("auto-model");
  await page.locator(".app-toast").filter({ hasText: "配置管理" }).getByText("已保存", { exact: true }).waitFor();
  assert.equal(config.llm_model, "auto-model");
  await page.locator(".app-toast").filter({ hasText: "配置管理" }).getByRole("button", { name: "Close" }).click();
  await page.locator(".app-toast").filter({ hasText: "配置管理" }).waitFor({ state: "detached" });
  await page.getByRole("textbox", { name: "LLM Model", exact: true }).fill("manual-model");
  await page.getByRole("button", { name: "立即保存", exact: true }).click();
  await page.locator(".app-toast").filter({ hasText: "配置管理" }).getByText("已保存", { exact: true }).waitFor();
  assert.equal(config.llm_model, "manual-model");
  assert.equal(configWrites.length, 2);
}
async function checkClosingSnapshots() {
  const legacyKey = "stocks-assistant.portfolio.asset-snapshots.v2.fixture";
  const legacy = JSON.stringify([{ market: "US", date: "2026-09-30", total_assets: "999999" }]);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: legacyKey, value: legacy });
  await page.goto(`${origin}/portfolio`);
  await page.getByRole("button", { name: "图表", exact: true }).click();
  const chart = page.getByRole("group", { name: "资产快照图，左右方向键查看各日期" });
  await chart.waitFor();
  const panel = chart.locator("../../..");
  await panel.getByText("2026-09-29", { exact: true }).first().waitFor();
  assert.ok((await panel.innerText()).includes("2,000"), "Chart must show the saved closing value");
  assert.ok(!(await panel.innerText()).includes("999,999"), "Legacy intraday browser data must not masquerade as closes");
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await panel.getByText("2026-09-28", { exact: true }).first().waitFor();
  portfolioQuotesComplete = false;
  await page.reload();
  await page.getByRole("button", { name: "图表", exact: true }).click();
  await chart.waitFor();
  assert.ok((await panel.innerText()).includes("2,000"), "Missing current quotes must not hide saved history");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), legacyKey), legacy, "Page visits must not overwrite legacy snapshots");
  portfolioQuotesComplete = true;
}
async function absentRemovedUI() {
  assert.equal(await page.getByRole("button", { name: /^(AI 研究|Thesis|估值|Guardian|实验室|保存为证据|保存证据)$/i }).count(), 0);
  assert.equal(await page.locator('a[href="/labs"],a[href$="/thesis"],a[href$="/ai-research"]').count(), 0);
}
async function readTheme() {
  // Reduced motion still uses a short color transition; inspect its final colors.
  await page.locator(".app-mark").evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  return page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const mark = getComputedStyle(document.querySelector(".app-mark"));
    return {
      color: document.documentElement.dataset.themeColor,
      dark: document.documentElement.classList.contains("dark"),
      primary: styles.getPropertyValue("--primary").trim(),
      accent: styles.getPropertyValue("--accent").trim(),
      ring: styles.getPropertyValue("--ring").trim(),
      background: mark.backgroundColor, foreground: mark.color,
      market: ["--color-up", "--color-down", "--color-up-chart", "--color-down-chart", "--chart-blue"].map((key) => styles.getPropertyValue(key).trim()),
    };
  });
}
function contrast(a, b) {
  const luminance = (rgb) => rgb.match(/[\d.]+/g).slice(0, 3).map((channel) => {
    const value = Number(channel) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
async function checkThemePreferences() {
  await page.getByRole("tab", { name: "偏好与能力", exact: true }).click();
  const colors = { blue: "蓝色", violet: "紫色", teal: "青色", green: "绿色", orange: "橙色", rose: "玫红" };
  assert.equal(await page.getByRole("group", { name: "主题色", exact: true }).getByRole("radio").count(), 6);
  for (const mode of ["亮色", "黑暗"]) {
    await page.locator(".theme-toggle").getByRole("button", { name: `切换到 ${mode}`, exact: true }).click();
    await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, mode === "黑暗");
    const baseline = await readTheme();
    const backgrounds = new Set();
    for (const [color, label] of Object.entries(colors)) {
      const radio = page.getByRole("radio", { name: label, exact: true });
      await radio.locator("..").click();
      await page.waitForFunction((value) => document.documentElement.dataset.themeColor === value, color);
      assert.ok(await radio.isChecked());
      await page.getByRole("button", { name: "保存中", exact: true }).waitFor({ state: "hidden" });
      assert.equal(config.app_theme_color, color, "Every theme choice must persist to the account API");
      const current = await readTheme();
      assert.equal(current.primary, current.accent);
      assert.equal(current.primary, current.ring);
      assert.deepEqual(current.market, baseline.market, "Theme accents must not recolor market directions or indicators");
      assert.ok(contrast(current.background, current.foreground) >= 4.5, `${color} ${mode} must keep primary text readable`);
      backgrounds.add(current.background);
    }
    assert.equal(backgrounds.size, 6, "Every swatch must apply a distinct accent");
  }
  const violet = page.getByRole("radio", { name: "紫色", exact: true });
  await violet.locator("..").click();
  await violet.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.documentElement.dataset.themeColor === "teal");
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => document.documentElement.dataset.themeColor === "violet");
  const selected = await readTheme();
  await page.getByRole("button", { name: "保存中", exact: true }).waitFor({ state: "hidden" });
  await page.screenshot({ path: "/tmp/stocks-theme-dark.png" });
  await page.reload();
  await page.getByRole("tab", { name: "偏好与能力", exact: true }).click();
  assert.ok(await violet.isChecked(), "Selected accent must survive reload");
  assert.deepEqual(await readTheme(), selected, "Accent and dark mode must both survive reload");
  await page.locator(".theme-toggle").getByRole("button", { name: "切换到 亮色", exact: true }).click();
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  assert.equal((await readTheme()).color, "violet");
  await page.screenshot({ path: "/tmp/stocks-theme-light.png" });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("radio", { name: "橙色", exact: true }).locator("..").click();
    await page.getByRole("button", { name: "保存中", exact: true }).waitFor({ state: "hidden" });
    for (const label of Object.values(colors)) {
      const box = await page.getByRole("radio", { name: label, exact: true }).locator("..").boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.width >= 44 && box.height >= 44, `Swatch ${label} must fit and remain touchable at ${width}px`);
    }
  }
  await readTheme();
  await page.screenshot({ path: "/tmp/stocks-theme-mobile.png" });
  await page.evaluate(() => localStorage.setItem("stocks-assistant-theme-color", "rose"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.getByRole("tab", { name: "偏好与能力", exact: true }).click();
  assert.ok(await page.getByRole("radio", { name: "橙色", exact: true }).isChecked(), "Legacy browser preference must not override the account");
  await checkThemeAccounts();
  config.app_theme_color = "unknown-old-value";
  await page.reload();
  await page.getByRole("tab", { name: "偏好与能力", exact: true }).click();
  assert.ok(await page.getByRole("radio", { name: "蓝色", exact: true }).isChecked());
  assert.equal((await readTheme()).color, "blue", "Invalid saved colors must recover to the default");
  config.app_theme_color = "blue";
}

async function signIn(target, username) {
  await target.getByLabel("Username", { exact: true }).fill(username);
  await target.getByLabel("Password", { exact: true }).fill("FixturePassword!");
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await target.getByRole("tab", { name: "偏好与能力", exact: true }).click();
}

async function signOut() {
  await page.getByRole("button", { name: "打开账号菜单", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeColor), undefined, "Signing out must clear the previous account's color");
}

async function checkThemeAccounts() {
  // A new browser profile has no theme storage, but restores the same account preference.
  const fresh = await browser.newContext();
  await fresh.route("**/*", routeFixture);
  const otherDevice = await fresh.newPage();
  try {
    await otherDevice.goto(`${origin}/settings`);
    await signIn(otherDevice, "fixture");
    assert.ok(await otherDevice.getByRole("radio", { name: "橙色", exact: true }).isChecked());
    assert.equal(await otherDevice.evaluate(() => localStorage.getItem("stocks-assistant-theme-color")), null);
  } finally { await fresh.close(); }

  await signOut();
  await signIn(page, "second");
  assert.ok(await page.getByRole("radio", { name: "蓝色", exact: true }).isChecked(), "Another account must start with its own preference");
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/v1/config") && response.request().method() === "PATCH"),
    page.getByRole("radio", { name: "绿色", exact: true }).locator("..").click(),
  ]);
  await page.getByRole("button", { name: "保存中", exact: true }).waitFor({ state: "hidden" });
  assert.equal(secondConfig.app_theme_color, "green", "Regular users can save their theme without config:write");
  assert.equal(config.app_theme_color, "orange");
  await signOut();
  await signIn(page, "fixture");
  assert.ok(await page.getByRole("radio", { name: "橙色", exact: true }).isChecked());
}
try {
  await checkMobileScroll(page, { origin, config });
  await checkMarketConfigSaves();
  await checkClosingSnapshots();
  await page.goto(`${origin}/security/${symbol}`);
  await page.getByRole("button", { name: "MA250", exact: true }).waitFor();
  await page.waitForFunction(() => (document.querySelector(".technical-native-chart canvas")?.width ?? 0) > 300);
  await absentRemovedUI();
  await page.screenshot({ path: "/tmp/stocks-company-after-removal.png" });
  await page.getByRole("button", { name: "持仓", exact: true }).click();
  await page.getByText("12", { exact: true }).waitFor();
  await page.getByRole("button", { name: "新闻", exact: true }).click();
  await page.getByText("Fixture company news", { exact: true }).waitFor();
  await absentRemovedUI();
  await Promise.all([page.waitForResponse((response) => response.url().includes("/fundamentals/financial-reports")), page.getByRole("button", { name: "财务", exact: true }).click()]);
  await absentRemovedUI();
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.locator('a[href="/knowledge"]').first().waitFor();
  assert.match(await page.locator('a[href="/knowledge"]').first().textContent(), /知识库/);
  await absentRemovedUI();
  await page.locator('a[href="/knowledge"]').first().click();
  await page.getByText("Fixture note", { exact: true }).click();
  await page.getByText("Knowledge is retained", { exact: true }).waitFor();
  await page.goto(`${origin}/scheduler`);
  await page.getByText("暂无定时任务", { exact: true }).waitFor();
  await absentRemovedUI();
  await page.goto(`${origin}/settings`);
  await page.getByRole("tab", { name: "数据源", exact: true }).click();
  await page.getByPlaceholder("Longbridge app key", { exact: true }).waitFor();
  await absentRemovedUI();
  assert.doesNotMatch(await page.locator("body").innerText(), /Guardian|快速问答/);
  await checkThemePreferences();
  // Language selection uses the registry and persists through the existing account autosave.
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/v1/config") && response.request().method() === "PATCH"),
    page.getByRole("button", { name: "English", exact: true }).click(),
  ]);
  await page.waitForFunction(() => document.documentElement.lang === "en-US");
  await page.getByRole("tab", { name: "Preferences & features", exact: true }).waitFor();
  assert.equal(config.app_language, "en");
  assert.equal(await page.locator("html").getAttribute("dir"), "ltr");
  await page.reload();
  await page.getByRole("tab", { name: "Preferences & features", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("lang"), "en-US");
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/v1/config") && response.request().method() === "PATCH"),
    page.getByRole("button", { name: "简体中文", exact: true }).click(),
  ]);
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  assert.equal(config.app_language, "zh");
  await page.goto(`${origin}/dashboard`);
  await page.locator("textarea").first().fill("Hello fixture");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("Fixture reply", { exact: true }).waitFor();
  await absentRemovedUI();
  assert.ok(calls.includes("/api/v1/knowledge/read"));
  assert.equal(calls.filter((path) => /^\/api\/v1\/(research|labs|alerts)(\/|$)|\/guardian\//.test(path)).length, 0);
  assert.deepEqual(failures, []);
  assert.deepEqual(errors, []);
  console.log("PASS: backend closing snapshots, quote failures and legacy browser isolation; market autosave, tab/page navigation and reload persistence, ninth index, manual/automatic save toasts; company chart/position/news/financials, navigation, knowledge, scheduler, settings and general AI chat; theme colors, contrast, keyboard selection, persistence, mobile layout and fallback; locale switching and persistence; no retired feature requests or page errors.");
} catch (error) {
  await page.screenshot({ path: "/tmp/stocks-workspace-removal-failure.png", fullPage: true });
  console.error({ failures, errors });
  throw error;
} finally { await browser.close(); }
