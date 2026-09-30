import { formatTemplate } from "@/i18n";
import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { useErrorToast } from "@/components/common/Toast";
import {
  buildAssetSegments,
  buildHoldingSegments,
  buildTrendPoints,
  portfolioStats as computePortfolioStats,
  holdingPnl,
  parseNumber,
  type PortfolioAssetSnapshot,
  type PortfolioTrendRange,
} from "@/components/portfolio/model";
import {
  cleanOptional,
  comparePortfolioItems,
  computeAdjustmentPreview,
  copyByLanguage,
  emptyAdjustmentDraft,
  emptyPortfolioDraft,
  formatDraftDecimal,
  getPortfolioMarkets,
  PORTFOLIO_AUTO_REFRESH_STORAGE_KEY,
  PORTFOLIO_HIDE_SENSITIVE_STORAGE_KEY,
  PORTFOLIO_MARKET_STORAGE_KEY,
  readStoredSortState,
  writeStoredSortState,
  type LoadPortfolioOptions,
  type PortfolioAdjustmentDraft,
  type PortfolioSellDraft,
  type PortfolioSortKey,
  type PortfolioViewMode,
} from "@/components/portfolio/page-model";
import { localeFor, type AppLanguage } from "@/i18n";
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
import { useAuth } from "@/lib/auth";
import { readStoredBoolean, readStoredValue, writeStoredBoolean, writeStoredValue } from "@/lib/local-storage";
import type { PortfolioItem, PortfolioItemDraft, PortfolioMarket, PortfolioSearchResult, PortfolioTransaction } from "@/types/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
export type PortfolioPageProps = {
  confirmAction: ConfirmFn;
  language: AppLanguage;
  onOpenFinancials: (symbol: string) => void;
  refreshInterval: number;
};
export function usePortfolioPage({
  confirmAction,
  language,
  onOpenFinancials,
  refreshInterval,
}: PortfolioPageProps) {

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

  const [assetSnapshots, setAssetSnapshots] = useState<PortfolioAssetSnapshot[]>([]);

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
    return new Date().toLocaleTimeString(localeFor(language), {
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
        setAssetSnapshots(response.asset_snapshots ?? []);
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
    setAssetSnapshots([]);
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
  return {
    confirmAction, language, onOpenFinancials, refreshInterval, portfolioMarkets,
    market, switchMarket, copy, viewMode, setViewMode,
    isLoading, currentMarket, setCapitalDraft, totalCapital, setShowCashSheet,
    resetForm, setShowForm, autoRefresh, setAutoRefresh, countdown,
    handleManualRefresh, isAutoRefreshing, hideToggleLabel, hideSensitive, setHideSensitive,
    lastUpdated, sensitiveValue, totalAssets, valuationComplete, portfolioStats,
    items, cashRatio, capitalDraft, handleSaveCapital, isSavingCapital,
    common, loadTransactions, isLoadingTransactions, showCashSheet, handleSaveCapitalSheet,
    adjustingItem, closeAdjustmentSheet, isSaving, adjustmentSaveDisabled, handleSaveAdjustment,
    adjustmentDraft, setAdjustmentDraft, adjustmentErrorText, adjustmentPreview, sellingItem,
    closeSellSheet, sellSaveDisabled, handleSellItem, setSellDraft, sellInvalid,
    sellDraft, sellPreview, showForm, editingItem, form,
    handleSaveItem, query, setQuery, handleSearch, isSearching,
    setForm, setSelectedQuote, results, selectSearchResult, preview,
    detailItem, setDetailItemId, editItem, adjustItem, sellItem,
    trendRange, setTrendRange, trendPoints, holdingSegments, assetSegments,
    filterQuery, setFilterQuery, pnlFilter, setPnlFilter, sortState,
    setSortState, sortedItems, handleDelete, toggleSort, transactions,
  };
}
export type PortfolioPageState = ReturnType<typeof usePortfolioPage>;
