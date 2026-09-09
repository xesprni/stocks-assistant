// Optional integration test: install Playwright or supply PLAYWRIGHT_MODULE_PATH.
// All API traffic is served by this in-memory fixture; no real backend/account is contacted.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const compiled = await build({ entryPoints: [new URL("./strict-mode-fixture.tsx", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", sourcemap: "inline",
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"development"' },
  tsconfig: new URL("../../tsconfig.app.json", import.meta.url).pathname,
  plugins: [{ name: "isolate-unrelated-chart", setup(builder) {
    builder.onResolve({ filter: /components\/TechnicalAnalysis$/ }, () => ({ path: "chart", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export default function Chart() { return null; }", loader: "js" }));
  } }],
});
const bundle = compiled.outputFiles[0].text;
const calls = [], failures = [];
let order = [1, 2, 3];
const stock = (id, category = "US") => ({ id, symbol: `${["AAPL", "MSFT", "NVDA"][id - 1]}.${category}`, category,
  name: ["Apple", "Microsoft", "Nvidia"][id - 1], name_en: "", name_cn: "", name_hk: "", exchange: "NASDAQ", currency: "USD",
  last_done: "100", change_value: "1", change_rate: "1", note: "", created_at: "2026-09-09T01:00:00Z", updated_at: "2026-09-09T01:00:00Z" });
const session = { id: "session", title: "Fixture research", created_at: "2026-09-09T01:00:00Z", updated_at: "2026-09-09T01:00:00Z", message_count: 0, messages: [], inputs: [], active_run: null };
const document = (symbol) => ({ id: `${symbol}-doc`, symbol, title: `${symbol} filing`, document_type: "filing", latest_version: 1,
  updated_at: "2026-09-09T01:00:00Z", versions: [] });
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://fixture");
  const json = (value, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
  if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end('<!doctype html><html><head><style>body{font:14px sans-serif;margin:24px}svg{width:16px;height:16px}button{margin:4px;padding:8px}.watchlist-sortable-row{width:340px;height:84px;border:1px solid #aaa;margin:8px;padding:8px}.watchlist-sortable-row>div{display:flex;align-items:center;gap:12px}input,textarea{display:block;margin:8px;padding:8px}nav{margin-bottom:24px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
  if (url.pathname === "/fixture.js") { response.writeHead(200, { "Content-Type": "application/javascript" }); response.end(bundle); return; }
  if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  let body = ""; for await (const chunk of request) body += chunk;
  const payload = body ? JSON.parse(body) : undefined;
  calls.push({ method: request.method, path: url.pathname, payload });
  if (url.pathname === "/api/v1/watchlist" && request.method === "GET") { json({ items: order.map((id) => stock(id, url.searchParams.get("category") || "US")), total: 3 }); return; }
  if (url.pathname === "/api/v1/watchlist/overview") { json({ items: order.map((id) => stock(id)), quote_error: null, error: null }); return; }
  if (url.pathname === "/api/v1/watchlist/reorder") { order = payload.ids; json({ status: "ok" }); return; }
  const listDocuments = url.pathname.match(/^\/api\/v1\/research\/security\/([^/]+)\/documents$/);
  if (listDocuments) { if (listDocuments[1] === "AAPL.US") await new Promise((resolve) => setTimeout(resolve, 200)); json([document(listDocuments[1])]); return; }
  if (url.pathname === "/api/v1/agent/sessions" && request.method === "GET") { json({ sessions: [session], total: 1 }); return; }
  if (url.pathname === "/api/v1/agent/sessions/session") { json(session); return; }
  if (url.pathname === "/api/v1/agent/stream") {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const event = (type, event_id, data) => response.write(`data: ${JSON.stringify({ type, event_id, run_id: "fixture-run", data })}\n\n`);
    event("run_started", 1, { request_id: payload.request_id });
    event("message_update", 2, { delta: "Fixture answer" });
    session.messages = [{ id: "run-user:fixture-run", role: "user", content: payload.message, created_at: session.created_at },
      { id: "assistant-fixture", role: "assistant", content: "Fixture answer", created_at: session.created_at }];
    session.message_count = 2;
    event("agent_end", 3, { message_id: "assistant-fixture", final_response: "Fixture answer", sources: [] });
    response.end(); return;
  }
  failures.push(`${request.method} ${url.pathname}`); json({ detail: "Unexpected fixture request" }, 500);
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("Browser error:", error.message); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/*", async (route) => {
    if (route.request().url().startsWith(origin)) await route.continue();
    else { failures.push(`External request: ${route.request().url()}`); await route.abort(); }
  });
  await page.goto(origin);
  await page.locator(".watchlist-sortable-row").first().waitFor();
  assert.equal(await page.evaluate(() => window.strictMounts), 2, "development StrictMode replays mount effects");
  const first = page.locator(".watchlist-drag-handle").first();
  const second = page.locator(".watchlist-drag-handle").nth(1);
  const from = await first.boundingBox(), to = await second.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".watchlist-sortable-row")?.textContent.includes("MSFT.US"));
  assert.equal(calls.filter((call) => call.path.endsWith("/reorder")).length, 1, "one drag causes exactly one mutation under StrictMode");
  await page.waitForFunction(() => !document.querySelector('[data-dragging="true"]'));
  // dnd-kit's pointer sensor intentionally suppresses document clicks for 50 ms after drag end.
  await page.waitForTimeout(75);
  await page.getByRole("button", { name: "documents", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Switch company", exact: true }).click();
  await page.getByRole("button", { name: /MSFT.US filing/ }).waitFor();
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole("button", { name: /AAPL.US filing/ }).count(), 0);
  await page.getByRole("button", { name: "chat", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="chat-ready"]')?.textContent === "Ready");
  await page.getByRole("textbox", { name: "Prompt" }).fill("Fixture question");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText("assistant: Fixture answer", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-pending="true"]').length === 0);
  assert.equal(calls.filter((call) => call.path === "/api/v1/agent/stream").length, 1);
  assert.equal(await page.getByText("user: Fixture question", { exact: true }).count(), 1);
  assert.equal(await page.getByText("assistant: Fixture answer", { exact: true }).count(), 1);
  if (process.env.STRICT_MODE_SCREENSHOT) await page.screenshot({ path: process.env.STRICT_MODE_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log("PASS: StrictMode double mount, one drag/one reorder, company response isolation, one chat submission and persisted assistant; no external requests or page errors.");
} catch (error) {
  if (process.env.STRICT_MODE_SCREENSHOT && page) await page.screenshot({ path: process.env.STRICT_MODE_SCREENSHOT, fullPage: true });
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
