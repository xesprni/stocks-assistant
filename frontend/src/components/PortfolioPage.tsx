import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Eye,
  EyeOff,
  FileText,
  History,
  Loader2,
  Pencil,
  PieChart,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";

import { Field } from "@/components/common/Field";
import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { SideDrawer } from "@/components/common/SideDrawer";
import { useErrorToast } from "@/components/common/Toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  addPortfolioItem,
  deletePortfolioItem,
  listPortfolio,
  listPortfolioTransactions,
  savePortfolioSettings,
  searchPortfolioSymbols,
  sellPortfolioItem,
  updatePortfolioItem,
} from "@/lib/api";
import { readStoredBoolean, readStoredValue, writeStoredBoolean, writeStoredValue } from "@/lib/local-storage";
import { cn } from "@/lib/utils";
import type { PortfolioItem, PortfolioItemDraft, PortfolioMarket, PortfolioSearchResult, PortfolioTransaction } from "@/types/app";

type AppLanguage = "zh" | "en";

const copyByLanguage = {
  zh: {
    common: {
      add: "添加",
      cancel: "取消",
      delete: "删除",
      save: "保存",
    },
    markets: {
      us: "美股",
      a: "A股",
      usPlaceholder: "AAPL / MSFT",
      aPlaceholder: "600519 / 000001",
    },
    portfolio: {
      title: "持仓列表",
      subtitle: "本地持仓 CRUD，实时补充现价、PE、涨跌与资产占比",
      cash: "现金数",
      saveCash: "现金",
      totalAssets: "总资产",
      marketValue: "持仓市值",
      cashRatio: "现金占比",
      positionCount: "持仓数",
      totalPnl: "总盈亏",
      overview: "总览",
      charts: "图表",
      manage: "管理",
      trendDay: "日",
      trendWeek: "周",
      trendMonth: "月",
      assetTrend: "资产走势",
      holdingDistribution: "持仓分布",
      assetAllocation: "资产占比",
      cashAsset: "现金",
      equityAsset: "股票",
      management: "组合管理",
      tradeHistory: "交易历史",
      transactionTime: "时间",
      transactionSide: "方向",
      transactionAmount: "成交额",
      realizedPnl: "已实现盈亏",
      sellHolding: "卖出持仓",
      sellShares: "卖出股数",
      sellPrice: "卖出价",
      sellFailed: "卖出失败",
      sell: "卖出",
      noTransactions: "暂无交易记录",
      updatedAt: "更新于 {time}",
      quoteUnavailable: "行情字段暂不可用：{message}",
      loadFailed: "加载持仓失败",
      realtimeRefresh: "实时刷新",
      refreshCountdown: "{seconds}s 后刷新",
      manualRefresh: "手动刷新",
      refresh: "刷新",
      saveCashFailed: "保存现金数失败",
      enterSymbol: "请输入股票代码",
      saveFailed: "保存持仓失败",
      deleteConfirm: "删除持仓 {symbol}？",
      deleteFailed: "删除持仓失败",
      searchFailed: "Longbridge 搜索失败",
      noMatch: "未找到匹配标的，可以直接手动输入完整代码。",
      addHolding: "新增持仓",
      adjustHolding: "调整持仓",
      adjustHint: "只更新本地持仓，不发起交易。",
      adjustMode: "调整方式",
      adjustIncrease: "增加",
      adjustDecrease: "减少",
      adjustSet: "设为",
      currentShares: "当前股数",
      adjustShares: "调整股数",
      adjustPrice: "参考价",
      adjustedShares: "调整后股数",
      adjustedCost: "调整后成本",
      adjustInvalid: "请输入有效股数",
      adjustNegative: "调整后股数不能小于 0",
      adjustFailed: "调整持仓失败",
      editHolding: "编辑持仓",
      formHint: "股数和成本价可留空；选择搜索结果后会用现价预估市值。",
      stockCode: "股票代码",
      searchCode: "搜索代码",
      shares: "持有股数",
      costPrice: "成本价",
      optional: "可选",
      note: "备注",
      notePlaceholder: "策略、买入理由、风险点",
      currentPrice: "现价",
      stockValue: "股票总价",
      assetRatio: "资产占比",
      pnl: "盈亏",
      pe: "PE",
      pnlRatio: "盈亏比例",
      dayChange: "当日涨跌",
      actions: "操作",
      emptyTitle: "暂无持仓",
      emptyHint: "点击“新增”添加 {market} 持仓。",
      analyze: "分析股票",
      financials: "查看财报",
      edit: "编辑持仓",
      delete: "删除持仓",
      sortAsc: "升序排序",
      sortDesc: "降序排序",
      hideSensitive: "隐藏敏感数据",
      showSensitive: "显示敏感数据",
    },
  },
  en: {
    common: {
      add: "Add",
      cancel: "Cancel",
      delete: "Delete",
      save: "Save",
    },
    markets: {
      us: "US",
      a: "A-shares",
      usPlaceholder: "AAPL / MSFT",
      aPlaceholder: "600519 / 000001",
    },
    portfolio: {
      title: "Portfolio",
      subtitle: "Local portfolio CRUD with realtime price, PE, change, and asset allocation",
      cash: "Cash",
      saveCash: "Cash",
      totalAssets: "Total assets",
      marketValue: "Market value",
      cashRatio: "Cash %",
      positionCount: "Positions",
      totalPnl: "Total P&L",
      overview: "Overview",
      charts: "Charts",
      manage: "Manage",
      trendDay: "Day",
      trendWeek: "Week",
      trendMonth: "Month",
      assetTrend: "Asset trend",
      holdingDistribution: "Holding mix",
      assetAllocation: "Asset allocation",
      cashAsset: "Cash",
      equityAsset: "Stocks",
      management: "Portfolio management",
      tradeHistory: "Trade history",
      transactionTime: "Time",
      transactionSide: "Side",
      transactionAmount: "Amount",
      realizedPnl: "Realized P&L",
      sellHolding: "Sell holding",
      sellShares: "Sell shares",
      sellPrice: "Sell price",
      sellFailed: "Failed to sell holding",
      sell: "Sell",
      noTransactions: "No transactions yet",
      updatedAt: "updated at {time}",
      quoteUnavailable: "Market fields unavailable: {message}",
      loadFailed: "Failed to load portfolio",
      realtimeRefresh: "Live refresh",
      refreshCountdown: "refresh in {seconds}s",
      manualRefresh: "Manual refresh",
      refresh: "Refresh",
      saveCashFailed: "Failed to save cash",
      enterSymbol: "Enter a stock symbol",
      saveFailed: "Failed to save holding",
      deleteConfirm: "Delete holding {symbol}?",
      deleteFailed: "Failed to delete holding",
      searchFailed: "Longbridge search failed",
      noMatch: "No matching symbol found. You can enter the full symbol manually.",
      addHolding: "Add holding",
      adjustHolding: "Adjust holding",
      adjustHint: "Updates local portfolio records only. It does not place trades.",
      adjustMode: "Adjustment",
      adjustIncrease: "Increase",
      adjustDecrease: "Decrease",
      adjustSet: "Set to",
      currentShares: "Current shares",
      adjustShares: "Shares",
      adjustPrice: "Reference price",
      adjustedShares: "Adjusted shares",
      adjustedCost: "Adjusted cost",
      adjustInvalid: "Enter a valid share amount",
      adjustNegative: "Adjusted shares cannot be below 0",
      adjustFailed: "Failed to adjust holding",
      editHolding: "Edit holding",
      formHint: "Shares and cost are optional. Selecting a search result previews value from the live price.",
      stockCode: "Symbol",
      searchCode: "Search symbol",
      shares: "Shares",
      costPrice: "Cost",
      optional: "Optional",
      note: "Note",
      notePlaceholder: "Strategy, thesis, risks",
      currentPrice: "Current",
      stockValue: "Stock value",
      assetRatio: "Asset %",
      pnl: "P&L",
      pe: "PE",
      pnlRatio: "P&L %",
      dayChange: "Day change",
      actions: "Actions",
      emptyTitle: "No holdings",
      emptyHint: "Click Add to create a {market} holding.",
      analyze: "Analyze stock",
      financials: "Open financials",
      edit: "Edit holding",
      delete: "Delete holding",
      sortAsc: "Sort ascending",
      sortDesc: "Sort descending",
      hideSensitive: "Hide sensitive data",
      showSensitive: "Show sensitive data",
    },
  },
} satisfies Record<AppLanguage, Record<string, unknown>>;

