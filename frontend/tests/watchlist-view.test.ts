import assert from "node:assert/strict";
import { test } from "node:test";
import { filterWatchlist, matchesCompany, quoteNumber, reorderVisibleItems } from "../src/lib/watchlist-view";
import type { WatchlistItem } from "../src/types/app";

const row = (id: number, values: Partial<WatchlistItem>): WatchlistItem => ({ id, symbol: `S${id}.US`, category: "US", name: "",
  name_cn: "", name_hk: "", name_en: "", exchange: "", currency: "USD", last_done: null, change_value: null,
  change_rate: null, note: "", created_at: "", updated_at: "", ...values });
const items = [row(1, { symbol: "AAPL.US", name: "苹果", name_en: "Apple Inc", change_rate: "2.50%" }),
  row(2, { symbol: "700.HK", category: "H", name: "腾讯", change_rate: "-3%" }),
  row(3, { symbol: "MSFT.US", name: "微软", change_rate: null }), row(4, { symbol: "NVDA.US", change_rate: "0.00" })];
const groups = [{ id: 1, name: "核心", item_ids: [1, 2] }, { id: 2, name: "科技", item_ids: [1, 4] }];
const options = { market: "all", group: "all", query: "", sort: "manual" } as const;

test("market, group and multilingual keywords intersect; empty groups stay empty", () => {
  assert.deepEqual(filterWatchlist(items, groups, { ...options, market: "US", group: 1, query: "  APPLE aapl  " }).map((item) => item.id), [1]);
  assert.ok(matchesCompany(items[0], "ａａｐｌ 苹果"));
  assert.deepEqual(filterWatchlist(items, groups, { ...options, group: "ungrouped" }).map((item) => item.id), [3]);
  assert.deepEqual(filterWatchlist(items, groups, { ...options, group: 99 }), []);
  assert.deepEqual(filterWatchlist(items, groups, { ...options, query: "no match" }), []);
});

test("sorting handles percentages, negative/zero/missing quotes without mutating manual order", () => {
  assert.equal(quoteNumber("NaN"), null);
  assert.equal(quoteNumber("%"), null);
  assert.equal(quoteNumber(" "), null);
  assert.equal(quoteNumber("1,234.5"), 1234.5);
  assert.deepEqual(filterWatchlist(items, groups, { ...options, sort: "gainers" }).map((item) => item.id), [1, 4, 2, 3]);
  assert.deepEqual(filterWatchlist(items, groups, { ...options, sort: "losers" }).map((item) => item.id), [2, 4, 1, 3]);
  assert.deepEqual(items.map((item) => item.id), [1, 2, 3, 4]);
});

test("filtered drag keeps all hidden companies in their original slots", () => {
  assert.deepEqual(reorderVisibleItems(items, [4, 1]), [4, 2, 3, 1]);
  assert.deepEqual(reorderVisibleItems(items, []), [1, 2, 3, 4]);
});
