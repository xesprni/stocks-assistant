import type { PortfolioItem, PortfolioMarket } from "@/types/app";

export type PortfolioTrendRange = "day" | "week" | "month";
export type PortfolioAssetSnapshot = { market: PortfolioMarket; date: string; total_assets: string };
export type PortfolioTrendPoint = { label: string; date: string; value: number };
export type PortfolioPieSegment = { label: string; value: number; displayValue: string; color: string };
export const PORTFOLIO_COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#0ea5e9", "#a855f7", "#f97316", "#ec4899", "#84cc16"];

export function parseNumber(value: string | number | null | undefined) {
  if (value == null || String(value).trim() === "") return null;
  const numeric = Number(String(value).replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatMoney(value: string | number | null | undefined) {
  const number = parseNumber(value);
  return number == null ? "—" : number.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function holdingPnl(item: PortfolioItem): number | null {
  const shares = parseNumber(item.shares);
  const price = parseNumber(item.current_price);
  const cost = parseNumber(item.cost_price);
  // 成本估值不能当成实时盈亏，缺失行情/成本也不能按零处理。
  return shares != null && price != null && cost != null ? (price - cost) * shares : null;
}

export function portfolioStats(items: PortfolioItem[]) {
  let marketValue = 0;
  let costValue = 0;
  let pnl = 0;
  let pricedCount = 0;
  let missingPnlCount = 0;
  let dayPnl = 0;
  let dayPricedCount = 0;
  for (const item of items) {
    marketValue += parseNumber(item.stock_value) ?? 0;
    const shares = parseNumber(item.shares);
    const cost = parseNumber(item.cost_price);
    const itemPnl = holdingPnl(item);
    if (itemPnl != null) {
      pnl += itemPnl;
      costValue += (shares ?? 0) * (cost ?? 0);
      pricedCount += 1;
    } else if (shares == null || shares > 0) {
      missingPnlCount += 1;
    }
    const change = parseNumber(item.change_value);
    if (shares != null && change != null) {
      dayPnl += shares * change;
      dayPricedCount += 1;
    }
  }
  return {
    marketValue, costValue, missingPnlCount,
    pnl: pricedCount ? pnl : items.length === 0 ? 0 : null,
    pnlRatio: costValue > 0 ? (pnl / costValue) * 100 : null,
    dayPnl: dayPricedCount ? dayPnl : items.length === 0 ? 0 : null,
    dayMissingCount: items.filter((item) => (parseNumber(item.shares) ?? 1) > 0 && parseNumber(item.change_value) == null).length,
  };
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function snapshotStorageKey(userId: string) {
  return `stocks-assistant.portfolio.asset-snapshots.v2.${encodeURIComponent(userId)}`;
}

function validSnapshots(value: unknown): PortfolioAssetSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PortfolioAssetSnapshot => item != null
    && ["US", "A", "H"].includes(item.market)
    && typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    && parseNumber(item.total_assets) != null);
}

export function readPortfolioSnapshots(market: PortfolioMarket, userId: string): PortfolioAssetSnapshot[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    return validSnapshots(JSON.parse(window.localStorage.getItem(snapshotStorageKey(userId)) ?? "[]"))
      .filter((item) => item.market === market).sort((a, b) => a.date.localeCompare(b.date));
  } catch { return []; }
}

export function writePortfolioSnapshot(market: PortfolioMarket, totalAssets: string, userId: string): PortfolioAssetSnapshot[] {
  if (typeof window === "undefined" || !userId || parseNumber(totalAssets) == null) return [];
  try {
    const key = snapshotStorageKey(userId);
    const snapshots = validSnapshots(JSON.parse(window.localStorage.getItem(key) ?? "[]"));
    const today = localDateKey();
    const next = [...snapshots.filter((item) => !(item.market === market && item.date === today)), { market, date: today, total_assets: totalAssets }]
      .sort((a, b) => a.date.localeCompare(b.date)).slice(-2200);
    window.localStorage.setItem(key, JSON.stringify(next));
    return next.filter((item) => item.market === market);
  } catch { return readPortfolioSnapshots(market, userId); }
}

export function buildTrendPoints(snapshots: PortfolioAssetSnapshot[], range: PortfolioTrendRange): PortfolioTrendPoint[] {
  const grouped = new Map<string, PortfolioAssetSnapshot>();
  for (const snapshot of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    let key = snapshot.date;
    if (range === "month") key = key.slice(0, 7);
    if (range === "week") {
      const monday = new Date(`${snapshot.date}T12:00:00`);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      key = localDateKey(monday);
    }
    grouped.set(key, snapshot);
  }
  return Array.from(grouped.values()).map((snapshot) => ({
    label: snapshot.date.slice(5).replace("-", "/"), date: snapshot.date, value: parseNumber(snapshot.total_assets)!,
  })).slice(range === "day" ? -30 : -12);
}

export function buildHoldingSegments(items: PortfolioItem[]): PortfolioPieSegment[] {
  return items.map((item, index) => ({
    label: item.symbol, value: parseNumber(item.stock_value) ?? 0,
    displayValue: formatMoney(item.stock_value), color: PORTFOLIO_COLORS[index % PORTFOLIO_COLORS.length],
  })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
}

export function buildAssetSegments(cash: string, marketValue: number, copy: { cashAsset: string; equityAsset: string }): PortfolioPieSegment[] {
  return [
    { label: copy.equityAsset, value: marketValue, displayValue: formatMoney(marketValue), color: "#6366f1" },
    { label: copy.cashAsset, value: parseNumber(cash) ?? 0, displayValue: formatMoney(cash), color: "#14b8a6" },
  ].filter((item) => item.value > 0);
}