type PortfolioSortKey =
  | "symbol"
  | "pe_ttm_ratio"
  | "cost_price"
  | "current_price"
  | "stock_value"
  | "position_ratio"
  | "pnl_ratio"
  | "change_rate"
  | "note";

type PortfolioAdjustMode = "increase" | "decrease" | "set";
type PortfolioViewMode = "overview" | "chart" | "manage";
type PortfolioTrendRange = "day" | "week" | "month";

type PortfolioAdjustmentDraft = {
  mode: PortfolioAdjustMode;
  shares: string;
  price: string;
};

type PortfolioSellDraft = {
  shares: string;
  price: string;
  note: string;
};

type PortfolioAdjustmentPreview = {
  currentShares: number;
  nextShares: number | null;
  nextCost: number | null;
  error: "invalid" | "negative" | null;
};

type PortfolioAssetSnapshot = {
  market: PortfolioMarket;
  date: string;
  total_assets: string;
};

type PortfolioPieSegment = {
  label: string;
  value: number;
  displayValue: string;
  color: string;
};

type PortfolioTrendPoint = {
  label: string;
  value: number;
};

function formatTemplate(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function getPortfolioMarkets(language: AppLanguage): Array<{ id: PortfolioMarket; label: string; hint: string; placeholder: string }> {
  const markets = copyByLanguage[language].markets;
  return [
    { id: "US", label: markets.us, hint: "USD", placeholder: markets.usPlaceholder },
    { id: "A", label: markets.a, hint: "CNY", placeholder: markets.aPlaceholder },
  ];
}

function emptyPortfolioDraft(market: PortfolioMarket): PortfolioItemDraft {
  return {
    market,
    symbol: "",
    name: "",
    shares: "",
    cost_price: "",
    note: "",
  };
}

function cleanOptional(value?: string | null) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function parseNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const numeric = Number(String(value).replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPlain(value: string | number | null | undefined) {
  if (value == null || value === "") return "-";
  return String(value);
}

function formatMoney(value: string | number | null | undefined) {
  const numeric = parseNumber(value);
  if (numeric == null) return "-";
  return numeric.toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

function formatSignedMoney(value: string | number | null | undefined) {
  const numeric = parseNumber(value);
  if (numeric == null) return "-";
  return `${numeric > 0 ? "+" : ""}${formatMoney(numeric)}`;
}

function formatPercent(value: string | number | null | undefined) {
  const numeric = parseNumber(value);
  if (numeric == null) return "-";
  return `${numeric.toFixed(2)}%`;
}

function formatSignedPercent(value: string | number | null | undefined) {
  const numeric = parseNumber(value);
  if (numeric == null) return "-";
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatDraftDecimal(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return String(Number(value.toFixed(8)));
}

function formatDateTime(value: string, language: AppLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === "en" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function numericTone(value: string | number | null | undefined) {
  const numeric = parseNumber(value);
  if (numeric == null || numeric === 0) return "text-muted-foreground";
  return numeric > 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]";
}

function percentTone(value: string | number | null | undefined): "up" | "down" | "flat" {
  const numeric = parseNumber(value);
  if (numeric == null || numeric === 0) return "flat";
  return numeric > 0 ? "up" : "down";
}

function readPortfolioSnapshots(market: PortfolioMarket): PortfolioAssetSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PORTFOLIO_SNAPSHOTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PortfolioAssetSnapshot[]) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => item.market === market && item.date && parseNumber(item.total_assets) != null)
          .sort((a, b) => a.date.localeCompare(b.date))
      : [];
  } catch {
    return [];
  }
}

function writePortfolioSnapshot(market: PortfolioMarket, totalAssets: string): PortfolioAssetSnapshot[] {
  if (typeof window === "undefined") return [];
  const value = parseNumber(totalAssets);
  if (value == null) return readPortfolioSnapshots(market);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = window.localStorage.getItem(PORTFOLIO_SNAPSHOTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PortfolioAssetSnapshot[]) : [];
    const snapshots = Array.isArray(parsed) ? parsed : [];
    const next = [
      ...snapshots.filter((item) => !(item.market === market && item.date === today)),
      { market, date: today, total_assets: totalAssets },
    ]
      .filter((item) => item.date >= "2020-01-01")
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-740);
    window.localStorage.setItem(PORTFOLIO_SNAPSHOTS_STORAGE_KEY, JSON.stringify(next));
    return next.filter((item) => item.market === market);
  } catch {
    return readPortfolioSnapshots(market);
  }
}

function periodKey(dateText: string, range: PortfolioTrendRange) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  if (range === "month") return dateText.slice(0, 7);
  if (range === "week") {
    const monday = new Date(date);
    const day = monday.getDay() || 7;
    monday.setDate(monday.getDate() - day + 1);
    return monday.toISOString().slice(0, 10);
  }
  return dateText;
}

function periodLabel(key: string, range: PortfolioTrendRange) {
  if (range === "month") return key.slice(5);
  return key.slice(5).replace("-", "/");
}

function buildTrendPoints(snapshots: PortfolioAssetSnapshot[], range: PortfolioTrendRange, currentTotalAssets: string): PortfolioTrendPoint[] {
  const grouped = new Map<string, PortfolioAssetSnapshot>();
  for (const snapshot of snapshots) {
    grouped.set(periodKey(snapshot.date, range), snapshot);
  }
  const points = Array.from(grouped.entries())
    .map(([key, snapshot]) => ({ label: periodLabel(key, range), value: parseNumber(snapshot.total_assets) ?? 0 }))
    .filter((point) => Number.isFinite(point.value));
  const limit = range === "day" ? 30 : 12;
  if (points.length > 0) return points.slice(-limit);
  const current = parseNumber(currentTotalAssets);
  return current == null ? [] : [{ label: new Date().toISOString().slice(5, 10).replace("-", "/"), value: current }];
}

function buildHoldingSegments(items: PortfolioItem[]): PortfolioPieSegment[] {
  const colors = ["#14b8a6", "#f97316", "#6366f1", "#eab308", "#ef4444", "#0ea5e9"];
  return items
    .map((item, index) => {
      const value = parseNumber(item.stock_value) ?? 0;
      return {
        label: item.symbol,
        value,
        displayValue: formatMoney(value),
        color: colors[index % colors.length],
      };
    })
    .filter((item) => item.value > 0);
}

function buildAssetSegments(cash: string, marketValue: number, copy: { cashAsset: string; equityAsset: string }): PortfolioPieSegment[] {
  const cashValue = parseNumber(cash) ?? 0;
  return [
    { label: copy.cashAsset, value: cashValue, displayValue: formatMoney(cashValue), color: "#22c55e" },
    { label: copy.equityAsset, value: marketValue, displayValue: formatMoney(marketValue), color: "#3b82f6" },
  ].filter((item) => item.value > 0);
}

