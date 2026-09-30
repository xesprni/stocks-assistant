// Real chart/layout regression with deterministic local fixtures; no live account or network.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const assets = new URL("../../dist/assets/", import.meta.url);
const cssName = (await readdir(assets)).find((name) => /^index-.*\.css$/.test(name));
assert.ok(cssName, "Run npm run build before the browser regression");
const css = await readFile(new URL(cssName, assets), "utf8");
const compiled = await build({ entryPoints: [new URL("./watchlist-fixture.tsx", import.meta.url).pathname], bundle: true,
  write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"development"' },
  tsconfig: new URL("../../tsconfig.app.json", import.meta.url).pathname });
const bundle = compiled.outputFiles[0].text;
const stock = (id, symbol, category, name, rate) => ({ id, symbol, category, name, name_en: name, name_cn: name, name_hk: "", exchange: "", currency: "USD",
  last_done: "123.45", change_rate: rate, change_value: "2", note: "", created_at: "2026-09-01", updated_at: "2026-09-01" });
const initialItems = [stock(1, "AAPL.US", "US", "苹果 Apple", "2.50%"), stock(2, "MSFT.US", "US", "微软 Microsoft", null),
  stock(3, "NVDA.US", "US", "英伟达 Nvidia", "-1.23%"), stock(4, "700.HK", "H", "腾讯控股", "0.42%")];
