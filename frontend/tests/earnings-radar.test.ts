import test from "node:test";
import assert from "node:assert/strict";
import { EarningsRadarController, parseRadarSymbols } from "../src/lib/earnings-radar-controller";
import { earningsHtml } from "../src/lib/earnings-radar-export";
import type { EarningsRadarResponse } from "../src/types/earnings";

function fixture(symbol = "AAPL.US"): EarningsRadarResponse {
  return { source: "Longbridge fixture", timezone: "America/New_York", as_of: "2026-10-09T12:00:00Z", window_start: "2026-10-09", window_end: "2026-11-23", history_start: "2023-10-09", items: [{ symbol, name: '<script>alert("x")</script>', status: "partial", spot: "100.001", spot_timestamp: null, next_event: null, option: null, history: [], sample_count: 0, historical_median_pct: null, hv30_pct: null, ratio: null, valuation: "unavailable", issues: ["options_unavailable"] }] };
}
const watchlist = async () => ({ items: [], total: 0 });
test("normalizes and deduplicates symbols without disguising another market", () => {
  assert.deepEqual(parseRadarSymbols("aapl, AAPL.US，brk.b MSFT;700.HK"), ["AAPL.US", "BRK.B.US", "MSFT.US", "700.HK"]);
  assert.deepEqual(parseRadarSymbols(" \n "), []);
});
test("cancelled, superseded and disposed scans cannot publish late responses", async () => {
  const pending: Array<(value: EarningsRadarResponse) => void> = [];
  const signals: AbortSignal[] = [];
  const controller = new EarningsRadarController((_body, init) => { signals.push(init.signal!); return new Promise((resolve) => pending.push(resolve)); }, watchlist);
  const first = controller.run({ symbols: ["AAPL.US"], days_ahead: 45 });
  const second = controller.run({ symbols: ["MSFT.US"], days_ahead: 45 });
  assert.equal(signals[0].aborted, true);
  pending[0](fixture()); await first;
  assert.equal(controller.snapshot().result, null);
  pending[1](fixture("MSFT.US")); await second;
  assert.equal(controller.snapshot().result?.items[0].symbol, "MSFT.US");
  const cancelled = controller.run({ symbols: ["AAPL.US"], days_ahead: 45 });
  controller.cancel(); pending[2](fixture()); await cancelled;
  assert.equal(controller.snapshot().result, null);
  const disposed = controller.run({ symbols: ["AAPL.US"], days_ahead: 45 });
  controller.dispose(); pending[3](fixture()); await disposed;
  assert.equal(controller.snapshot().result, null);
});
test("failed scans clear pending state and retry succeeds", async () => {
  let fail = true;
  const controller = new EarningsRadarController(async () => { if (fail) throw new Error("Unavailable"); return fixture(); }, watchlist);
  await controller.run({ symbols: ["AAPL.US"], days_ahead: 45 });
  assert.equal(controller.snapshot().loading, false);
  assert.equal(controller.snapshot().error, "Unavailable");
  fail = false;
  await controller.run({ symbols: ["AAPL.US"], days_ahead: 45 });
  assert.equal(controller.snapshot().error, "");
  assert.equal(controller.snapshot().result?.items.length, 1);
});
test("HTML exports escape markup and preserve precision, missing values and provenance", () => {
  const report = fixture();
  const html = earningsHtml(report, "zh");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes(report.source));
  assert.ok(html.includes("America/New_York"));
  assert.ok(html.includes("暂无法比较"));
  assert.ok(html.includes("100.001"));
  assert.ok(html.includes("2026-10-09T12:00:00Z"));
});

test("calendar failure does not export a false no-upcoming-earnings conclusion", () => {
  const report = fixture();
  report.items[0].issues = ["upcoming_calendar_unavailable"];
  assert.ok(!earningsHtml(report, "en").includes("No upcoming earnings in window"));
});

test("closing and reopening the picker ignores a late watchlist response", async () => {
  const pending: Array<(value: { items: []; total: number }) => void> = [];
  const signals: AbortSignal[] = [];
  const controller = new EarningsRadarController(async () => fixture(), (_category, init) => {
    signals.push(init.signal!);
    return new Promise((resolve) => pending.push(resolve));
  });
  const first = controller.loadWatchlist();
  controller.cancelWatchlist();
  assert.equal(signals[0].aborted, true);
  assert.equal(controller.snapshot().importing, false);
  const second = controller.loadWatchlist();
  pending[0]({ items: [], total: 0 }); await first;
  assert.equal(controller.snapshot().importing, true);
  pending[1]({ items: [], total: 0 }); await second;
  assert.equal(controller.snapshot().importing, false);
  assert.deepEqual(controller.snapshot().watchlistItems, []);
});

test("watchlist errors are isolated from scan results and can be retried", async () => {
  let fail = true;
  const controller = new EarningsRadarController(async () => fixture(), async () => {
    if (fail) throw new Error("Watchlist unavailable");
    return { items: [], total: 0 };
  });
  await controller.run({ symbols: ["AAPL.US"], days_ahead: 45 });
  await controller.loadWatchlist();
  assert.equal(controller.snapshot().watchlistError, "Watchlist unavailable");
  assert.equal(controller.snapshot().error, "");
  assert.equal(controller.snapshot().result?.items[0].symbol, "AAPL.US");
  fail = false;
  await controller.loadWatchlist();
  assert.equal(controller.snapshot().watchlistError, "");
  assert.equal(controller.snapshot().importing, false);
});
