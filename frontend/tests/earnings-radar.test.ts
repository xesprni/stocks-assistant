import test from "node:test";
import assert from "node:assert/strict";
import { EarningsRadarController, parseRadarSymbols, resolveRadarSelection } from "../src/lib/earnings-radar-controller";
import { earningsHtml } from "../src/lib/earnings-radar-export";
import { optionDiagnosticText, radarHistory } from "../src/lib/earnings-radar-presentation";
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

test("recent events without release times remain visible in both report languages", () => {
  const report = fixture("TSM.US");
  report.items[0].history_events = [
    { date: "2025-01-14", period: "FY2024 Q4", timing: "after_close", move: null, exclusion_reason: "missing_prices" },
    { date: "2025-01-16", period: "FY2024 Annual", timing: "after_close", move: null, exclusion_reason: "missing_prices" },
    { date: "2026-07-15", period: "FY2026 Q2 <script>unsafe</script>", timing: "unknown", move: null, exclusion_reason: "unknown_timing" },
  ];
  assert.equal(radarHistory(report.items[0]).length, 3);
  for (const language of ["en", "zh"] as const) {
    const html = earningsHtml(report, language);
    assert.ok(html.includes("2026-07-15"));
    assert.ok(html.includes("FY2024 Q4") && html.includes("FY2024 Annual"));
    assert.ok(html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("0.00%"));
    assert.ok(html.includes(language === "en" ? "Release time missing; excluded" : "披露时段缺失，未计入"));
    assert.ok(html.includes(language === "en" ? "3 dates retrieved; 0 measurable reactions" : "已获取 3 个日期，其中 0 个可计算"));
  }
});

test("option error 500 is shown with its stage rather than an unsupported permission claim", () => {
  const report = fixture();
  report.items[0].issues = ["options_request_failed"];
  const diagnostic = { stage: "quote", reason: "upstream_error", expiry: "2026-10-16", error_code: 500 } as const;
  report.items[0].option_diagnostics = [diagnostic];
  assert.equal(optionDiagnosticText(diagnostic, "en"), "2026-10-16 · Option quotes · Upstream service error · Error code 500");
  for (const language of ["en", "zh"] as const) {
    const html = earningsHtml(report, language);
    assert.ok(html.includes(language === "en" ? "Error code 500" : "错误码 500"));
    assert.ok(!html.includes("missing options permissions") && !html.includes("权限不足"));
  }
});

test("older scan responses remain renderable without new diagnostic fields", () => {
  const item = fixture().items[0];
  const move = { date: "2025-01-16", timing: "after_close", period: "FY2024 Annual", before_date: "2025-01-16", after_date: "2025-01-17", before_close: "100", after_close: "101", move_pct: 1 } as const;
  item.history = [move];
  assert.deepEqual(radarHistory(item), [{ date: move.date, timing: move.timing, period: move.period, move, exclusion_reason: null }]);
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

test("ticker selection includes the draft, deduplicates pasted lines and enforces US limits", () => {
  assert.deepEqual(resolveRadarSelection(["MU.US"], "nvda\nMU, brk.b"), {
    symbols: ["MU.US", "NVDA.US", "BRK.B.US"], valid: true,
  });
  assert.deepEqual(resolveRadarSelection([], "MU"), { symbols: ["MU.US"], valid: true });
  assert.equal(resolveRadarSelection(["MU.US"], "700.HK").valid, false);
  assert.equal(resolveRadarSelection([], "").valid, false);
  assert.equal(resolveRadarSelection([], "<script>").valid, false);
  const full = Array.from({ length: 20 }, (_, i) => `STOCK${i}.US`);
  assert.equal(resolveRadarSelection(full, "STOCK0").valid, true);
  assert.equal(resolveRadarSelection(full, "AAPL").valid, false);
  assert.equal(resolveRadarSelection([], "X".repeat(25)).valid, false);
});