function PortfolioTrendChart({
  hideSensitive,
  points,
}: {
  hideSensitive: boolean;
  points: PortfolioTrendPoint[];
}) {
  const width = 520;
  const height = 190;
  const padding = 18;
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const coordinates = points.map((point, index) => {
    const x = points.length <= 1 ? width / 2 : padding + (index / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.value - min) / span) * (height - padding * 2);
    return { ...point, x, y };
  });
  const path = coordinates.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="h-full min-h-[220px] rounded-md border border-border/80 bg-background/55 p-3">
      <svg className="h-44 w-full" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`} role="img">
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} className="stroke-border" strokeWidth="1" />
        <line x1={padding} x2={padding} y1={padding} y2={height - padding} className="stroke-border" strokeWidth="1" />
        {coordinates.length > 1 ? (
          <polyline points={path} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ) : null}
        {coordinates.map((point) => (
          <circle key={`${point.label}-${point.x}`} cx={point.x} cy={point.y} r="4" fill="hsl(var(--primary))" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{points[0]?.label ?? "-"}</span>
        <span className="font-mono text-foreground">{hideSensitive ? "***" : formatMoney(points.at(-1)?.value)}</span>
        <span>{points.at(-1)?.label ?? "-"}</span>
      </div>
    </div>
  );
}

function PortfolioPieChart({
  emptyLabel,
  hideSensitive,
  segments,
}: {
  emptyLabel: string;
  hideSensitive: boolean;
  segments: PortfolioPieSegment[];
}) {
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;
  return (
    <div className="rounded-md border border-border/80 bg-background/55 p-3">
      <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3">
        <svg className="size-28 shrink-0" viewBox="0 0 112 112" role="img" aria-hidden="true">
          <circle cx="56" cy="56" r="38" fill="none" stroke="hsl(var(--muted) / 0.38)" strokeWidth="18" />
          {segments.map((segment) => {
            const percent = total > 0 ? (segment.value / total) * 100 : 0;
            const dashOffset = -offset;
            offset += percent;
            return (
              <circle
                key={segment.label}
                cx="56"
                cy="56"
                r="38"
                fill="none"
                pathLength="100"
                stroke={segment.color}
                strokeDasharray={`${percent} ${100 - percent}`}
                strokeDashoffset={dashOffset}
                strokeWidth="18"
                transform="rotate(-90 56 56)"
              />
            );
          })}
          <circle cx="56" cy="56" r="28" fill="hsl(var(--background))" stroke="hsl(var(--border) / 0.7)" strokeWidth="1" />
        </svg>
        <div className="min-w-0 space-y-1.5">
          {segments.length === 0 ? (
            <p className="text-xs text-muted-foreground">{emptyLabel}</p>
          ) : (
            segments.map((segment) => (
              <div key={segment.label} className="flex min-w-0 items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
                  <span className="truncate">{segment.label}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-foreground">
                  {hideSensitive ? "***" : `${segment.displayValue} · ${total > 0 ? formatPercent((segment.value / total) * 100) : "-"}`}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function portfolioSortValue(item: PortfolioItem, key: PortfolioSortKey) {
  if (key === "symbol" || key === "note") return String(item[key] ?? "").toLowerCase();
  return parseNumber(item[key]) ?? Number.NEGATIVE_INFINITY;
}

function comparePortfolioItems(
  a: PortfolioItem,
  b: PortfolioItem,
  key: PortfolioSortKey,
  direction: "asc" | "desc",
) {
  const av = portfolioSortValue(a, key);
  const bv = portfolioSortValue(b, key);
  let result = 0;
  if (typeof av === "number" && typeof bv === "number") {
    result = av - bv;
  } else {
    result = String(av).localeCompare(String(bv));
  }
  return direction === "asc" ? result : -result;
}

function emptyAdjustmentDraft(item?: PortfolioItem | null): PortfolioAdjustmentDraft {
  return {
    mode: "increase",
    shares: "",
    price: item?.current_price ?? item?.cost_price ?? "",
  };
}

function computeAdjustmentPreview(item: PortfolioItem | null, draft: PortfolioAdjustmentDraft): PortfolioAdjustmentPreview {
  const currentShares = parseNumber(item?.shares) ?? 0;
  const currentCost = parseNumber(item?.cost_price);
  if (!item || !draft.shares.trim()) {
    return { currentShares, nextShares: null, nextCost: currentCost, error: null };
  }

  const amount = parseNumber(draft.shares);
  if (amount == null || amount < 0) {
    return { currentShares, nextShares: null, nextCost: currentCost, error: "invalid" };
  }

  const price = parseNumber(draft.price);
  let nextShares = amount;
  let nextCost = currentCost;

  if (draft.mode === "increase") {
    nextShares = currentShares + amount;
    if (price != null && nextShares > 0) {
      const existingCost = currentCost != null ? currentShares * currentCost : 0;
      nextCost = currentShares > 0 && currentCost != null
        ? (existingCost + amount * price) / nextShares
        : price;
    }
  } else if (draft.mode === "decrease") {
    nextShares = currentShares - amount;
    if (nextShares < 0) {
      return { currentShares, nextShares, nextCost, error: "negative" };
    }
  } else if (price != null) {
    nextCost = price;
  }

  return { currentShares, nextShares, nextCost, error: null };
}

function SortablePortfolioHeader({
  align = "left",
  label,
  onSort,
  sortKey,
  sortState,
}: {
  align?: "left" | "right";
  label: string;
  onSort: (key: PortfolioSortKey) => void;
  sortKey: PortfolioSortKey;
  sortState: { key: PortfolioSortKey; direction: "asc" | "desc" };
}) {
  const active = sortState.key === sortKey;
  return (
    <th className={cn("px-3 py-2 font-medium", align === "right" && "text-right")}>
      <button
        className={cn(
          "inline-flex items-center gap-1 rounded-sm text-xs transition-colors hover:text-foreground",
          align === "right" && "justify-end",
          active && "text-foreground",
        )}
        onClick={() => onSort(sortKey)}
        type="button"
      >
        {label}
        {active ? (
          sortState.direction === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />
        ) : (
          <ChevronDown className="size-3 opacity-30" />
        )}
      </button>
    </th>
  );
}

function QuoteMetric({ label, tone, value }: { label: string; tone?: "up" | "down" | "flat"; value: string }) {
  return (
    <div className="rounded-md bg-muted/20 px-2 py-1.5">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-semibold",
          tone === "up" && "text-primary",
          tone === "down" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}

type LoadPortfolioOptions = {
  quiet?: boolean;
  syncCapitalDraft?: boolean;
};

const PORTFOLIO_AUTO_REFRESH_STORAGE_KEY = "stocks-assistant.portfolio.auto-refresh";
const PORTFOLIO_HIDE_SENSITIVE_STORAGE_KEY = "stocks-assistant.portfolio.hide-sensitive";
const PORTFOLIO_MARKET_STORAGE_KEY = "stocks-assistant.portfolio.market";
const PORTFOLIO_SORT_STORAGE_KEY = "stocks-assistant.portfolio.sort";
const PORTFOLIO_SNAPSHOTS_STORAGE_KEY = "stocks-assistant.portfolio.asset-snapshots";

function readStoredSortState(): { key: PortfolioSortKey; direction: "asc" | "desc" } {
  const fallback = { key: "symbol" as PortfolioSortKey, direction: "asc" as const };
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(PORTFOLIO_SORT_STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<{ key: PortfolioSortKey; direction: "asc" | "desc" }>;
    const keys: PortfolioSortKey[] = ["symbol", "pe_ttm_ratio", "cost_price", "current_price", "stock_value", "position_ratio", "pnl_ratio", "change_rate", "note"];
    return parsed.key && keys.includes(parsed.key) && (parsed.direction === "asc" || parsed.direction === "desc")
      ? { key: parsed.key, direction: parsed.direction }
      : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredSortState(value: { key: PortfolioSortKey; direction: "asc" | "desc" }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PORTFOLIO_SORT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 本地缓存失败不影响表格排序。
  }
}

export function PortfolioPage({
  confirmAction,
  language,
  onAnalyzeStock,
  onOpenFinancials,
  refreshInterval,
}: {
  confirmAction: ConfirmFn;
  language: AppLanguage;
  onAnalyzeStock: (symbol: string) => void;
  onOpenFinancials: (symbol: string) => void;
  refreshInterval: number;
}) {
  const common = copyByLanguage[language].common;
  const copy = copyByLanguage[language].portfolio;
  const portfolioMarkets = getPortfolioMarkets(language);
  const [market, setMarket] = useState<PortfolioMarket>(() => readStoredValue(PORTFOLIO_MARKET_STORAGE_KEY, ["US", "A"], "US"));
  const [viewMode, setViewMode] = useState<PortfolioViewMode>("overview");
  const [trendRange, setTrendRange] = useState<PortfolioTrendRange>("day");
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [transactions, setTransactions] = useState<PortfolioTransaction[]>([]);
  const [assetSnapshots, setAssetSnapshots] = useState<PortfolioAssetSnapshot[]>(() => readPortfolioSnapshots(readStoredValue(PORTFOLIO_MARKET_STORAGE_KEY, ["US", "A"], "US")));
  const [totalCapital, setTotalCapital] = useState("0");
  const [totalAssets, setTotalAssets] = useState("0");
  const [cashRatio, setCashRatio] = useState<string | null>(null);
  const [capitalDraft, setCapitalDraft] = useState("0");
  const [form, setForm] = useState<PortfolioItemDraft>(() => emptyPortfolioDraft(readStoredValue(PORTFOLIO_MARKET_STORAGE_KEY, ["US", "A"], "US")));
  const [editingItem, setEditingItem] = useState<PortfolioItem | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<PortfolioItem | null>(null);
  const [adjustmentDraft, setAdjustmentDraft] = useState<PortfolioAdjustmentDraft>(() => emptyAdjustmentDraft());
  const [sellingItem, setSellingItem] = useState<PortfolioItem | null>(null);
  const [sellDraft, setSellDraft] = useState<PortfolioSellDraft>({ shares: "", price: "", note: "" });
  const [showForm, setShowForm] = useState(false);
  const [showCashSheet, setShowCashSheet] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PortfolioSearchResult[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<PortfolioSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingCapital, setIsSavingCapital] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(() => readStoredBoolean(PORTFOLIO_AUTO_REFRESH_STORAGE_KEY, false));
  const [hideSensitive, setHideSensitive] = useState(() => readStoredBoolean(PORTFOLIO_HIDE_SENSITIVE_STORAGE_KEY, false));
  const [message, setMessage] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [countdown, setCountdown] = useState(refreshInterval);
  const inFlightMarketRef = useRef<PortfolioMarket | null>(null);
  const requestSeqRef = useRef(0);
  const [sortState, setSortState] = useState<{ key: PortfolioSortKey; direction: "asc" | "desc" }>(() => readStoredSortState());

  const effectiveRefreshInterval = Math.max(1, Number.isFinite(refreshInterval) ? Math.floor(refreshInterval) : 60);
  const currentMarket = portfolioMarkets.find((item) => item.id === market) ?? portfolioMarkets[0];
  const sensitiveText = hideSensitive ? "***" : null;
  const hideToggleLabel = hideSensitive ? copy.showSensitive : copy.hideSensitive;
  const sensitiveValue = (value: string) => sensitiveText ?? value;
  useErrorToast(message, copy.title);
  useErrorToast(quoteError ? formatTemplate(copy.quoteUnavailable, { message: quoteError }) : "", copy.title);

  const portfolioStats = useMemo(() => {
    let marketValue = 0;
    let costValue = 0;
    for (const item of items) {
      marketValue += parseNumber(item.stock_value) ?? 0;
      const shares = parseNumber(item.shares);
      const cost = parseNumber(item.cost_price);
      if (shares != null && cost != null) costValue += shares * cost;
    }
    const pnl = marketValue - costValue;
    const pnlRatio = costValue > 0 ? (pnl / costValue) * 100 : null;
    return { marketValue, costValue, pnl, pnlRatio };
  }, [items]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => comparePortfolioItems(a, b, sortState.key, sortState.direction));
  }, [items, sortState]);

  const trendPoints = useMemo(
    () => buildTrendPoints(assetSnapshots, trendRange, totalAssets),
    [assetSnapshots, totalAssets, trendRange],
  );
  const holdingSegments = useMemo(() => buildHoldingSegments(items), [items]);
  const assetSegments = useMemo(
    () => buildAssetSegments(totalCapital, portfolioStats.marketValue, { cashAsset: copy.cashAsset, equityAsset: copy.equityAsset }),
    [copy.cashAsset, copy.equityAsset, portfolioStats.marketValue, totalCapital],
  );

  const preview = useMemo(() => {
    const shares = parseNumber(form.shares);
    const cost = parseNumber(form.cost_price);
    const current = parseNumber(selectedQuote?.last_done ?? editingItem?.current_price ?? null);
    const cash = parseNumber(capitalDraft || totalCapital) ?? 0;
    const stockValue = shares != null && current != null ? shares * current : null;
    const assetBase = cash + portfolioStats.marketValue + (editingItem ? 0 : stockValue ?? 0);
    const positionRatio = stockValue != null && assetBase > 0 ? (stockValue / assetBase) * 100 : null;
    const pnlRatio = current != null && cost && cost > 0 ? ((current - cost) / cost) * 100 : null;
    return { current, stockValue, positionRatio, pnlRatio };
  }, [capitalDraft, editingItem, form.cost_price, form.shares, portfolioStats.marketValue, selectedQuote?.last_done, totalCapital]);
  const adjustmentPreview = useMemo(
    () => computeAdjustmentPreview(adjustingItem, adjustmentDraft),
    [adjustingItem, adjustmentDraft],
  );
  const sellPreview = useMemo(() => {
    const shares = parseNumber(sellDraft.shares);
    const price = parseNumber(sellDraft.price);
    const cost = parseNumber(sellingItem?.cost_price);
    const amount = shares != null && price != null ? shares * price : null;
    const realizedPnl = amount != null && cost != null && shares != null ? (price! - cost) * shares : null;
    return { amount, realizedPnl };
  }, [sellDraft.price, sellDraft.shares, sellingItem?.cost_price]);

  const formatUpdatedTime = useCallback(() => {
    return new Date().toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [language]);

  const loadItems = useCallback(
    async ({ quiet = false, syncCapitalDraft = true }: LoadPortfolioOptions = {}) => {
      const requestMarket = market;
      if (inFlightMarketRef.current === requestMarket) return;

      const requestId = requestSeqRef.current + 1;
      requestSeqRef.current = requestId;
      inFlightMarketRef.current = requestMarket;
      if (quiet) {
        setIsAutoRefreshing(true);
      } else {
        setIsLoading(true);
        setMessage("");
      }

      try {
        const response = await listPortfolio(requestMarket);
        if (requestSeqRef.current !== requestId) return;
        setItems(response.items);
        setTotalCapital(response.total_capital);
        setTotalAssets(response.total_assets);
        setCashRatio(response.cash_ratio);
        setAssetSnapshots(writePortfolioSnapshot(requestMarket, response.total_assets));
        if (syncCapitalDraft) setCapitalDraft(response.total_capital);
        setQuoteError(response.quote_error ?? "");
        setMessage("");
        setLastUpdated(formatUpdatedTime());
      } catch (caught) {
        if (requestSeqRef.current !== requestId) return;
        setMessage(caught instanceof Error ? caught.message : copy.loadFailed);
      } finally {
        if (requestSeqRef.current === requestId) inFlightMarketRef.current = null;
        if (quiet) {
          setIsAutoRefreshing(false);
        } else if (requestSeqRef.current === requestId) {
          setIsLoading(false);
        }
      }
    },
    [copy.loadFailed, formatUpdatedTime, market],
  );

  const loadTransactions = useCallback(async () => {
    setIsLoadingTransactions(true);
    try {
      const response = await listPortfolioTransactions(market);
      setTransactions(response.transactions);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : copy.loadFailed);
    } finally {
      setIsLoadingTransactions(false);
    }
  }, [copy.loadFailed, market]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (viewMode === "overview") return;
    void loadTransactions();
  }, [loadTransactions, viewMode]);

  useEffect(() => {
    writeStoredValue(PORTFOLIO_MARKET_STORAGE_KEY, market);
  }, [market]);

  useEffect(() => {
    writeStoredBoolean(PORTFOLIO_AUTO_REFRESH_STORAGE_KEY, autoRefresh);
  }, [autoRefresh]);

  useEffect(() => {
    writeStoredBoolean(PORTFOLIO_HIDE_SENSITIVE_STORAGE_KEY, hideSensitive);
  }, [hideSensitive]);

  useEffect(() => {
    writeStoredSortState(sortState);
  }, [sortState]);

  useEffect(() => {
    setCountdown(effectiveRefreshInterval);
  }, [effectiveRefreshInterval, market]);

  useEffect(() => {
    if (!autoRefresh) return;

    setCountdown(effectiveRefreshInterval);
    const id = window.setInterval(() => {
      void loadItems({ quiet: true, syncCapitalDraft: false });
      setCountdown(effectiveRefreshInterval);
    }, effectiveRefreshInterval * 1000);

    return () => window.clearInterval(id);
  }, [autoRefresh, effectiveRefreshInterval, loadItems]);

  useEffect(() => {
    if (!autoRefresh) return;

    const id = window.setInterval(() => {
      setCountdown((current) => (current <= 1 ? effectiveRefreshInterval : current - 1));
    }, 1000);

    return () => window.clearInterval(id);
  }, [autoRefresh, effectiveRefreshInterval]);

  function handleManualRefresh() {
    setCountdown(effectiveRefreshInterval);
    void loadItems({ syncCapitalDraft: false });
  }

  function resetForm(nextMarket = market) {
    setForm(emptyPortfolioDraft(nextMarket));
    setEditingItem(null);
    setSelectedQuote(null);
    setQuery("");
    setResults([]);
  }

  async function handleSaveCapital() {
    setIsSavingCapital(true);
    setMessage("");
    try {
      const saved = await savePortfolioSettings(market, capitalDraft);
      setTotalCapital(saved.total_capital);
      setCapitalDraft(saved.total_capital);
      await loadItems();
      return true;
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : copy.saveCashFailed);
      return false;
    } finally {
      setIsSavingCapital(false);
    }
  }

  async function handleSaveCapitalSheet(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const saved = await handleSaveCapital();
    if (saved) setShowCashSheet(false);
  }

  async function handleSearch(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const text = query.trim();
    if (!text || isSearching) return;

    setIsSearching(true);
    setMessage("");
    try {
      const response = await searchPortfolioSymbols(text, market);
      setResults(response.results);
      if (response.total === 0) setMessage(copy.noMatch);
    } catch (caught) {
      setResults([]);
      setMessage(caught instanceof Error ? caught.message : copy.searchFailed);
    } finally {
      setIsSearching(false);
    }
  }

  function selectSearchResult(result: PortfolioSearchResult) {
    setSelectedQuote(result);
    setForm((current) => ({
      ...current,
      market: result.market,
      symbol: result.symbol,
      name: result.name || current.name,
    }));
    setQuery(result.symbol);
    setResults([]);
    setShowForm(true);
  }

  function editItem(item: PortfolioItem) {
    setEditingItem(item);
    setSelectedQuote({
      market: item.market,
      symbol: item.symbol,
      name: item.name,
      currency: item.currency,
      last_done: item.current_price,
      change_rate: item.change_rate,
    });
    setForm({
      market: item.market,
      symbol: item.symbol,
      name: item.name,
      shares: item.shares ?? "",
      cost_price: item.cost_price ?? "",
      note: item.note,
    });
    setQuery(item.symbol);
    setResults([]);
    setShowForm(true);
  }

  function adjustItem(item: PortfolioItem) {
    setAdjustingItem(item);
    setAdjustmentDraft(emptyAdjustmentDraft(item));
    setMessage("");
  }

  function closeAdjustmentSheet() {
    setAdjustingItem(null);
    setAdjustmentDraft(emptyAdjustmentDraft());
  }

  function sellItem(item: PortfolioItem) {
    setSellingItem(item);
    setSellDraft({ shares: "", price: item.current_price ?? item.cost_price ?? "", note: "" });
    setMessage("");
  }

  function closeSellSheet() {
    setSellingItem(null);
    setSellDraft({ shares: "", price: "", note: "" });
  }

  async function handleSaveAdjustment(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    if (!adjustingItem) return;
    if (adjustmentPreview.error === "invalid" || adjustmentPreview.nextShares == null) {
      setMessage(copy.adjustInvalid);
      return;
    }
    if (adjustmentPreview.error === "negative") {
      setMessage(copy.adjustNegative);
      return;
    }

    setIsSaving(true);
    setMessage("");
    try {
      await updatePortfolioItem(adjustingItem.id, {
        market: adjustingItem.market,
        symbol: adjustingItem.symbol,
        name: adjustingItem.name,
        shares: formatDraftDecimal(adjustmentPreview.nextShares),
        cost_price: formatDraftDecimal(adjustmentPreview.nextCost),
        note: adjustingItem.note,
      });
      closeAdjustmentSheet();
      await loadItems({ syncCapitalDraft: false });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : copy.adjustFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSellItem(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    if (!sellingItem) return;

    setIsSaving(true);
    setMessage("");
    try {
      await sellPortfolioItem(sellingItem.id, {
        shares: sellDraft.shares,
        price: sellDraft.price,
        note: sellDraft.note.trim(),
      });
      closeSellSheet();
      await loadItems({ syncCapitalDraft: true });
      await loadTransactions();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : copy.sellFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveItem(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const symbol = form.symbol.trim();
    if (!symbol) {
      setMessage(copy.enterSymbol);
      return;
    }

    const payload: PortfolioItemDraft = {
      market,
      symbol,
      name: form.name.trim(),
      shares: cleanOptional(form.shares),
      cost_price: cleanOptional(form.cost_price),
      note: form.note.trim(),
    };

    setIsSaving(true);
    setMessage("");
    try {
      if (editingItem) {
        await updatePortfolioItem(editingItem.id, payload);
      } else {
        await addPortfolioItem(payload);
      }
      resetForm();
      setShowForm(false);
      await loadItems({ syncCapitalDraft: false });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : copy.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(item: PortfolioItem) {
    const confirmed = await confirmAction({
      cancelText: common.cancel,
      confirmText: common.delete,
      description: formatTemplate(copy.deleteConfirm, { symbol: item.symbol }),
      destructive: true,
      title: copy.delete,
    });
    if (!confirmed) return;
    setMessage("");
    try {
      await deletePortfolioItem(item.id);
      if (editingItem?.id === item.id) resetForm();
      await loadItems({ syncCapitalDraft: false });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : copy.deleteFailed);
    }
  }

  function switchMarket(nextMarket: PortfolioMarket) {
    setMarket(nextMarket);
    setTransactions([]);
    setAssetSnapshots(readPortfolioSnapshots(nextMarket));
    setShowForm(false);
    setShowCashSheet(false);
    closeAdjustmentSheet();
    closeSellSheet();
    resetForm(nextMarket);
  }

  function toggleSort(key: PortfolioSortKey) {
    setSortState((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function renderMarketSwitcher() {
    return (
      <div className="inline-flex h-7 w-fit shrink-0 items-center rounded-full border border-border bg-muted/45 p-0.5">
        {portfolioMarkets.map((item) => (
          <button
            aria-pressed={market === item.id}
            className={cn(
              "h-6 min-w-[3.25rem] rounded-full px-2 text-xs font-medium transition-colors sm:min-w-[4.25rem] sm:px-2.5",
              market === item.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            key={item.id}
            onClick={() => switchMarket(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  function renderViewSwitcher() {
    const views: Array<{ id: PortfolioViewMode; label: string; icon: typeof BriefcaseBusiness }> = [
      { id: "overview", label: copy.overview, icon: BriefcaseBusiness },
      { id: "chart", label: copy.charts, icon: BarChart3 },
      { id: "manage", label: copy.manage, icon: Settings2 },
    ];
    return (
      <div className="inline-flex h-7 w-fit shrink-0 items-center rounded-full border border-border bg-muted/45 p-0.5">
        {views.map(({ id, label, icon: Icon }) => (
          <button
            aria-label={label}
            aria-pressed={viewMode === id}
            className={cn(
              "inline-flex h-6 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors sm:w-8",
              viewMode === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            key={id}
            onClick={() => setViewMode(id)}
            title={label}
            type="button"
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>
    );
  }

  const adjustmentErrorText = adjustmentPreview.error === "invalid"
    ? copy.adjustInvalid
    : adjustmentPreview.error === "negative"
      ? copy.adjustNegative
      : "";
  const adjustmentSaveDisabled = !adjustingItem || !adjustmentDraft.shares.trim() || adjustmentPreview.nextShares == null || Boolean(adjustmentPreview.error);
  const sellSaveDisabled = !sellingItem || !sellDraft.shares.trim() || !sellDraft.price.trim();

  const emptyState = (
    <div className="finance-soft-state grid min-h-56 place-items-center rounded-lg border border-dashed border-border/80 bg-muted/15 px-4 text-center text-sm text-muted-foreground">
      {isLoading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : (
        <div>
          <BriefcaseBusiness className="mx-auto mb-3 size-8" />
          <p className="font-medium text-foreground">{copy.emptyTitle}</p>
          <p className="mt-1 text-xs">{formatTemplate(copy.emptyHint, { market: currentMarket.label })}</p>
        </div>
      )}
    </div>
  );

  return (
    <section className="panel motion-panel page-enter finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar flex flex-nowrap items-center gap-1.5 overflow-x-auto md:justify-between md:gap-2">
        <div className="flex min-w-0 flex-none flex-nowrap items-center gap-1.5 md:gap-2">
          {renderMarketSwitcher()}
          {renderViewSwitcher()}
        </div>
        <div className="ml-auto flex flex-none flex-nowrap items-center gap-1.5 md:gap-2">
          <label className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-muted/25 px-1.5 text-xs text-muted-foreground sm:gap-2 sm:px-2">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <span className="hidden whitespace-nowrap sm:inline">{copy.realtimeRefresh}</span>
          </label>
          <Button
            aria-label={copy.manualRefresh}
            title={autoRefresh ? formatTemplate(copy.refreshCountdown, { seconds: countdown }) : copy.manualRefresh}
            size={autoRefresh ? "sm" : "icon"}
            variant="outline"
            onClick={handleManualRefresh}
            disabled={isLoading || isAutoRefreshing}
            className={cn(
              "h-7 shrink-0",
              autoRefresh
                ? "min-w-[3.5rem] gap-1 px-1.5 font-mono text-xs tabular-nums sm:min-w-[4.25rem] sm:gap-1.5 sm:px-2"
                : "w-7",
            )}
          >
            <RefreshCw className={cn((isLoading || isAutoRefreshing) && "animate-spin")} />
            {autoRefresh ? <span>{countdown}s</span> : null}
          </Button>
          <Button
            aria-label={hideToggleLabel}
            aria-pressed={hideSensitive}
            title={hideToggleLabel}
            size="icon"
            variant="outline"
            className="h-7 w-7 shrink-0"
            onClick={() => setHideSensitive((current) => !current)}
          >
            {hideSensitive ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </div>

      <div className="panel-body flex min-h-0 flex-1 flex-col gap-3 lg:overflow-hidden">
        {viewMode === "overview" ? (
          <div className="shrink-0 overflow-x-auto pb-1">
            <div className="flex w-max gap-1.5 pr-1 lg:grid lg:w-full lg:grid-cols-5 lg:gap-2 lg:pr-0">
              <div className="metric-tile w-36 shrink-0 lg:w-auto">
                <p className="text-[11px] text-muted-foreground">{copy.cash}</p>
                <p className="text-lg font-semibold tabular-nums">{sensitiveValue(formatMoney(totalCapital))}</p>
              </div>
              <div className="metric-tile w-36 shrink-0 lg:w-auto">
                <p className="text-[11px] text-muted-foreground">{copy.totalAssets}</p>
                <p className="text-lg font-semibold tabular-nums">{sensitiveValue(formatMoney(totalAssets))}</p>
              </div>
              <div className="metric-tile w-36 shrink-0 lg:w-auto">
                <p className="text-[11px] text-muted-foreground">{copy.marketValue}</p>
                <p className="text-lg font-semibold tabular-nums">{sensitiveValue(formatMoney(portfolioStats.marketValue))}</p>
              </div>
              <div className="metric-tile w-36 shrink-0 lg:w-auto">
                <p className="text-[11px] text-muted-foreground">{copy.cashRatio}</p>
                <p className="text-lg font-semibold tabular-nums">{formatPlain(cashRatio)}</p>
              </div>
              <div className="metric-tile w-44 shrink-0 lg:w-auto">
                <p className="text-[11px] text-muted-foreground">{copy.totalPnl}</p>
                <p className={cn("text-lg font-semibold tabular-nums", hideSensitive ? "text-muted-foreground" : numericTone(portfolioStats.pnl))}>
                  {hideSensitive ? "***" : `${formatSignedMoney(portfolioStats.pnl)} ${portfolioStats.pnlRatio != null ? `(${formatSignedPercent(portfolioStats.pnlRatio)})` : ""}`}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {viewMode === "manage" ? (
          <div className="finance-module rounded-lg border border-border/80 bg-background/45 p-3">
            <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_auto_auto_auto] md:items-end">
              <Field label={copy.cash}>
                <Input
                  className="font-mono"
                  inputMode="decimal"
                  value={capitalDraft}
                  onChange={(event) => setCapitalDraft(event.target.value)}
                  placeholder={copy.cash}
                />
              </Field>
              <Button size="sm" variant="outline" onClick={handleSaveCapital} disabled={isSavingCapital}>
                {isSavingCapital ? <Loader2 className="animate-spin" /> : <Save />}
                {copy.saveCash}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                }}
              >
                <Plus />
                {common.add}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void loadTransactions()} disabled={isLoadingTransactions}>
                {isLoadingTransactions ? <Loader2 className="animate-spin" /> : <History />}
                {copy.tradeHistory}
              </Button>
            </div>
          </div>
        ) : null}

        <SideDrawer
          open={showCashSheet}
          title={copy.cash}
          subtitle={copy.totalAssets}
          onClose={() => setShowCashSheet(false)}
          cancelText={common.cancel}
          formId="portfolio-cash-form"
          isSaving={isSavingCapital}
          saveText={common.save}
        >
          <form id="portfolio-cash-form" className="space-y-4" onSubmit={handleSaveCapitalSheet}>
            <Field label={copy.cash}>
              <Input
                className="font-mono"
                inputMode="decimal"
                value={capitalDraft}
                onChange={(event) => setCapitalDraft(event.target.value)}
                placeholder={copy.cash}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <QuoteMetric label={copy.totalAssets} value={sensitiveValue(formatMoney(totalAssets))} />
              <QuoteMetric label={copy.cashRatio} value={formatPlain(cashRatio)} />
            </div>
          </form>
        </SideDrawer>

        <SideDrawer
          open={Boolean(adjustingItem)}
          title={copy.adjustHolding}
          subtitle={adjustingItem ? `${adjustingItem.symbol} · ${copy.adjustHint}` : copy.adjustHint}
          onClose={closeAdjustmentSheet}
          cancelText={common.cancel}
          formId="portfolio-adjustment-form"
          isSaving={isSaving}
          saveDisabled={adjustmentSaveDisabled}
          saveText={common.save}
        >
          <form id="portfolio-adjustment-form" className="space-y-4" onSubmit={handleSaveAdjustment}>
            <Field label={copy.adjustMode}>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["increase", copy.adjustIncrease],
                  ["decrease", copy.adjustDecrease],
                  ["set", copy.adjustSet],
                ] as const).map(([mode, label]) => (
                  <Button
                    key={mode}
                    size="sm"
                    type="button"
                    variant={adjustmentDraft.mode === mode ? "default" : "outline"}
                    onClick={() => setAdjustmentDraft((current) => ({ ...current, mode }))}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy.adjustShares}>
                <Input
                  inputMode="decimal"
                  value={adjustmentDraft.shares}
                  onChange={(event) => setAdjustmentDraft((current) => ({ ...current, shares: event.target.value }))}
                  placeholder={copy.optional}
                />
              </Field>
              <Field label={copy.adjustPrice}>
                <Input
                  inputMode="decimal"
                  value={adjustmentDraft.price}
                  onChange={(event) => setAdjustmentDraft((current) => ({ ...current, price: event.target.value }))}
                  placeholder={formatPlain(adjustingItem?.current_price ?? adjustingItem?.cost_price)}
                />
              </Field>
            </div>

            {adjustmentErrorText ? (
              <div className="finance-soft-state rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {adjustmentErrorText}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <QuoteMetric label={copy.currentShares} value={formatPlain(adjustmentPreview.currentShares)} />
              <QuoteMetric label={copy.adjustedShares} value={adjustmentPreview.nextShares == null ? "-" : formatPlain(formatDraftDecimal(adjustmentPreview.nextShares))} />
              <QuoteMetric label={copy.adjustedCost} value={sensitiveValue(adjustmentPreview.nextCost == null ? "-" : formatMoney(adjustmentPreview.nextCost))} />
              <QuoteMetric label={copy.currentPrice} value={sensitiveValue(formatMoney(adjustingItem?.current_price))} />
            </div>
          </form>
        </SideDrawer>

        <SideDrawer
          open={Boolean(sellingItem)}
          title={copy.sellHolding}
          subtitle={sellingItem ? `${sellingItem.symbol} · ${sellingItem.name || "-"}` : copy.sellHolding}
          onClose={closeSellSheet}
          cancelText={common.cancel}
          formId="portfolio-sell-form"
          isSaving={isSaving}
          saveDisabled={sellSaveDisabled}
          saveText={copy.sell}
        >
          <form id="portfolio-sell-form" className="space-y-4" onSubmit={handleSellItem}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy.sellShares}>
                <Input
                  inputMode="decimal"
                  value={sellDraft.shares}
                  onChange={(event) => setSellDraft((current) => ({ ...current, shares: event.target.value }))}
                  placeholder={formatPlain(sellingItem?.shares)}
                />
              </Field>
              <Field label={copy.sellPrice}>
                <Input
                  inputMode="decimal"
                  value={sellDraft.price}
                  onChange={(event) => setSellDraft((current) => ({ ...current, price: event.target.value }))}
                  placeholder={formatPlain(sellingItem?.current_price ?? sellingItem?.cost_price)}
                />
              </Field>
            </div>
            <Field label={copy.note}>
              <Input
                value={sellDraft.note}
                onChange={(event) => setSellDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder={copy.notePlaceholder}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <QuoteMetric label={copy.currentShares} value={formatPlain(sellingItem?.shares)} />
              <QuoteMetric label={copy.currentPrice} value={sensitiveValue(formatMoney(sellingItem?.current_price))} />
              <QuoteMetric label={copy.transactionAmount} value={sensitiveValue(sellPreview.amount == null ? "-" : formatMoney(sellPreview.amount))} />
              <QuoteMetric
                label={copy.realizedPnl}
                tone={percentTone(sellPreview.realizedPnl)}
                value={hideSensitive ? "***" : sellPreview.realizedPnl == null ? "-" : formatSignedMoney(sellPreview.realizedPnl)}
              />
            </div>
          </form>
        </SideDrawer>

        <SideDrawer
          open={showForm}
          title={editingItem ? copy.editHolding : copy.addHolding}
          subtitle={copy.formHint}
          onClose={() => {
            resetForm();
            setShowForm(false);
          }}
          cancelText={common.cancel}
          formId="portfolio-item-form"
          isSaving={isSaving}
          saveDisabled={!form.symbol.trim()}
          saveText={common.save}
        >
          <form id="portfolio-item-form" className="space-y-4" onSubmit={handleSaveItem}>
            <div className="grid gap-3">
              <Field label={copy.stockCode}>
                <div className="flex gap-2">
                  <Input
                    className="uppercase"
                    value={form.symbol}
                    onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))}
                    placeholder={currentMarket.placeholder}
                  />
                  <Button size="sm" variant="outline" type="button" disabled={isSearching || !query.trim()} onClick={handleSearch}>
                    {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
                  </Button>
                </div>
              </Field>
              <Field label={copy.searchCode}>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleSearch(event);
                  }}
                  placeholder={copy.searchCode}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={copy.shares}>
                  <Input
                    inputMode="decimal"
                    value={form.shares ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, shares: event.target.value }))}
                    placeholder={copy.optional}
                  />
                </Field>
                <Field label={copy.costPrice}>
                  <Input
                    inputMode="decimal"
                    value={form.cost_price ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, cost_price: event.target.value }))}
                    placeholder={copy.optional}
                  />
                </Field>
              </div>
            </div>

            {results.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {results.map((result) => (
                  <button
                    key={result.symbol}
                    type="button"
                    className="rounded-md bg-muted/20 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/45 hover:text-foreground"
                    onClick={() => selectSearchResult(result)}
                  >
                    <span className="font-semibold">{result.symbol}</span>
                    <span className="ml-2 text-muted-foreground">{result.name || "-"}</span>
                    {result.last_done ? <span className="ml-2 tabular-nums">{sensitiveValue(formatMoney(result.last_done))}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}

            <Field label={copy.note}>
              <Input
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                placeholder={copy.notePlaceholder}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <QuoteMetric label={copy.currentPrice} value={sensitiveValue(preview.current != null ? formatMoney(preview.current) : "-")} />
              <QuoteMetric label={copy.stockValue} value={sensitiveValue(preview.stockValue != null ? formatMoney(preview.stockValue) : "-")} />
              <QuoteMetric label={copy.assetRatio} value={preview.positionRatio != null ? formatPercent(preview.positionRatio) : "-"} />
              <QuoteMetric label={copy.pnl} tone={percentTone(preview.pnlRatio)} value={preview.pnlRatio != null ? formatSignedPercent(preview.pnlRatio) : "-"} />
            </div>
          </form>
        </SideDrawer>

        {viewMode === "chart" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
            <div className="finance-module rounded-lg border border-border/80 bg-background/45 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="size-4 text-primary" />
                  {copy.assetTrend}
                </div>
                <div className="inline-flex h-7 items-center rounded-md border border-border bg-muted/30 p-0.5">
                  {([
                    ["day", copy.trendDay],
                    ["week", copy.trendWeek],
                    ["month", copy.trendMonth],
                  ] as const).map(([range, label]) => (
                    <button
                      key={range}
                      type="button"
                      aria-pressed={trendRange === range}
                      className={cn(
                        "h-6 rounded-sm px-2 text-xs font-medium transition-colors",
                        trendRange === range ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setTrendRange(range)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <PortfolioTrendChart hideSensitive={hideSensitive} points={trendPoints} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="finance-module rounded-lg border border-border/80 bg-background/45 p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <PieChart className="size-4 text-primary" />
                  {copy.holdingDistribution}
                </div>
                <PortfolioPieChart emptyLabel={copy.emptyTitle} hideSensitive={hideSensitive} segments={holdingSegments} />
              </div>
              <div className="finance-module rounded-lg border border-border/80 bg-background/45 p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <CircleDollarSign className="size-4 text-primary" />
                  {copy.assetAllocation}
                </div>
                <PortfolioPieChart emptyLabel={copy.emptyTitle} hideSensitive={hideSensitive} segments={assetSegments} />
              </div>
            </div>
          </div>
        ) : (
          <>
            {items.length === 0 ? (
              <div className="lg:hidden">{emptyState}</div>
            ) : (
              <div className="grid gap-1.5 lg:hidden">
                {sortedItems.map((item) => (
                  <article key={item.id} className="finance-row-card portfolio-list-row rounded-md border border-border/80 bg-background/60 px-2.5 py-2">
                    <div
                      className={cn(
                        "grid items-center gap-2",
                        viewMode === "manage"
                          ? "grid-cols-[minmax(82px,1fr)_minmax(68px,0.65fr)_minmax(70px,0.7fr)_auto]"
                          : "grid-cols-[minmax(82px,1fr)_minmax(68px,0.65fr)_minmax(70px,0.7fr)]",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-5">{item.symbol}</p>
                        <p className="truncate text-[11px] leading-4 text-muted-foreground">{item.name || item.note || "-"}</p>
                      </div>
                      <div className="min-w-0 text-right">
                        <p className="truncate text-[10px] text-muted-foreground">{copy.currentPrice}</p>
                        <p className="truncate text-xs font-semibold tabular-nums">{sensitiveValue(formatMoney(item.current_price))}</p>
                        <p className={cn("truncate text-[11px] tabular-nums", numericTone(item.change_rate))}>{formatPlain(item.change_rate)}</p>
                      </div>
                      <div className="min-w-0 text-right">
                        <p className="truncate text-[10px] text-muted-foreground">{copy.assetRatio}</p>
                        <p className="truncate text-xs font-semibold tabular-nums">{formatPlain(item.position_ratio)}</p>
                        <p className={cn("truncate text-[11px] tabular-nums", numericTone(item.pnl_ratio))}>{formatPlain(item.pnl_ratio)}</p>
                      </div>
                      {viewMode === "manage" ? (
                        <div className="grid grid-cols-3 gap-0.5">
                          <Button aria-label={copy.analyze} size="icon" variant="ghost" className="h-7 w-7" title={copy.analyze} onClick={() => onAnalyzeStock(item.symbol)}>
                            <Sparkles />
                          </Button>
                          <Button aria-label={copy.financials} size="icon" variant="ghost" className="h-7 w-7" title={copy.financials} onClick={() => onOpenFinancials(item.symbol)}>
                            <FileText />
                          </Button>
                          <Button aria-label={copy.adjustHolding} size="icon" variant="ghost" className="h-7 w-7" title={copy.adjustHolding} onClick={() => adjustItem(item)}>
                            <SlidersHorizontal />
                          </Button>
                          <Button aria-label={copy.edit} size="icon" variant="ghost" className="h-7 w-7" title={copy.edit} onClick={() => editItem(item)}>
                            <Pencil />
                          </Button>
                          <Button aria-label={copy.sellHolding} size="icon" variant="ghost" className="h-7 w-7" title={copy.sellHolding} onClick={() => sellItem(item)}>
                            <CircleDollarSign />
                          </Button>
                          <Button aria-label={copy.delete} size="icon" variant="ghost" className="h-7 w-7" title={copy.delete} onClick={() => handleDelete(item)}>
                            <Trash2 />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                      <span className="truncate">{copy.stockValue}: <span className="text-foreground tabular-nums">{sensitiveValue(formatMoney(item.stock_value))}</span></span>
                      <span className="truncate">{copy.costPrice}: <span className="text-foreground tabular-nums">{sensitiveValue(formatMoney(item.cost_price))}</span></span>
                      <span className="truncate">{copy.pe}: <span className="text-foreground tabular-nums">{formatPlain(item.pe_ttm_ratio)}</span></span>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="finance-module hidden min-h-0 flex-1 overflow-auto rounded-lg border border-border/80 bg-background/45 lg:block">
              <table className={cn("w-full border-collapse text-sm", viewMode === "manage" ? "min-w-[1160px]" : "min-w-[980px]")}>
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border/80 text-left text-xs text-muted-foreground">
                    <SortablePortfolioHeader label={copy.stockCode} sortKey="symbol" sortState={sortState} onSort={toggleSort} />
                    <SortablePortfolioHeader label={copy.pe} sortKey="pe_ttm_ratio" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.costPrice} sortKey="cost_price" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.currentPrice} sortKey="current_price" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.stockValue} sortKey="stock_value" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.assetRatio} sortKey="position_ratio" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.pnlRatio} sortKey="pnl_ratio" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.dayChange} sortKey="change_rate" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.note} sortKey="note" sortState={sortState} onSort={toggleSort} />
                    {viewMode === "manage" ? <th className="px-3 py-2 text-right font-medium">{copy.actions}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item) => (
                    <tr key={item.id} className="portfolio-table-row border-b border-border/60">
                      <td className="px-3 py-2">
                        <div className="min-w-0">
                          <p className="font-semibold">{item.symbol}</p>
                          <p className="max-w-[180px] truncate text-xs text-muted-foreground">{item.name || "-"}</p>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPlain(item.pe_ttm_ratio)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sensitiveValue(formatMoney(item.cost_price))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sensitiveValue(formatMoney(item.current_price))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sensitiveValue(formatMoney(item.stock_value))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPlain(item.position_ratio)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", numericTone(item.pnl_ratio))}>{formatPlain(item.pnl_ratio)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", numericTone(item.change_rate))}>{formatPlain(item.change_rate)}</td>
                      <td className="max-w-[240px] truncate px-3 py-2 text-xs text-muted-foreground">{item.note || "-"}</td>
                      {viewMode === "manage" ? (
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button aria-label={copy.analyze} size="icon" variant="ghost" className="h-7 w-7" title={copy.analyze} onClick={() => onAnalyzeStock(item.symbol)}>
                              <Sparkles />
                            </Button>
                            <Button aria-label={copy.financials} size="icon" variant="ghost" className="h-7 w-7" title={copy.financials} onClick={() => onOpenFinancials(item.symbol)}>
                              <FileText />
                            </Button>
                            <Button aria-label={copy.adjustHolding} size="icon" variant="ghost" className="h-7 w-7" title={copy.adjustHolding} onClick={() => adjustItem(item)}>
                              <SlidersHorizontal />
                            </Button>
                            <Button aria-label={copy.edit} size="icon" variant="ghost" className="h-7 w-7" title={copy.edit} onClick={() => editItem(item)}>
                              <Pencil />
                            </Button>
                            <Button aria-label={copy.sellHolding} size="icon" variant="ghost" className="h-7 w-7" title={copy.sellHolding} onClick={() => sellItem(item)}>
                              <CircleDollarSign />
                            </Button>
                            <Button aria-label={copy.delete} size="icon" variant="ghost" className="h-7 w-7" title={copy.delete} onClick={() => handleDelete(item)}>
                              <Trash2 />
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>

              {items.length === 0 ? (
                emptyState
              ) : null}
            </div>

            {viewMode === "manage" ? (
              <div className="finance-module shrink-0 overflow-hidden rounded-lg border border-border/80 bg-background/45">
                <div className="flex items-center justify-between border-b border-border/70 px-3 py-2 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2">
                    <History className="size-4 text-primary" />
                    {copy.tradeHistory}
                  </span>
                  {isLoadingTransactions ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
                </div>
                {transactions.length === 0 ? (
                  <div className="px-3 py-5 text-center text-xs text-muted-foreground">{copy.noTransactions}</div>
                ) : (
                  <div className="max-h-52 overflow-auto">
                    <table className="w-full min-w-[720px] border-collapse text-xs">
                      <thead className="sticky top-0 bg-card text-muted-foreground">
                        <tr className="border-b border-border/70 text-left">
                          <th className="px-3 py-2 font-medium">{copy.transactionTime}</th>
                          <th className="px-3 py-2 font-medium">{copy.stockCode}</th>
                          <th className="px-3 py-2 font-medium">{copy.transactionSide}</th>
                          <th className="px-3 py-2 text-right font-medium">{copy.shares}</th>
                          <th className="px-3 py-2 text-right font-medium">{copy.sellPrice}</th>
                          <th className="px-3 py-2 text-right font-medium">{copy.transactionAmount}</th>
                          <th className="px-3 py-2 text-right font-medium">{copy.realizedPnl}</th>
                          <th className="px-3 py-2 font-medium">{copy.note}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((transaction) => (
                          <tr key={transaction.id} className="border-b border-border/60">
                            <td className="px-3 py-2 text-muted-foreground">{formatDateTime(transaction.created_at, language)}</td>
                            <td className="px-3 py-2 font-medium">{transaction.symbol}</td>
                            <td className="px-3 py-2">{transaction.side === "sell" ? copy.sell : transaction.side}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPlain(transaction.shares)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{sensitiveValue(formatMoney(transaction.price))}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{sensitiveValue(formatMoney(transaction.amount))}</td>
                            <td className={cn("px-3 py-2 text-right font-mono tabular-nums", numericTone(transaction.realized_pnl))}>
                              {hideSensitive ? "***" : formatSignedMoney(transaction.realized_pnl)}
                            </td>
                            <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">{transaction.note || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
