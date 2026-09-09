import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  ArrowDownUp,
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

import { useAuth } from "@/lib/auth";
import { PortfolioTrendChart, PortfolioPieChart, PortfolioPnlChart } from "@/components/portfolio/PortfolioCharts";
import {
  buildAssetSegments, buildHoldingSegments, buildTrendPoints, holdingPnl,
  parseNumber, formatMoney, portfolioStats as computePortfolioStats,
  readPortfolioSnapshots, writePortfolioSnapshot,
  type PortfolioAssetSnapshot, type PortfolioTrendRange,
} from "@/components/portfolio/model";
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
      h: "港股",
      usPlaceholder: "AAPL / MSFT",
      aPlaceholder: "600519 / 000001",
      hPlaceholder: "00700 / 09988",
    },
    portfolio: {
      title: "投资组合",
      subtitle: "掌握资产配置，跟踪持仓表现与每一次调整",
      cash: "可用现金",
      saveCash: "现金",
      totalAssets: "总资产",
      marketValue: "持仓市值",
      cashRatio: "现金占比",
      positionCount: "持仓数",
      totalPnl: "未实现盈亏",
      overview: "总览",
      charts: "图表",
      manage: "管理",
      trendDay: "按日",
      trendWeek: "按周",
      trendMonth: "按月",
      assetTrend: "资产快照",
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
      sellHolding: "记录卖出",
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
      detail: "持仓详情", filterPlaceholder: "搜索代码、名称或备注", all: "全部持仓", gains: "盈利", losses: "亏损",
      noFiltered: "没有符合条件的持仓", clearFilters: "清除筛选", dayPnl: "当日持仓变动", partial: "部分持仓数据",
      costEstimate: "含成本估值", liveValuation: "行情估值", localOnly: "本地持仓记录，不会向券商提交订单。",
      valuationHint: "部分标的缺少现价，资产总额可能包含成本估值；盈亏仅计算资料完整的持仓。",
      costSource: "成本估值", unavailableSource: "尚无估值", priceComparison: "成本与现价", estimated: "估算",
      sellInvalid: "卖出股数须大于 0，且不超过当前持仓。", sellAll: "全部股数", name: "名称", noNote: "尚未添加持仓备注",
      cashHint: "仅修改此市场的本地现金余额", buy: "买入", adjust: "调整", coverage: "盈亏仅包含股数、成本和现价完整的持仓。",
      holdingUnit: "个持仓", openDetail: "查看详情", viewSorted: "排序", source: "估值来源",
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
      h: "Hong Kong",
      usPlaceholder: "AAPL / MSFT",
      aPlaceholder: "600519 / 000001",
      hPlaceholder: "00700 / 09988",
    },
    portfolio: {
      title: "Portfolio",
      subtitle: "Your allocation, position performance, and portfolio activity in one place",
      cash: "Cash",
      saveCash: "Cash",
      totalAssets: "Total assets",
      marketValue: "Market value",
      cashRatio: "Cash %",
      positionCount: "Positions",
      totalPnl: "Unrealized P&L",
      overview: "Overview",
      charts: "Charts",
      manage: "Manage",
      trendDay: "Day",
      trendWeek: "Week",
      trendMonth: "Month",
      assetTrend: "Asset snapshots",
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
      sellHolding: "Record sale",
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
      detail: "Holding details", filterPlaceholder: "Search symbol, name, or note", all: "All holdings", gains: "Gainers", losses: "Losers",
      noFiltered: "No matching holdings", clearFilters: "Clear filters", dayPnl: "Daily position change", partial: "Partial coverage",
      costEstimate: "Includes cost estimates", liveValuation: "Quote valuation", localOnly: "Local portfolio records. No orders are sent to your broker.",
      valuationHint: "Some current prices are missing. Assets may include cost estimates; P&L includes only holdings with complete data.",
      costSource: "Cost estimate", unavailableSource: "Not valued", priceComparison: "Cost and current price", estimated: "Estimate",
      sellInvalid: "Sale quantity must be greater than zero and cannot exceed your shares.", sellAll: "All shares", name: "Name", noNote: "No holding note yet",
      cashHint: "Updates the local cash balance for this market", buy: "Buy", adjust: "Adjust", coverage: "P&L includes only holdings with shares, cost basis, and current quotes.",
      holdingUnit: "holdings", openDetail: "View details", viewSorted: "Sort", source: "Valuation source",
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

function formatTemplate(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function getPortfolioMarkets(language: AppLanguage): Array<{ id: PortfolioMarket; label: string; hint: string; placeholder: string }> {
  const markets = copyByLanguage[language].markets;
  return [
    { id: "US", label: markets.us, hint: "USD", placeholder: markets.usPlaceholder },
    { id: "A", label: markets.a, hint: "CNY", placeholder: markets.aPlaceholder },
    { id: "H", label: markets.h, hint: "HKD", placeholder: markets.hPlaceholder },
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

function formatPlain(value: string | number | null | undefined) {
  if (value == null || value === "") return "-";
  return String(value);
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

function comparePortfolioItems(a: PortfolioItem, b: PortfolioItem, key: PortfolioSortKey, direction: "asc" | "desc") {
  const numeric = key !== "symbol" && key !== "note";
  const av = numeric ? parseNumber(a[key]) : String(a[key] ?? "").toLocaleLowerCase();
  const bv = numeric ? parseNumber(b[key]) : String(b[key] ?? "").toLocaleLowerCase();
  if (av == null) return bv == null ? 0 : 1;
  if (bv == null) return -1;
  const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
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
    <th aria-sort={active ? sortState.direction === "asc" ? "ascending" : "descending" : "none"} className={cn("px-3 py-3 font-medium", align === "right" && "text-right")}>
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
          tone === "up" && "text-[var(--color-up)]",
          tone === "down" && "text-[var(--color-down)]",
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
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const common = copyByLanguage[language].common;
  const copy = copyByLanguage[language].portfolio;
  const portfolioMarkets = getPortfolioMarkets(language);
  const [market, setMarket] = useState<PortfolioMarket>(() => readStoredValue(PORTFOLIO_MARKET_STORAGE_KEY, ["US", "A", "H"], "US"));
  const [filterQuery, setFilterQuery] = useState("");
  const [pnlFilter, setPnlFilter] = useState<"all" | "gain" | "loss">("all");
  const [detailItemId, setDetailItemId] = useState<number | null>(null);
  const [valuationComplete, setValuationComplete] = useState(true);
  const transactionRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const [viewMode, setViewMode] = useState<PortfolioViewMode>("overview");
  const [trendRange, setTrendRange] = useState<PortfolioTrendRange>("day");
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [transactions, setTransactions] = useState<PortfolioTransaction[]>([]);
  const [assetSnapshots, setAssetSnapshots] = useState<PortfolioAssetSnapshot[]>(() => readPortfolioSnapshots(readStoredValue(PORTFOLIO_MARKET_STORAGE_KEY, ["US", "A", "H"], "US"), userId));
  const [totalCapital, setTotalCapital] = useState("0");
  const [totalAssets, setTotalAssets] = useState("0");
  const [cashRatio, setCashRatio] = useState<string | null>(null);
  const [capitalDraft, setCapitalDraft] = useState("0");
  const [form, setForm] = useState<PortfolioItemDraft>(() => emptyPortfolioDraft(readStoredValue(PORTFOLIO_MARKET_STORAGE_KEY, ["US", "A", "H"], "US")));
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
  const queuedRefreshRef = useRef<{
    market: PortfolioMarket;
    quiet: boolean;
    syncCapitalDraft: boolean;
    resolve: Array<() => void>;
  } | null>(null);
  const [sortState, setSortState] = useState<{ key: PortfolioSortKey; direction: "asc" | "desc" }>(() => readStoredSortState());

  const effectiveRefreshInterval = Math.max(1, Number.isFinite(refreshInterval) ? Math.floor(refreshInterval) : 60);
  const currentMarket = portfolioMarkets.find((item) => item.id === market) ?? portfolioMarkets[0];
  const sensitiveText = hideSensitive ? "***" : null;
  const hideToggleLabel = hideSensitive ? copy.showSensitive : copy.hideSensitive;
  const sensitiveValue = (value: string) => sensitiveText ?? value;
  useErrorToast(message, copy.title);
  useErrorToast(quoteError ? formatTemplate(copy.quoteUnavailable, { message: quoteError }) : "", copy.title);

  const portfolioStats = useMemo(() => computePortfolioStats(items), [items]);
  const detailItem = items.find((item) => item.id === detailItemId) ?? null;

  const sortedItems = useMemo(() => {
    const queryText = filterQuery.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (queryText && !`${item.symbol} ${item.name} ${item.note}`.toLocaleLowerCase().includes(queryText)) return false;
      const pnl = holdingPnl(item);
      return pnlFilter === "all" || (pnl != null && (pnlFilter === "gain" ? pnl > 0 : pnl < 0));
    }).sort((a, b) => comparePortfolioItems(a, b, sortState.key, sortState.direction));
  }, [filterQuery, items, pnlFilter, sortState]);

  const trendPoints = useMemo(
    () => buildTrendPoints(assetSnapshots, trendRange),
    [assetSnapshots, trendRange],
  );
  const holdingSegments = useMemo(() => buildHoldingSegments(items), [items]);
  const assetSegments = useMemo(
    () => buildAssetSegments(totalCapital, portfolioStats.marketValue, { cashAsset: copy.cashAsset, equityAsset: copy.equityAsset }),
    [copy.cashAsset, copy.equityAsset, portfolioStats.marketValue, totalCapital],
  );

  const preview = useMemo(() => {
    const shares = parseNumber(form.shares);
    const cost = parseNumber(form.cost_price);
    const current = parseNumber(selectedQuote?.last_done ?? (editingItem?.symbol === form.symbol ? editingItem.current_price : null));
    const cash = parseNumber(capitalDraft || totalCapital) ?? 0;
    const stockValue = shares != null && current != null ? shares * current : null;
    const assetBase = cash + portfolioStats.marketValue - (parseNumber(editingItem?.stock_value) ?? 0) + (stockValue ?? 0);
    const positionRatio = stockValue != null && assetBase > 0 ? (stockValue / assetBase) * 100 : null;
    const pnlRatio = current != null && cost && cost > 0 ? ((current - cost) / cost) * 100 : null;
    return { current, stockValue, positionRatio, pnlRatio };
  }, [capitalDraft, editingItem, form.cost_price, form.shares, form.symbol, portfolioStats.marketValue, selectedQuote?.last_done, totalCapital]);
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

  const loadItems: (options?: LoadPortfolioOptions) => Promise<void> = useCallback(
    async ({ quiet = false, syncCapitalDraft = true }: LoadPortfolioOptions = {}) => {
      const requestMarket = market;
      if (inFlightMarketRef.current === requestMarket) {
        return new Promise<void>((resolve) => {
          const queued = queuedRefreshRef.current;
          if (queued?.market === requestMarket) {
            // 写操作触发的前台刷新优先级高于自动刷新，并保留任何一次同步现金草稿的需求。
            queued.quiet = queued.quiet && quiet;
            queued.syncCapitalDraft = queued.syncCapitalDraft || syncCapitalDraft;
            queued.resolve.push(resolve);
          } else {
            queuedRefreshRef.current = { market: requestMarket, quiet, syncCapitalDraft, resolve: [resolve] };
          }
        });
      }

      if (inFlightMarketRef.current && inFlightMarketRef.current !== requestMarket) {
        const staleQueue = queuedRefreshRef.current;
        queuedRefreshRef.current = null;
        staleQueue?.resolve.forEach((resolve) => resolve());
      }

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
        setValuationComplete(response.valuation_complete);
        setAssetSnapshots(response.valuation_complete
          ? writePortfolioSnapshot(requestMarket, response.total_assets, userId)
          : readPortfolioSnapshots(requestMarket, userId));
        if (syncCapitalDraft) setCapitalDraft(response.total_capital);
        setQuoteError(response.quote_error ?? "");
        setMessage("");
        setLastUpdated(formatUpdatedTime());
      } catch (caught) {
        if (requestSeqRef.current !== requestId) return;
        setMessage(caught instanceof Error ? caught.message : copy.loadFailed);
      } finally {
        const isCurrentRequest = requestSeqRef.current === requestId;
        if (isCurrentRequest) inFlightMarketRef.current = null;
        if (quiet && isCurrentRequest) {
          setIsAutoRefreshing(false);
        } else if (isCurrentRequest) {
          setIsLoading(false);
        }
        const queued = queuedRefreshRef.current;
        if (isCurrentRequest && queued?.market === requestMarket) {
          queuedRefreshRef.current = null;
          void loadItems({ quiet: queued.quiet, syncCapitalDraft: queued.syncCapitalDraft })
            .finally(() => queued.resolve.forEach((resolve) => resolve()));
        }
      }
    },
    [copy.loadFailed, formatUpdatedTime, market, userId],
  );

  const loadTransactions = useCallback(async () => {
    const requestId = ++transactionRequestRef.current;
    setIsLoadingTransactions(true);
    try {
      const response = await listPortfolioTransactions(market);
      if (requestId === transactionRequestRef.current) setTransactions(response.transactions);
    } catch (caught) {
      if (requestId === transactionRequestRef.current) setMessage(caught instanceof Error ? caught.message : copy.loadFailed);
    } finally {
      if (requestId === transactionRequestRef.current) setIsLoadingTransactions(false);
    }
  }, [copy.loadFailed, market]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (viewMode !== "manage") return;
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
    if (viewMode === "manage") void loadTransactions();
  }

  function resetForm(nextMarket = market) {
    searchRequestRef.current += 1;
    setIsSearching(false);
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
    const text = (query || form.symbol).trim();
    if (!text || isSearching) return;

    const requestId = ++searchRequestRef.current;
    setIsSearching(true);
    setMessage("");
    try {
      const response = await searchPortfolioSymbols(text, market);
      if (requestId !== searchRequestRef.current) return;
      setResults(response.results);
      if (response.total === 0) setMessage(copy.noMatch);
    } catch (caught) {
      if (requestId !== searchRequestRef.current) return;
      setResults([]);
      setMessage(caught instanceof Error ? caught.message : copy.searchFailed);
    } finally {
      if (requestId === searchRequestRef.current) setIsSearching(false);
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
    if (market === nextMarket) return;
    requestSeqRef.current += 1;
    inFlightMarketRef.current = null;
    queuedRefreshRef.current?.resolve.forEach((resolve) => resolve());
    queuedRefreshRef.current = null;
    transactionRequestRef.current += 1;
    setItems([]);
    setTotalCapital("0");
    setTotalAssets("0");
    setCashRatio(null);
    setLastUpdated("");
    setQuoteError("");
    setValuationComplete(true);
    setDetailItemId(null);
    setFilterQuery("");
    setPnlFilter("all");
    setIsLoadingTransactions(false);
    setIsAutoRefreshing(false);
    setMarket(nextMarket);
    setTransactions([]);
    setAssetSnapshots(readPortfolioSnapshots(nextMarket, userId));
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
      <div className="inline-flex w-fit shrink-0 items-center rounded-xl border border-border/60 bg-muted/35 p-1">
        {portfolioMarkets.map((item) => (
          <button
            aria-pressed={market === item.id}
            className={cn(
              "h-8 min-w-[3.25rem] rounded-lg px-2 text-xs font-medium transition-colors sm:min-w-[4.25rem] sm:px-2.5",
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
      <div className="inline-flex w-fit shrink-0 items-center rounded-xl border border-border/60 bg-muted/35 p-1">
        {views.map(({ id, label, icon: Icon }) => (
          <button
            aria-label={label}
            aria-pressed={viewMode === id}
            className={cn(
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
              viewMode === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            key={id}
            onClick={() => setViewMode(id)}
            title={label}
            type="button"
          >
            <Icon className="size-3.5" />
            <span>{label}</span>
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
  const sellShares = parseNumber(sellDraft.shares);
  const sellPrice = parseNumber(sellDraft.price);
  const sellInvalid = sellDraft.shares.trim() && (sellShares == null || sellShares <= 0 || sellShares > (parseNumber(sellingItem?.shares) ?? 0));
  const sellSaveDisabled = !sellingItem || sellShares == null || sellShares <= 0 || sellPrice == null || sellPrice <= 0 || Boolean(sellInvalid);

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
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 pb-4 pt-2">
        <div><h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1><p className="mt-1 text-xs text-muted-foreground">{copy.subtitle}</p></div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { setCapitalDraft(totalCapital); setShowCashSheet(true); }}><CircleDollarSign />{copy.saveCash}</Button>
          <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}><Plus />{copy.addHolding}</Button>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 pb-3 md:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {renderMarketSwitcher()}
          {renderViewSwitcher()}
        </div>
        <div className="ml-auto flex flex-none flex-nowrap items-center gap-1.5 md:gap-2">
          <label className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-muted/25 px-1.5 text-xs text-muted-foreground sm:gap-2 sm:px-2">
            <Switch aria-label={copy.realtimeRefresh} checked={autoRefresh} onCheckedChange={setAutoRefresh} />
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

      <div className="panel-body flex min-h-0 flex-1 flex-col gap-4 lg:overflow-y-auto">
        <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="col-span-2 rounded-xl border border-primary/15 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-4 xl:col-span-1">
            <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">{copy.totalAssets}</p><span className="text-[10px] font-medium text-primary">{currentMarket.hint}</span></div>
            <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{isLoading && !lastUpdated ? "—" : sensitiveValue(formatMoney(totalAssets))}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className={cn("size-1.5 rounded-full", valuationComplete ? "bg-primary" : "bg-amber-500")} />{valuationComplete ? copy.liveValuation : copy.costEstimate}</p>
          </div>
          <div className="rounded-xl border border-border/65 bg-card/60 p-4">
            <p className="text-xs text-muted-foreground">{copy.marketValue}</p><p className="mt-2 text-xl font-semibold tabular-nums">{sensitiveValue(formatMoney(portfolioStats.marketValue))}</p>
            <p className="mt-2 text-[10px] text-muted-foreground">{items.length} {copy.holdingUnit} · {copy.cashRatio} {formatPlain(cashRatio)}</p>
          </div>
          <div className="rounded-xl border border-border/65 bg-card/60 p-4">
            <p className="text-xs text-muted-foreground">{copy.totalPnl}{portfolioStats.missingPnlCount > 0 ? <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">{copy.partial}</span> : null}</p>
            <p className={cn("mt-2 text-xl font-semibold tabular-nums", !hideSensitive && numericTone(portfolioStats.pnl))}>{sensitiveValue(formatSignedMoney(portfolioStats.pnl))}</p>
            <p className={cn("mt-2 text-[10px] tabular-nums", numericTone(portfolioStats.pnlRatio))}>{formatSignedPercent(portfolioStats.pnlRatio)}</p>
          </div>
          <div className="rounded-xl border border-border/65 bg-card/60 p-4">
            <p className="text-xs text-muted-foreground">{copy.dayPnl}{portfolioStats.dayMissingCount > 0 ? <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">{copy.partial}</span> : null}</p>
            <p className={cn("mt-2 text-xl font-semibold tabular-nums", !hideSensitive && numericTone(portfolioStats.dayPnl))}>{sensitiveValue(formatSignedMoney(portfolioStats.dayPnl))}</p>
            <p className="mt-2 text-[10px] tabular-nums text-muted-foreground">{copy.cash}: {sensitiveValue(formatMoney(totalCapital))}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>{copy.localOnly}</span>{lastUpdated ? <span>{formatTemplate(copy.updatedAt, { time: lastUpdated })} · Longbridge</span> : null}</div>
        {!valuationComplete ? <div role="status" className="flex shrink-0 items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs leading-5 text-amber-700 dark:text-amber-300"><AlertCircle className="mt-0.5 size-4 shrink-0" />{copy.valuationHint}</div> : null}

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
          subtitle={`${currentMarket.hint} · ${copy.cashHint}`}
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
              <QuoteMetric label={copy.currentShares} value={sensitiveValue(formatPlain(adjustmentPreview.currentShares))} />
              <QuoteMetric label={copy.adjustedShares} value={adjustmentPreview.nextShares == null ? "-" : formatPlain(formatDraftDecimal(adjustmentPreview.nextShares))} />
              <QuoteMetric label={copy.adjustedCost} value={sensitiveValue(adjustmentPreview.nextCost == null ? "-" : formatMoney(adjustmentPreview.nextCost))} />
              <QuoteMetric label={copy.currentPrice} value={sensitiveValue(formatMoney(adjustingItem?.current_price))} />
            </div>
          </form>
        </SideDrawer>

        <SideDrawer
          open={Boolean(sellingItem)}
          title={copy.sellHolding}
          subtitle={sellingItem ? `${sellingItem.symbol} · ${copy.localOnly}` : copy.sellHolding}
          onClose={closeSellSheet}
          cancelText={common.cancel}
          formId="portfolio-sell-form"
          isSaving={isSaving}
          saveDisabled={sellSaveDisabled}
          saveText={copy.sell}
        >
          <form id="portfolio-sell-form" className="space-y-4" onSubmit={handleSellItem}>
            <div className="flex items-center justify-between rounded-lg bg-muted/35 px-3 py-2 text-xs"><span>{copy.currentShares}: {sensitiveValue(formatPlain(sellingItem?.shares))}</span><Button type="button" size="sm" variant="ghost" onClick={() => setSellDraft((current) => ({ ...current, shares: sellingItem?.shares ?? "" }))}>{copy.sellAll}</Button></div>
            {sellInvalid ? <p role="alert" className="text-xs text-destructive">{copy.sellInvalid}</p> : null}
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
              <QuoteMetric label={copy.currentShares} value={sensitiveValue(formatPlain(sellingItem?.shares))} />
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
              <Field label={copy.searchCode}>
                <div className="flex gap-2">
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleSearch(event); }} placeholder={currentMarket.placeholder} />
                  <Button size="sm" variant="outline" type="button" aria-label={copy.searchCode} disabled={isSearching || !(query || form.symbol).trim()} onClick={handleSearch}>{isSearching ? <Loader2 className="animate-spin" /> : <Search />}</Button>
                </div>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={copy.stockCode}><Input className="uppercase" value={form.symbol} onChange={(event) => { setForm((current) => ({ ...current, symbol: event.target.value })); setSelectedQuote(null); }} placeholder={currentMarket.placeholder} /></Field>
                <Field label={copy.name}><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={copy.optional} /></Field>
              </div>
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

        <SideDrawer open={Boolean(detailItem)} title={detailItem?.symbol ?? copy.detail} subtitle={detailItem?.name || copy.detail} onClose={() => setDetailItemId(null)} panelClassName="lg:max-w-[560px]">
          {detailItem ? <div className="space-y-5">
            <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/10 to-background p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{copy.currentPrice} · {detailItem.currency || currentMarket.hint}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{sensitiveValue(formatMoney(detailItem.current_price))}</p><p className={cn("mt-1 text-sm font-medium tabular-nums", numericTone(detailItem.change_rate))}>{sensitiveValue(formatSignedMoney(detailItem.change_value))} ({formatPlain(detailItem.change_rate)})</p></div><Badge variant="outline">{detailItem.valuation_price_source === "live" ? copy.liveValuation : detailItem.valuation_price_source === "cost" ? copy.costSource : copy.unavailableSource}</Badge></div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <QuoteMetric label={copy.shares} value={sensitiveValue(formatMoney(detailItem.shares))} />
              <QuoteMetric label={copy.stockValue} value={sensitiveValue(formatMoney(detailItem.stock_value))} />
              <QuoteMetric label={copy.costPrice} value={sensitiveValue(formatMoney(detailItem.cost_price))} />
              <QuoteMetric label={copy.totalPnl} value={sensitiveValue(formatSignedMoney(holdingPnl(detailItem)))} tone={hideSensitive ? undefined : percentTone(holdingPnl(detailItem))} />
              <QuoteMetric label={copy.pnlRatio} value={formatPlain(detailItem.pnl_ratio)} tone={percentTone(detailItem.pnl_ratio)} />
              <QuoteMetric label={copy.assetRatio} value={formatPlain(detailItem.position_ratio)} />
              <QuoteMetric label={copy.pe} value={formatPlain(detailItem.pe_ttm_ratio)} />
              <QuoteMetric label={copy.source} value={detailItem.valuation_price_source === "live" ? "Longbridge" : detailItem.valuation_price_source === "cost" ? copy.costSource : copy.unavailableSource} />
            </div>
            <div className="rounded-xl border border-border/60 p-4"><h3 className="text-xs font-medium">{copy.priceComparison}</h3><div className="mt-4 space-y-4">{[[copy.costPrice, detailItem.cost_price], [copy.currentPrice, detailItem.current_price]].map(([label, value]) => {
              const number = parseNumber(value);
              const maximum = Math.max(parseNumber(detailItem.cost_price) ?? 0, parseNumber(detailItem.current_price) ?? 0, 1);
              return <div key={label}><div className="mb-1.5 flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{sensitiveValue(formatMoney(value))}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted/50"><div className={cn("h-full rounded-full", label === copy.costPrice ? "bg-muted-foreground/45" : "bg-primary")} style={{ width: `${number == null ? 0 : Math.max(0, number) / maximum * 100}%` }} /></div></div>;
            })}</div></div>
            <div><h3 className="mb-2 flex items-center gap-2 text-xs font-medium"><FileText className="size-3.5" />{copy.note}</h3><p className="whitespace-pre-wrap break-words rounded-xl bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">{detailItem.note || copy.noNote}</p></div>
            <div className="grid grid-cols-2 gap-2"><Button size="sm" onClick={() => { setDetailItemId(null); onAnalyzeStock(detailItem.symbol); }}><Sparkles />{copy.analyze}</Button><Button size="sm" variant="outline" onClick={() => { setDetailItemId(null); onOpenFinancials(detailItem.symbol); }}><FileText />{copy.financials}</Button></div>
            <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-4"><Button size="sm" variant="outline" onClick={() => { setDetailItemId(null); editItem(detailItem); }}><Pencil />{language === "zh" ? "编辑" : "Edit"}</Button><Button size="sm" variant="outline" onClick={() => { setDetailItemId(null); adjustItem(detailItem); }}><SlidersHorizontal />{copy.adjust}</Button><Button size="sm" variant="outline" onClick={() => { setDetailItemId(null); sellItem(detailItem); }}><CircleDollarSign />{copy.sell}</Button></div>
            <p className="text-[11px] leading-5 text-muted-foreground">{copy.localOnly}</p>
          </div> : null}
        </SideDrawer>

        {viewMode === "chart" ? (
          <div className="grid shrink-0 auto-rows-max gap-4 pb-4">
            <div className="min-w-0 rounded-xl border border-border/65 bg-card/60 p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
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
                        "h-6 rounded-sm px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        trendRange === range ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setTrendRange(range)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <PortfolioTrendChart hideSensitive={hideSensitive} points={trendPoints} language={language} currency={currentMarket.hint} />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-border/65 bg-card/60 p-4 sm:p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <PieChart className="size-4 text-primary" />
                  {copy.holdingDistribution}
                </div>
                <PortfolioPieChart emptyLabel={copy.emptyTitle} hideSensitive={hideSensitive} segments={holdingSegments} language={language} currency={currentMarket.hint} onSelect={(symbol) => setDetailItemId(items.find((item) => item.symbol === symbol)?.id ?? null)} />
              </div>
              <div className="min-w-0 rounded-xl border border-border/65 bg-card/60 p-4 sm:p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <CircleDollarSign className="size-4 text-primary" />
                  {copy.assetAllocation}
                </div>
                <PortfolioPieChart emptyLabel={copy.emptyTitle} hideSensitive={hideSensitive} segments={assetSegments} language={language} currency={currentMarket.hint} />
              </div>
            </div>
            <div className="rounded-xl border border-border/65 bg-card/60 p-4 sm:p-5"><PortfolioPnlChart items={items} hideSensitive={hideSensitive} language={language} currency={currentMarket.hint} onSelect={(item) => setDetailItemId(item.id)} /></div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label={copy.filterPlaceholder} className="h-9 pl-9" placeholder={copy.filterPlaceholder} value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} /></div>
              <div className="flex rounded-lg bg-muted/40 p-1">{([["all", copy.all], ["gain", copy.gains], ["loss", copy.losses]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={pnlFilter === value} className={cn("rounded-md px-2.5 py-1.5 text-xs", pnlFilter === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground")} onClick={() => setPnlFilter(value)}>{label}</button>)}</div>
              <div className="ml-auto flex items-center gap-1"><label className="sr-only" htmlFor="portfolio-sort">{copy.viewSorted}</label><select id="portfolio-sort" className="h-9 max-w-36 rounded-lg border border-border/70 bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary" value={sortState.key} onChange={(event) => setSortState((current) => ({ ...current, key: event.target.value as PortfolioSortKey }))}>{([["symbol", copy.stockCode], ["stock_value", copy.stockValue], ["pnl_ratio", copy.pnlRatio], ["change_rate", copy.dayChange], ["position_ratio", copy.assetRatio], ["pe_ttm_ratio", copy.pe], ["cost_price", copy.costPrice], ["current_price", copy.currentPrice], ["note", copy.note]] as const).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><Button size="icon" variant="outline" className="size-9" aria-label={sortState.direction === "asc" ? copy.sortDesc : copy.sortAsc} onClick={() => setSortState((current) => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))}><ArrowDownUp className="size-3.5" /></Button></div>
              <span className="text-[10px] tabular-nums text-muted-foreground">{sortedItems.length} / {items.length}</span>
            </div>
            {items.length > 0 && sortedItems.length === 0 ? <div className="grid min-h-36 shrink-0 place-content-center gap-3 rounded-xl border border-dashed border-border text-center"><p className="text-sm text-muted-foreground">{copy.noFiltered}</p><Button size="sm" variant="ghost" onClick={() => { setFilterQuery(""); setPnlFilter("all"); }}>{copy.clearFilters}</Button></div> : null}
            {items.length === 0 ? (
              <div className="lg:hidden">{emptyState}</div>
            ) : (
              <div className="grid gap-1.5 lg:hidden">
                {sortedItems.map((item) => (
                  <article key={item.id} className="portfolio-list-row rounded-xl border border-border/65 bg-card/60 p-3">
                    <div
                      className={cn(
                        "grid items-center gap-2",
                        viewMode === "manage"
                          ? "grid-cols-[minmax(72px,1fr)_minmax(60px,0.65fr)_minmax(65px,0.7fr)]"
                          : "grid-cols-[minmax(72px,1fr)_minmax(60px,0.65fr)_minmax(65px,0.7fr)]",
                      )}
                    >
                      <div className="min-w-0">
                        <button type="button" className="inline-flex max-w-full items-center gap-1 text-sm font-semibold leading-5 text-primary hover:underline" aria-label={`${item.symbol} · ${copy.openDetail}`} onClick={() => setDetailItemId(item.id)}><span className="truncate">{item.symbol}</span><ArrowUpRight className="size-3 shrink-0" /></button>
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
                        <div className="col-span-3 flex justify-end gap-1 border-t border-border/50 pt-2">
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

            <div className="hidden min-h-52 shrink-0 overflow-auto rounded-xl border border-border/65 bg-card/60 lg:block">
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
                          <button type="button" className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline" onClick={() => setDetailItemId(item.id)} aria-label={`${item.symbol} · ${copy.openDetail}`}>{item.symbol}<ArrowUpRight className="size-3" /></button>
                          <p className="max-w-[180px] truncate text-xs text-muted-foreground">{item.name || "-"}</p>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPlain(item.pe_ttm_ratio)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sensitiveValue(formatMoney(item.cost_price))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sensitiveValue(formatMoney(item.current_price))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{sensitiveValue(formatMoney(item.stock_value))}{item.valuation_price_source !== "live" ? <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">{item.valuation_price_source === "cost" ? copy.estimated : "—"}</p> : null}</td>
                      <td className="px-3 py-3 text-right tabular-nums"><span>{formatPlain(item.position_ratio)}</span><div className="ml-auto mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-muted/60"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, Math.max(0, parseNumber(item.position_ratio) ?? 0))}%` }} /></div></td>
                      <td className={cn("px-3 py-3 text-right tabular-nums", numericTone(item.pnl_ratio))}>{formatPlain(item.pnl_ratio)}<p className="mt-0.5 text-[10px]">{sensitiveValue(formatSignedMoney(holdingPnl(item)))}</p></td>
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
              <div className="shrink-0 overflow-hidden rounded-xl border border-border/65 bg-card/60">
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
                            <td className="px-3 py-2">{transaction.side === "sell" ? copy.sell : transaction.side === "buy" ? copy.buy : copy.adjust}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{sensitiveValue(formatPlain(transaction.shares))}</td>
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