let items = [...initialItems], groups = [{ id: 1, name: "核心关注", item_ids: [1, 4] }], flowMode = "data", candleCountLimit = 1000, candleMode = "data";
let failReorder = false;
const calls = [], errors = [], failures = [];
const origin = "http://watchlist.test";
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
async function route(route) {
  const request = route.request(), url = new URL(request.url());
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.origin !== origin) { failures.push(request.url()); await route.abort(); return; }
  if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>' });
  if (url.pathname === "/app.css") return route.fulfill({ contentType: "text/css", body: css });
  if (url.pathname === "/app.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
  if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
  const payload = request.postDataJSON();
  calls.push({ path: url.pathname, method: request.method(), payload, params: Object.fromEntries(url.searchParams) });
  if (url.pathname === "/api/v1/watchlist") return json({ items, total: items.length });
  if (url.pathname === "/api/v1/watchlist/overview") return json({ items, quote_error: null, error: null });
  if (url.pathname === "/api/v1/watchlist/reorder") {
    if (failReorder) return json({ detail: "Fixture save failed" }, 503);
    items = payload.ids.map((id) => items.find((item) => item.id === id)); return json({ status: "ok" });
  }
  if (url.pathname === "/api/v1/watchlist/groups") {
    if (request.method() === "POST") groups = [...groups, { id: Math.max(0, ...groups.map((group) => group.id)) + 1, name: payload.name, item_ids: [] }];
    return json({ groups });
  }
  const groupRoute = url.pathname.match(/^\/api\/v1\/watchlist\/groups\/(\d+)(\/members)?$/);
  if (groupRoute) {
    const id = Number(groupRoute[1]);
    if (request.method() === "DELETE") groups = groups.filter((group) => group.id !== id);
    else groups = groups.map((group) => group.id !== id ? group : { ...group, ...(groupRoute[2] ? { item_ids: payload.item_ids } : { name: payload.name }) });
    return json({ groups });
  }
  if (url.pathname === "/api/v1/market/candlesticks") return json({ bars: Array.from({ length: Math.min(Number(url.searchParams.get("count")), candleCountLimit) }, (_, i) => {
    if (candleMode === "flat") return { timestamp: 1720000000 + i * 86400, open: "100", high: "100", low: "100", close: "100", volume: "10000", turnover: "1000000" };
    const close = 100 + Math.sin(i / 7) * 8 + i / 10;
    return { timestamp: 1720000000 + i * 86400, open: String(close - 1), high: String(close + 3), low: String(close - 3), close: String(close), volume: candleMode === "zero" ? "0" : String(10000 + i * 700), turnover: "1000000" };
  }) });
  if (url.pathname === "/api/v1/market/capital-flow") {
    if (flowMode === "error") return json({ detail: "Fixture unavailable" }, 503);
    const lines = flowMode === "empty" ? [] : Array.from({ length: 100 }, (_, i) => ({ timestamp: 1720000000 + i * 60, inflow: String(Math.sin(i / 12) * 1e7) }));
    return json({ symbol: "AAPL.US", source: "fixture", lines, total: lines.length });
  }
  failures.push(`${request.method()} ${url.pathname}`); return json({ detail: "Unexpected request" }, 500);
}
await context.route("**/*", route);
function installCanvasProbe() {
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  const fillText = CanvasRenderingContext2D.prototype.fillText;
  const begin = CanvasRenderingContext2D.prototype.beginPath;
  const move = CanvasRenderingContext2D.prototype.moveTo;
  const line = CanvasRenderingContext2D.prototype.lineTo;
  const stroke = CanvasRenderingContext2D.prototype.stroke;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    this.canvas.drawnLabels = [];
    this.canvas.drawnText = [];
    this.canvas.drawnLines = [];
    return clear.apply(this, args);
  };
  CanvasRenderingContext2D.prototype.fillText = function (...args) {
    (this.canvas.drawnLabels ??= []).push(args[0]);
    (this.canvas.drawnText ??= []).push({ text: args[0], x: args[1], y: args[2], width: this.measureText(args[0]).width });
    return fillText.apply(this, args);
  };
  CanvasRenderingContext2D.prototype.beginPath = function () { this.probePath = []; return begin.call(this); };
  CanvasRenderingContext2D.prototype.moveTo = function (x, y) { this.probePath?.push({ x, y }); return move.call(this, x, y); };
  CanvasRenderingContext2D.prototype.lineTo = function (x, y) { this.probePath?.push({ x, y }); return line.call(this, x, y); };
  CanvasRenderingContext2D.prototype.stroke = function (...args) {
    if (Math.abs(this.lineWidth - 1.35) < 1e-6 && this.probePath?.length > 1) (this.canvas.drawnLines ??= []).push({ color: this.strokeStyle, points: [...this.probePath] });
    return stroke.apply(this, args);
  };
}
await context.addInitScript(installCanvasProbe);
let page;
const rows = () => page.locator(".watchlist-sortable-row");
async function select(label, option) { await page.getByRole("button", { name: label, exact: true }).click(); await page.getByRole("option", { name: option, exact: true }).click(); }
async function waitRows(count) { await page.waitForFunction((count) => document.querySelectorAll(".watchlist-sortable-row").length === count, count); }
const reorders = () => calls.filter((call) => call.path.endsWith("/reorder"));
const editSwitch = () => page.getByRole("switch", { name: "编辑模式", exact: true });
async function finishEdit() {
  await editSwitch().click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="编辑模式"]')?.getAttribute("aria-checked") === "false");
  assert.equal(await page.locator(".watchlist-drag-handle").count(), 0);
  assert.equal(await page.getByRole("button", { name: "公司排序", exact: true }).count(), 0);
}
async function moveFirstDown(symbol) {
  const handle = page.locator(".watchlist-drag-handle").first();
  await handle.press("Space");
  await page.locator('[data-dragging="true"]').waitFor();
  // KeyboardSensor attaches its document listeners after activation; let layout settle first.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press("ArrowDown");
  await page.locator('[data-drop-target="true"]').waitFor();
  await page.keyboard.press("Space");
  await page.waitForFunction((symbol) => document.querySelector(".watchlist-sortable-row")?.textContent.includes(symbol), symbol);
}
async function maLines(expected) {
  await page.waitForFunction((expected) => {
    const labels = document.querySelector(".technical-native-chart canvas")?.drawnLabels ?? [];
    const actual = labels.filter((label) => /^MA\d+$/.test(label));
    return JSON.stringify(actual) === JSON.stringify(expected.map((period) => `MA${period}`));
  }, expected);
}
async function painted(selector) {
  await page.waitForFunction((selector) => {
    const canvas = document.querySelector(selector);
    if (!canvas) return false;
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let index = 0; index < data.length; index += 40) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`);
    return colors.size > 8;
  }, selector);
}
async function contained(selector, minimumHeight = 0) {
  const rect = await page.locator(selector).boundingBox();
  assert.ok(rect && rect.height > minimumHeight, `${selector} must have usable height`);
  assert.ok(rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= page.viewportSize().width + 1 && rect.y + rect.height <= page.viewportSize().height + 1,
    `${selector} clipped: ${JSON.stringify(rect)} / ${JSON.stringify(page.viewportSize())}`);
}
async function checkMobileMAs(mobile) {
  for (const period of [60, 120, 250]) {
    const toggle = page.getByRole("button", { name: `MA${period}`, exact: true });
    await toggle.tap();
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  }
  const cdp = await mobile.newCDPSession(page);
  try {
    for (const [width, height] of [[390, 844], [320, 568], [568, 320], [844, 390]]) {
      await page.setViewportSize({ width, height });
      const canvas = page.locator(".technical-native-chart canvas");
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector(".technical-native-chart canvas")?.drawnLines?.length === 6);
      const paths = await canvas.evaluate((element) => element.drawnLines);
      assert.deepEqual(paths.map((path) => path.points.length), [496, 491, 481, 441, 381, 251], "All six real MA paths must retain their warmup windows on mobile");
      const box = await canvas.boundingBox();
      const point = { x: box.x + (box.width - 60) * 0.85, y: box.y + box.height * 0.35 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      try {
        await page.waitForFunction(() => document.querySelector(".technical-native-chart canvas")?.drawnLabels?.some((label) => /^MA250 \d/.test(label)));
        const labels = await canvas.evaluate((element) => element.drawnText.filter((entry) => /^MA\d+ /.test(entry.text)));
        assert.equal(labels.length, 6, `Long-press at ${width}px must keep every MA value`);
        for (const label of labels) assert.ok(label.x >= 0 && label.x + label.width < box.width - 54, `MA text must not enter the price axis: ${label.text}`);
        await page.screenshot({ path: `/tmp/stocks-ma-mobile-${width}.png` });
      } finally { await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    }
  } finally { await cdp.detach(); }
}
try {
  page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message)); page.setDefaultTimeout(8000);
  await page.goto(origin); await waitRows(4);
  await maLines([5, 10, 20]);
  for (const period of [60, 120, 250]) {
    const toggle = page.getByRole("button", { name: `MA${period}`, exact: true });
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", `MA${period} should be hidden by default`);
    await toggle.click();
  }
  await maLines([5, 10, 20, 60, 120, 250]);
  const chips = page.getByRole("complementary", { name: "筹码分布", exact: true });
  await chips.getByText("样本：120根日K", { exact: true }).waitFor();
  await chips.getByRole("button", { name: "60根", exact: true }).click();
  await chips.getByText("样本：60根日K", { exact: true }).waitFor();
  await chips.getByRole("button", { name: "250根", exact: true }).click();
  await chips.getByText("样本：250根日K", { exact: true }).waitFor();
  await chips.getByText("平均成本", { exact: true }).waitFor();
  await chips.getByText("70%成本区间", { exact: true }).waitFor();
  const profile = chips.getByRole("slider", { name: "查看筹码价位", exact: true });
  await profile.focus(); await profile.press("Home"); await profile.press("ArrowUp");
  assert.equal(await profile.getAttribute("aria-valuenow"), "1");
  assert.match(await chips.locator(".chip-profile-detail").textContent(), /占比 \d+\.\d+%/);
  await profile.press("End");
  assert.equal(await profile.getAttribute("aria-valuenow"), await profile.getAttribute("aria-valuemax"));
  await profile.press("Escape");
  const fullAxis = await chips.locator(".chip-profile-plot > div > span").allTextContents();
  await chips.getByRole("button", { name: "跟随K线", exact: true }).click();
  await page.waitForFunction((previous) => JSON.stringify([...document.querySelectorAll(".chip-profile-plot > div > span")].map((item) => item.textContent)) !== JSON.stringify(previous), fullAxis);
  await chips.getByRole("button", { name: "跟随K线", exact: true }).click();
  await page.evaluate(() => { document.documentElement.classList.add("dark"); document.documentElement.dataset.colorScheme = "cn"; document.documentElement.dataset.themeColor = "violet"; });
  await page.waitForFunction(() => document.querySelector(".chip-profile-bin > div")?.style.background === "rgb(255, 69, 58)");
  await page.screenshot({ path: "/tmp/stocks-chips-dark.png" });
  await page.evaluate(() => { document.documentElement.classList.remove("dark"); document.documentElement.dataset.colorScheme = "intl"; document.documentElement.dataset.themeColor = "blue"; });
  assert.equal(calls.find((call) => call.path.endsWith("/candlesticks")).params.count, "500");
  await page.getByRole("button", { name: "MA60", exact: true }).click();
  await maLines([5, 10, 20, 120, 250]);
  await page.getByRole("button", { name: "MA120", exact: true }).click();
  await maLines([5, 10, 20, 250]);
  await page.getByRole("button", { name: "MA120", exact: true }).click();
  await page.getByRole("button", { name: "MA", exact: true }).click();
  await maLines([]);
  await page.getByRole("button", { name: "MA", exact: true }).click();
  await maLines([5, 10, 20, 120, 250]);
  await page.getByRole("button", { name: "周K", exact: true }).click();
  await chips.getByText("样本：250根周K", { exact: true }).waitFor();
  assert.doesNotMatch(await page.getByRole("button", { name: "MA120", exact: true }).textContent(), /半年线/);
  await maLines([5, 10, 20, 120, 250]);
  await page.getByRole("button", { name: "日K", exact: true }).click();
  assert.match(await page.getByRole("button", { name: "MA250", exact: true }).textContent(), /年线/);
  await maLines([5, 10, 20, 120, 250]);
  await page.getByRole("button", { name: "港股", exact: true }).click(); await waitRows(1);
  assert.equal(await page.locator(".watchlist-drag-handle").count(), 0);
  assert.equal(await page.getByRole("button", { name: "公司排序", exact: true }).count(), 0);
  await page.getByRole("tab", { name: "核心关注", exact: true }).click(); await waitRows(1);
  await page.getByRole("button", { name: "全部市场", exact: true }).click(); await waitRows(2);
  await page.getByRole("textbox", { name: "筛选自选" }).fill("aapl 苹果"); await waitRows(1);
  assert.equal(calls.filter((call) => call.path.endsWith("/search")).length, 0);
  await page.getByRole("textbox", { name: "筛选自选" }).fill("");
  await page.getByRole("tab", { name: "全部自选", exact: true }).click(); await waitRows(4);
  await page.getByRole("tab", { name: "全部自选", exact: true }).press("ArrowRight"); await waitRows(2);
  assert.equal(await page.getByRole("tab", { name: "未分组", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "全部自选", exact: true }).click(); await waitRows(4);
  await editSwitch().click();
  await select("公司排序", "跌幅优先");
  assert.match(await rows().first().textContent(), /NVDA/);
  assert.match(await rows().last().textContent(), /MSFT/);
  assert.ok(await page.locator(".watchlist-drag-handle").first().isDisabled());
  assert.equal(reorders().length, 0, "sort selection only previews until edit mode closes");
  await finishEdit();
  assert.equal(reorders().length, 1);
  assert.deepEqual(items.map((item) => item.id), [3, 4, 1, 2]);
  await page.reload(); await waitRows(4);
  assert.match(await rows().first().textContent(), /NVDA/);
  assert.equal(await page.evaluate(() => localStorage.getItem("stocks-assistant.watchlist-sort")), "losers");
  await editSwitch().click();
  await select("公司排序", "自定义排序");
  await moveFirstDown("700.HK");
  assert.equal(reorders().length, 1, "keyboard drag is also a draft");
  await page.screenshot({ path: "/tmp/stocks-watchlist-editing.png" });
  failReorder = true;
  await editSwitch().click();
  await page.getByRole("alert").filter({ hasText: "修改已保留" }).waitFor();
  assert.equal(await editSwitch().getAttribute("aria-checked"), "true");
  assert.match(await rows().first().textContent(), /700.HK/);
  assert.equal(await page.evaluate(() => localStorage.getItem("stocks-assistant.watchlist-sort")), "losers", "failed save does not commit sort preference");
  failReorder = false; await finishEdit();
  assert.equal(reorders().length, 3);
  assert.deepEqual(items.map((item) => item.id), [4, 3, 1, 2]);
  await page.getByRole("tab", { name: "核心关注", exact: true }).click(); await waitRows(2);
  await editSwitch().click(); await moveFirstDown("AAPL.US");
  assert.equal(reorders().length, 3);
  await finishEdit();
  assert.deepEqual(items.map((item) => item.id), [1, 3, 4, 2], "group drag retains hidden companies' slots");
  await page.getByRole("tab", { name: "全部自选", exact: true }).click(); await waitRows(4);
  await page.reload(); await waitRows(4);
  assert.match(await rows().first().textContent(), /AAPL/);
  assert.equal(await page.evaluate(() => localStorage.getItem("stocks-assistant.watchlist-sort")), "manual");
  await editSwitch().click(); await finishEdit();
  assert.equal(reorders().length, 4, "unchanged order does not send a redundant mutation");
  await page.getByRole("button", { name: "管理分组", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "分组名称" }).fill("重点公司");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.getByRole("checkbox", { name: /英伟达/ }).check();
  await dialog.getByRole("button", { name: "保存成员", exact: true }).click();
  await dialog.getByRole("status").waitFor();
  assert.deepEqual(groups[0].item_ids, [1, 4, 3]);
  await dialog.getByRole("button", { name: "新建分组", exact: true }).click();
  await dialog.getByRole("textbox", { name: "分组名称" }).fill("观察池");
  await dialog.getByRole("button", { name: "新建分组", exact: true }).last().click();
  await dialog.getByRole("button", { name: "删除分组", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "删除分组", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "删除", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  await dialog.getByRole("button", { name: "关闭抽屉", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.getByRole("button", { name: "ATR(14)", exact: true }).click();
  await page.getByRole("button", { name: "OBV", exact: true }).click();
  await page.getByRole("button", { name: "ROC(12)", exact: true }).click();
  await page.getByRole("button", { name: "VOL MA", exact: true }).click();
  await page.reload(); await waitRows(4);
  await chips.getByText("样本：250根日K", { exact: true }).waitFor();
  assert.equal(await chips.getByRole("button", { name: "250根", exact: true }).getAttribute("aria-pressed"), "true");
  for (const name of ["ATR(14)", "OBV", "ROC(12)", "VOL MA"]) assert.equal(await page.getByRole("button", { name, exact: true }).getAttribute("aria-pressed"), "true");
  await painted(".technical-native-chart canvas");
  await maLines([5, 10, 20, 120, 250]);
  candleMode = "zero";
  await page.getByRole("button", { name: "周K", exact: true }).click();
  await chips.getByText("暂无有效成交量", { exact: true }).waitFor();
  assert.equal(await chips.locator(".chip-profile-ratio").count(), 0);
  candleMode = "flat";
  await page.getByRole("button", { name: "日K", exact: true }).click();
  await chips.getByText("100.0%", { exact: true }).waitFor();
  assert.equal(await chips.locator(".chip-profile-bin").count(), 1);
  assert.doesNotMatch(await chips.innerText(), /NaN|Infinity/);
  candleMode = "data";
  await page.getByRole("button", { name: "周K", exact: true }).click();
  await chips.getByText("样本：250根周K", { exact: true }).waitFor();
  await page.getByRole("button", { name: "日K", exact: true }).click();
  await chips.getByText("样本：250根日K", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "MA60", exact: true }).getAttribute("aria-pressed"), "false");
  for (const period of [120, 250]) assert.equal(await page.getByRole("button", { name: `MA${period}`, exact: true }).getAttribute("aria-pressed"), "true");
  candleCountLimit = 100;
  await page.getByRole("button", { name: "周K", exact: true }).click();
  await page.getByText("MA120 / MA250：历史数据不足，暂不绘制", { exact: true }).waitFor();
  await maLines([5, 10, 20]);
  candleCountLimit = 1000;
  await page.getByRole("button", { name: "日K", exact: true }).click();
  await maLines([5, 10, 20, 120, 250]);
  await page.screenshot({ path: "/tmp/stocks-watchlist-desktop.png" });
  const longGroupName = "长期观察公司与行业机会跟踪";
  groups = [...groups, { id: 9, name: longGroupName, item_ids: [] }];
  const mobile = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mobile.addInitScript(installCanvasProbe);
  await mobile.route("**/*", route); page = await mobile.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("slider", { name: "查看筹码价位", exact: true }).waitFor();
  await checkMobileMAs(mobile);
  for (const [width, height] of [[844, 390], [667, 375], [568, 320]]) {
    await page.setViewportSize({ width, height });
    await contained(".technical-chip-panel", 150);
    await page.locator(".chip-profile-chart").scrollIntoViewIfNeeded();
    await contained(".chip-profile-chart", 100);
    await page.getByRole("slider", { name: "查看筹码价位", exact: true }).tap();
    assert.match(await page.locator(".chip-profile-detail").textContent(), /占比/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  await page.screenshot({ path: "/tmp/stocks-chips-landscape.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".technical-chip-panel").scrollIntoViewIfNeeded();
  const portraitChart = await page.locator(".technical-native-chart").boundingBox();
  const portraitChips = await page.locator(".technical-chip-panel").boundingBox();
  assert.ok(portraitChart.y + portraitChart.height <= portraitChips.y + 1, "Portrait costs must be below the K-line chart");
  await page.screenshot({ path: "/tmp/stocks-chips-portrait.png" });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "资金", exact: true }).click();
  await page.locator(".capital-flow-canvas canvas").waitFor();
  for (const [width, height] of [[844, 390], [667, 375], [568, 320]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    await contained(".technical-capital-flow-panel"); await contained(".capital-flow-metrics");
    await contained(".capital-flow-canvas canvas", 100);
    await painted(".capital-flow-canvas canvas");
  }
  await page.screenshot({ path: "/tmp/stocks-capital-landscape.png" });
  flowMode = "empty"; await page.getByRole("button", { name: "刷新资金流向", exact: true }).click();
  await page.getByText("暂无资金流向数据", { exact: true }).waitFor(); await contained(".capital-flow-state", 100);
  flowMode = "error"; await page.getByRole("button", { name: "刷新资金流向", exact: true }).click();
  await page.getByText("Fixture unavailable", { exact: true }).waitFor(); await contained(".capital-flow-state", 100);
  flowMode = "data"; await page.getByRole("button", { name: "刷新资金流向", exact: true }).click();
  await page.locator(".capital-flow-canvas canvas").waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  assert.ok(await page.locator(".watchlist-list-shell").isVisible());
  const listRect = await page.locator(".watchlist-list-shell").boundingBox();
  const analysisRect = await page.locator(".watchlist-analysis-shell").boundingBox();
  assert.ok(listRect.y + listRect.height <= analysisRect.y, "portrait list must not overlap the chart");
  assert.equal(await page.locator(".watchlist-sortable-row").count(), 4);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole("tab", { name: longGroupName, exact: true }).click(); await waitRows(0);
  const tabsRect = await page.locator(".watchlist-group-tabs").boundingBox();
  const activeTabRect = await page.getByRole("tab", { name: longGroupName, exact: true }).boundingBox();
  assert.ok(activeTabRect.x >= tabsRect.x - 1 && activeTabRect.x + activeTabRect.width <= tabsRect.x + tabsRect.width + 1, "selected tab stays within the horizontal scroller");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole("tab", { name: "全部自选", exact: true }).click(); await waitRows(4);
  await editSwitch().tap();
  assert.equal(await page.locator(".watchlist-drag-handle").count(), 4);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: "/tmp/stocks-watchlist-editing-mobile.png" });
  await finishEdit();
  await page.screenshot({ path: "/tmp/stocks-watchlist-portrait.png", fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  console.log("PASS: group tabs and keyboard/mobile overflow, draft drag/sort, save on edit close, failure retry, persisted order/preferences, filtered-slot preservation; group CRUD, chart indicators, chips and capital-flow/rotation regressions.");
} catch (error) {
  if (page) console.error(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight, landscape: matchMedia("(orientation: landscape)").matches, coarse: matchMedia("(pointer: coarse)").matches, touch: navigator.maxTouchPoints })));
  if (page) await page.screenshot({ path: "/tmp/stocks-watchlist-failure.png", fullPage: true });
  throw error;
} finally { await browser.close(); }
