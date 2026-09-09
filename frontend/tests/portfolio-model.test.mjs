import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAssetSegments, buildHoldingSegments, buildTrendPoints, holdingPnl,
  localDateKey, parseNumber, portfolioStats, readPortfolioSnapshots,
  snapshotStorageKey, writePortfolioSnapshot,
} from "../src/components/portfolio/model.ts";

const holding = (overrides = {}) => ({
  id: 1, symbol: "AAPL.US", market: "US", shares: "10", cost_price: "100",
  current_price: "120", stock_value: "1200", change_value: "2", valuation_price_source: "live",
  ...overrides,
});

test("missing quotes and costs do not become false losses or gains", () => {
  const unavailable = holding({ current_price: null, stock_value: "1000", change_value: null, valuation_price_source: "cost" });
  const noCost = holding({ cost_price: null });
  assert.equal(holdingPnl(unavailable), null);
  assert.equal(holdingPnl(noCost), null);
  const stats = portfolioStats([holding(), unavailable, noCost]);
  assert.equal(stats.marketValue, 3400);
  assert.equal(stats.pnl, 200);
  assert.equal(stats.pnlRatio, 20);
  assert.equal(stats.missingPnlCount, 2);
  assert.equal(stats.dayPnl, 40);
  assert.equal(stats.dayMissingCount, 1);
  assert.equal(portfolioStats([unavailable]).pnl, null);
});

test("zero and fractional costs and share amounts remain valid", () => {
  assert.equal(holdingPnl(holding({ shares: "0.5", cost_price: "0" })), 60);
  assert.equal(holdingPnl(holding({ shares: "0" })), 0);
  assert.equal(portfolioStats([holding({ cost_price: "0" })]).pnlRatio, null);
  assert.equal(portfolioStats([]).pnl, 0);
  assert.equal(parseNumber("   "), null);
  assert.equal(parseNumber("NaN"), null);
  assert.equal(parseNumber("1,234.50"), 1234.5);
});

test("trend aggregation uses the last available day per period and preserves its date", () => {
  const snapshots = [
    { market: "US", date: "2026-09-08", total_assets: "103" },
    { market: "US", date: "2026-08-31", total_assets: "100" },
    { market: "US", date: "2026-09-01", total_assets: "101" },
    { market: "US", date: "2026-09-06", total_assets: "102" },
  ];
  assert.deepEqual(buildTrendPoints(snapshots, "week").map((point) => [point.date, point.value]), [["2026-09-06", 102], ["2026-09-08", 103]]);
  assert.deepEqual(buildTrendPoints(snapshots, "month").map((point) => [point.date, point.value]), [["2026-08-31", 100], ["2026-09-08", 103]]);
  assert.equal(buildTrendPoints([], "day").length, 0);
  assert.equal(buildTrendPoints(snapshots.slice(0, 1), "day").length, 1);
  assert.equal(localDateKey(new Date(2026, 8, 9, 0, 1)), "2026-09-09");
});

test("asset snapshots isolate accounts and markets and replace only today's entry", () => {
  const data = new Map();
  globalThis.window = { localStorage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } };
  try {
    writePortfolioSnapshot("US", "100", "alice");
    writePortfolioSnapshot("H", "200", "alice");
    writePortfolioSnapshot("US", "300", "bob");
    writePortfolioSnapshot("US", "110", "alice");
    assert.equal(readPortfolioSnapshots("US", "alice").length, 1);
    assert.equal(readPortfolioSnapshots("US", "alice")[0].total_assets, "110");
    assert.equal(readPortfolioSnapshots("H", "alice")[0].total_assets, "200");
    assert.equal(readPortfolioSnapshots("US", "bob")[0].total_assets, "300");
    assert.deepEqual(readPortfolioSnapshots("US", ""), []);
    data.set(snapshotStorageKey("broken"), '{"invalid": true}');
    assert.deepEqual(readPortfolioSnapshots("US", "broken"), []);
    data.set(snapshotStorageKey("bad-row"), '[null,{"market":"US","date":55,"total_assets":100}]');
    assert.deepEqual(readPortfolioSnapshots("US", "bad-row"), []);
  } finally { delete globalThis.window; }
});

test("allocation excludes unavailable values and sorts holdings by market value", () => {
  const segments = buildHoldingSegments([holding({ stock_value: null }), holding({ symbol: "MSFT.US", stock_value: "4000" }), holding({ symbol: "NVDA.US", stock_value: "2500" })]);
  assert.deepEqual(segments.map((item) => item.label), ["MSFT.US", "NVDA.US"]);
  const assets = buildAssetSegments("3500", 6500, { cashAsset: "Cash", equityAsset: "Stocks" });
  assert.equal(assets.reduce((sum, item) => sum + item.value, 0), 10000);
  assert.deepEqual(buildAssetSegments("0", 0, { cashAsset: "Cash", equityAsset: "Stocks" }), []);
});
