import type { WatchlistGroup, WatchlistItem, WatchlistMarket } from "@/types/app";

export type WatchlistSort = "manual" | "name" | "gainers" | "losers";
export type WatchlistGroupFilter = "all" | "ungrouped" | number;

export function quoteNumber(value: string | null | undefined): number | null {
  if (value == null || !value.trim()) return null;
  const normalized = value.replace(/[%％,]/g, "").trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function matchesCompany(item: WatchlistItem, query: string) {
  const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
  const text = normalize([item.symbol, item.name, item.name_cn, item.name_hk, item.name_en].join(" "));
  return normalize(query).trim().split(/\s+/).every((token) => text.includes(token));
}

export function filterWatchlist(items: WatchlistItem[], groups: WatchlistGroup[], options: {
  market: WatchlistMarket; group: WatchlistGroupFilter; query: string; sort: WatchlistSort;
}) {
  const grouped = new Set(groups.flatMap((group) => group.item_ids));
  const members = new Set(groups.find((group) => group.id === options.group)?.item_ids ?? []);
  const result = items.filter((item) => (options.market === "all" || item.category === options.market)
    && (options.group === "all" || (options.group === "ungrouped" ? !grouped.has(item.id) : members.has(item.id)))
    && matchesCompany(item, options.query));
  if (options.sort === "manual") return result;
  return result.sort((a, b) => {
    if (options.sort === "name") return (a.name || a.symbol).localeCompare(b.name || b.symbol, "zh-Hans-CN", { numeric: true });
    const left = quoteNumber(a.change_rate), right = quoteNumber(b.change_rate);
    // 缺失行情始终排在末尾，不能将停牌或未加载的数据当作零涨跌。
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    return options.sort === "gainers" ? right - left : left - right;
  });
}

/** 只替换当前可见公司的排序槽位，保留其他市场及分组的顺序。 */
export function reorderVisibleItems(items: WatchlistItem[], orderedVisibleIds: number[]) {
  const visible = new Set(orderedVisibleIds);
  let index = 0;
  return items.map((item) => visible.has(item.id) ? orderedVisibleIds[index++] : item.id);
}
