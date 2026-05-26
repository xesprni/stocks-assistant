import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Field } from "@/components/common/Field";
import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { SideDrawer } from "@/components/common/SideDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  addPortfolioItem,
  deletePortfolioItem,
  listPortfolio,
  savePortfolioSettings,
  searchPortfolioSymbols,
  updatePortfolioItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PortfolioItem, PortfolioItemDraft, PortfolioMarket, PortfolioSearchResult } from "@/types/app";

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
  const [market, setMarket] = useState<PortfolioMarket>("US");
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [totalCapital, setTotalCapital] = useState("0");
  const [totalAssets, setTotalAssets] = useState("0");
  const [cashRatio, setCashRatio] = useState<string | null>(null);
  const [capitalDraft, setCapitalDraft] = useState("0");
  const [form, setForm] = useState<PortfolioItemDraft>(() => emptyPortfolioDraft("US"));
  const [editingItem, setEditingItem] = useState<PortfolioItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showCashSheet, setShowCashSheet] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PortfolioSearchResult[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<PortfolioSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingCapital, setIsSavingCapital] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [hideSensitive, setHideSensitive] = useState(false);
  const [message, setMessage] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [countdown, setCountdown] = useState(refreshInterval);
  const inFlightMarketRef = useRef<PortfolioMarket | null>(null);
  const requestSeqRef = useRef(0);
  const [sortState, setSortState] = useState<{ key: PortfolioSortKey; direction: "asc" | "desc" }>({
    key: "symbol",
    direction: "asc",
  });

  const effectiveRefreshInterval = Math.max(1, Number.isFinite(refreshInterval) ? Math.floor(refreshInterval) : 60);
  const currentMarket = portfolioMarkets.find((item) => item.id === market) ?? portfolioMarkets[0];
  const sensitiveText = hideSensitive ? "***" : null;
  const hideToggleLabel = hideSensitive ? copy.showSensitive : copy.hideSensitive;
  const sensitiveValue = (value: string) => sensitiveText ?? value;

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

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

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
    setShowForm(false);
    setShowCashSheet(false);
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
              "h-6 min-w-[4.25rem] rounded-full px-2.5 text-xs font-medium transition-colors",
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
      <div className="panel-header flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <BriefcaseBusiness className="size-5 shrink-0 text-primary" />
              <p className="truncate font-semibold">{copy.title}</p>
              <Badge variant="outline" className="hidden md:inline-flex">{currentMarket.label}</Badge>
            </div>
            <p className="hidden text-xs text-muted-foreground sm:block">
              {copy.subtitle}
              {lastUpdated ? ` · ${formatTemplate(copy.updatedAt, { time: lastUpdated })}` : ""}
            </p>
          </div>
          <div className="shrink-0 md:hidden">{renderMarketSwitcher()}</div>
        </div>
        <div className="flex w-full flex-col gap-2 md:flex-row md:items-center xl:w-auto">
          <div className="hidden overflow-x-auto md:block md:w-fit">{renderMarketSwitcher()}</div>
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <label className="flex h-7 min-w-0 items-center gap-2 rounded-md bg-muted/25 px-2 text-xs text-muted-foreground">
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <span className="hidden whitespace-nowrap sm:inline">{copy.realtimeRefresh}</span>
            </label>
            {autoRefresh ? (
              <div className="hidden h-7 items-center gap-1.5 rounded-md bg-muted/25 px-2 text-xs text-muted-foreground sm:flex">
                <Activity className="size-3 animate-pulse text-[var(--color-up)]" />
                <span className="whitespace-nowrap">{formatTemplate(copy.refreshCountdown, { seconds: countdown })}</span>
              </div>
            ) : null}
            <Button
              aria-label={copy.manualRefresh}
              title={copy.manualRefresh}
              size="icon"
              variant="outline"
              onClick={handleManualRefresh}
              disabled={isLoading || isAutoRefreshing}
            >
              <RefreshCw className={cn((isLoading || isAutoRefreshing) && "animate-spin")} />
            </Button>
            <Button
              aria-label={hideToggleLabel}
              aria-pressed={hideSensitive}
              title={hideToggleLabel}
              size="icon"
              variant="outline"
              onClick={() => setHideSensitive((current) => !current)}
            >
              {hideSensitive ? <EyeOff /> : <Eye />}
            </Button>
            <Input
              className="hidden min-w-[9rem] flex-1 font-mono sm:flex-none md:block md:w-32"
              value={capitalDraft}
              onChange={(event) => setCapitalDraft(event.target.value)}
              placeholder={copy.cash}
            />
            <Button size="sm" variant="outline" onClick={handleSaveCapital} disabled={isSavingCapital} className="hidden md:inline-flex">
              {isSavingCapital ? <Loader2 className="animate-spin" /> : <Save />}
              {copy.saveCash}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCashSheet(true)} className="md:hidden">
              <Save />
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
          </div>
        </div>
      </div>

      <div className="panel-body flex min-h-0 flex-1 flex-col gap-3 lg:overflow-hidden">
        <div className="grid shrink-0 grid-cols-3 gap-1.5 lg:grid-cols-5 lg:gap-2">
          <div className="metric-tile hidden lg:block">
            <p className="text-[11px] text-muted-foreground">{copy.cash}</p>
            <p className="text-lg font-semibold tabular-nums">{sensitiveValue(formatMoney(totalCapital))}</p>
          </div>
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">{copy.totalAssets}</p>
            <p className="text-lg font-semibold tabular-nums">{sensitiveValue(formatMoney(totalAssets))}</p>
          </div>
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">{copy.marketValue}</p>
            <p className="text-lg font-semibold tabular-nums">{sensitiveValue(formatMoney(portfolioStats.marketValue))}</p>
          </div>
          <div className="metric-tile hidden lg:block">
            <p className="text-[11px] text-muted-foreground">{copy.cashRatio}</p>
            <p className="text-lg font-semibold tabular-nums">{formatPlain(cashRatio)}</p>
          </div>
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">{copy.totalPnl}</p>
            <p className={cn("text-lg font-semibold tabular-nums", hideSensitive ? "text-muted-foreground" : numericTone(portfolioStats.pnl))}>
              {hideSensitive ? "***" : `${formatSignedMoney(portfolioStats.pnl)} ${portfolioStats.pnlRatio != null ? `(${formatSignedPercent(portfolioStats.pnlRatio)})` : ""}`}
            </p>
          </div>
        </div>

        {message || quoteError ? (
          <div className="finance-soft-state rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {message || formatTemplate(copy.quoteUnavailable, { message: quoteError })}
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

        {items.length === 0 ? (
          <div className="lg:hidden">{emptyState}</div>
        ) : (
          <div className="grid gap-1.5 lg:hidden">
            {sortedItems.map((item) => (
              <article key={item.id} className="finance-row-card rounded-md border border-border/80 bg-background/60 px-2.5 py-2">
                <div className="grid grid-cols-[minmax(82px,1fr)_minmax(68px,0.65fr)_minmax(70px,0.7fr)_auto] items-center gap-2">
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
                  <div className="grid grid-cols-2 gap-0.5">
                    <Button aria-label={copy.analyze} size="icon" variant="ghost" className="h-7 w-7" title={copy.analyze} onClick={() => onAnalyzeStock(item.symbol)}>
                      <Sparkles />
                    </Button>
                    <Button aria-label={copy.financials} size="icon" variant="ghost" className="h-7 w-7" title={copy.financials} onClick={() => onOpenFinancials(item.symbol)}>
                      <FileText />
                    </Button>
                    <Button aria-label={copy.edit} size="icon" variant="ghost" className="h-7 w-7" title={copy.edit} onClick={() => editItem(item)}>
                      <Pencil />
                    </Button>
                    <Button aria-label={copy.delete} size="icon" variant="ghost" className="h-7 w-7" title={copy.delete} onClick={() => handleDelete(item)}>
                      <Trash2 />
                    </Button>
                  </div>
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
          <table className="w-full min-w-[1080px] border-collapse text-sm">
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
                <th className="px-3 py-2 text-right font-medium">{copy.actions}</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <tr key={item.id} className="border-b border-border/60 transition-colors hover:bg-muted/20">
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
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button aria-label={copy.analyze} size="icon" variant="ghost" className="h-7 w-7" title={copy.analyze} onClick={() => onAnalyzeStock(item.symbol)}>
                        <Sparkles />
                      </Button>
                      <Button aria-label={copy.financials} size="icon" variant="ghost" className="h-7 w-7" title={copy.financials} onClick={() => onOpenFinancials(item.symbol)}>
                        <FileText />
                      </Button>
                      <Button aria-label={copy.edit} size="icon" variant="ghost" className="h-7 w-7" title={copy.edit} onClick={() => editItem(item)}>
                        <Pencil />
                      </Button>
                      <Button aria-label={copy.delete} size="icon" variant="ghost" className="h-7 w-7" title={copy.delete} onClick={() => handleDelete(item)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {items.length === 0 ? (
            emptyState
          ) : null}
        </div>
      </div>
    </section>
  );
}
