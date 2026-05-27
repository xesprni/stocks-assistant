import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BriefcaseBusiness, FileText, GripVertical, Loader2, Newspaper, Plus, RefreshCw, Search, Sparkles, Star, Trash2 } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addPortfolioItem, addWatchlistItem, deleteWatchlistItem, getWatchlistOverview, listWatchlist, reorderWatchlist, searchWatchlist } from "@/lib/api";
import { formatTemplate, i18n, localeFor } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PortfolioMarket, WatchlistCategory, WatchlistItem, WatchlistOverviewResponse, WatchlistOverviewRow, WatchlistQuoteView, WatchlistSearchResult } from "@/types/app";

type WatchlistMode = "manage" | "quotes";
type NameParts = Pick<WatchlistItem, "name" | "name_cn" | "name_hk" | "name_en">;

const WATCHLIST_CATEGORY_STORAGE_KEY = "stocks-assistant-watchlist-category";
const WATCHLIST_MODE_STORAGE_KEY = "stocks-assistant-watchlist-mode";
const WATCHLIST_FILTER_STORAGE_KEY = "stocks-assistant-watchlist-filter";
const WATCHLIST_QUOTE_VIEW_STORAGE_KEY = "stocks-assistant-watchlist-quote-view";
const QUOTE_VIEWS: WatchlistQuoteView[] = ["movers", "gainers", "losers", "active"];

function getWatchlistCategories(language: AppLanguage): Array<{ id: WatchlistCategory; label: string; hint: string; placeholder: string }> {
  const markets = i18n[language].markets;
  return [
    { id: "US", label: markets.us, hint: markets.usHint, placeholder: markets.usPlaceholder },
    { id: "A", label: markets.a, hint: markets.aHint, placeholder: markets.aPlaceholder },
    { id: "H", label: markets.h, hint: markets.hHint, placeholder: markets.hPlaceholder },
  ];
}

function readStoredValue<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readStoredText(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStoredValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 本地存储不可用时退回当前页面状态。
  }
}

function SortableWatchlistItem({
  item,
  onDelete,
  onAnalyze,
  onAddToPortfolio,
  onOpenFinancials,
  onOpenNews,
  copy,
}: {
  item: WatchlistItem;
  onDelete: (item: WatchlistItem) => void;
  onAnalyze: (symbol: string) => void;
  onAddToPortfolio: (item: WatchlistItem) => void;
  onOpenFinancials: (symbol: string) => void;
  onOpenNews: (symbol: string) => void;
  copy: typeof i18n.zh.watchlist;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      className="finance-row-card message-bubble rounded-md border border-border/80 bg-card/80 p-2 transition-colors hover:border-primary/50 sm:p-3"
      ref={setNodeRef}
      style={style}
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          {...attributes}
          {...listeners}
          aria-label={copy.dragSort}
          className="shrink-0 cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
          type="button"
        >
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold sm:text-base">{item.symbol}</p>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">{stockName(item)}</p>
        </div>
        <RowActions
          category={item.category}
          copy={copy}
          onAddToPortfolio={() => onAddToPortfolio(item)}
          onAnalyze={() => onAnalyze(item.symbol)}
          onDelete={() => onDelete(item)}
          onOpenFinancials={() => onOpenFinancials(item.symbol)}
          onOpenNews={() => onOpenNews(item.symbol)}
          showDelete
        />
      </div>
    </div>
  );
}

function QuoteWatchlistItem({
  item,
  onAnalyze,
  onAddToPortfolio,
  onOpenFinancials,
  onOpenNews,
  copy,
}: {
  item: WatchlistOverviewRow;
  onAnalyze: (symbol: string) => void;
  onAddToPortfolio: (item: WatchlistOverviewRow) => void;
  onOpenFinancials: (symbol: string) => void;
  onOpenNews: (symbol: string) => void;
  copy: typeof i18n.zh.watchlist;
}) {
  return (
    <div className="finance-row-card rounded-md border border-border/80 bg-card/80 p-3 transition-colors hover:border-primary/50">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold sm:text-base">{item.symbol}</p>
            <Badge className="h-5 px-1.5 text-[10px]" variant="outline">{item.category}</Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">{stockName(item)}</p>
        </div>
        <RowActions
          category={item.category}
          copy={copy}
          onAddToPortfolio={() => onAddToPortfolio(item)}
          onAnalyze={() => onAnalyze(item.symbol)}
          onOpenFinancials={() => onOpenFinancials(item.symbol)}
          onOpenNews={() => onOpenNews(item.symbol)}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <QuoteMetric label={copy.last} value={item.last_done ?? "-"} />
        <QuoteMetric label={copy.change} value={item.change_value ?? "-"} tone={rateTone(item.change_value)} />
        <QuoteMetric label={copy.rate} value={item.change_rate ?? "-"} tone={rateTone(item.change_rate)} />
        <QuoteMetric label={copy.turnover} value={formatCompactValue(item.turnover)} />
      </div>
    </div>
  );
}

function RowActions({
  category,
  copy,
  onAddToPortfolio,
  onAnalyze,
  onDelete,
  onOpenFinancials,
  onOpenNews,
  showDelete = false,
}: {
  category: WatchlistCategory;
  copy: typeof i18n.zh.watchlist;
  onAddToPortfolio: () => void;
  onAnalyze: () => void;
  onDelete?: () => void;
  onOpenFinancials: () => void;
  onOpenNews: () => void;
  showDelete?: boolean;
}) {
  return (
    <div className="ml-auto grid shrink-0 grid-cols-3 justify-end gap-0.5 sm:flex sm:gap-1">
      <Button aria-label={copy.analyze} className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={onAnalyze} size="icon" title={copy.analyze} variant="ghost">
        <Sparkles />
      </Button>
      <Button aria-label={copy.financials} className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={onOpenFinancials} size="icon" title={copy.financials} variant="ghost">
        <FileText />
      </Button>
      <Button aria-label={copy.news} className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={onOpenNews} size="icon" title={copy.news} variant="ghost">
        <Newspaper />
      </Button>
      <Button
        aria-label={copy.addToPortfolio}
        className="h-7 w-7 text-muted-foreground hover:text-primary"
        disabled={category === "H"}
        onClick={onAddToPortfolio}
        size="icon"
        title={category === "H" ? copy.addPortfolioUnsupported : copy.addToPortfolio}
        variant="ghost"
      >
        <BriefcaseBusiness />
      </Button>
      {showDelete ? (
        <Button aria-label={copy.deleteItem} className="h-7 w-7" onClick={onDelete} size="icon" title={copy.deleteItem} variant="ghost">
          <Trash2 />
        </Button>
      ) : null}
    </div>
  );
}

export function WatchlistPage({
  language,
  onAnalyzeStock,
  onOpenFinancials,
  onOpenNews,
}: {
  language: AppLanguage;
  onAnalyzeStock: (symbol: string) => void;
  onOpenFinancials: (symbol: string) => void;
  onOpenNews: (symbol: string) => void;
}) {
  const common = i18n[language].common;
  const copy = i18n[language].watchlist;
  const watchlistCategories = getWatchlistCategories(language);
  const [category, setCategory] = useState<WatchlistCategory>(() => readStoredValue(WATCHLIST_CATEGORY_STORAGE_KEY, ["US", "A", "H"], "US"));
  const [mode, setMode] = useState<WatchlistMode>(() => readStoredValue(WATCHLIST_MODE_STORAGE_KEY, ["manage", "quotes"], "manage"));
  const [quoteView, setQuoteView] = useState<WatchlistQuoteView>(() => readStoredValue(WATCHLIST_QUOTE_VIEW_STORAGE_KEY, QUOTE_VIEWS, "movers"));
  const [localFilter, setLocalFilter] = useState(() => readStoredText(WATCHLIST_FILTER_STORAGE_KEY));
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WatchlistSearchResult[]>([]);
  const [overview, setOverview] = useState<WatchlistOverviewResponse | null>(null);
  const [overviewStale, setOverviewStale] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isOverviewLoading, setIsOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [message, setMessage] = useState("");

  const searchControllerRef = useRef<AbortController | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selectedCategory = watchlistCategories.find((item) => item.id === category);
  const filteredItems = useMemo(() => {
    const text = localFilter.trim().toLowerCase();
    if (!text) return items;
    return items.filter((item) => watchlistSearchText(item).includes(text));
  }, [items, localFilter]);
  const quoteRows = useMemo(() => {
    const rows = overview?.views?.[quoteView] ?? [];
    return rows.filter((row) => row.category === category);
  }, [category, overview?.views, quoteView]);
  const symbolSet = useMemo(() => new Set(items.map((item) => item.symbol)), [items]);
  const quoteStatus = overview
    ? formatTemplate(copy.quotesUpdated, {
      source: quoteSourceLabel(overview.source, copy),
      time: formatUpdatedAt(overview.fetched_at, language),
    })
    : copy.quotesNotLoaded;

  useEffect(() => {
    writeStoredValue(WATCHLIST_CATEGORY_STORAGE_KEY, category);
    const controller = new AbortController();
    setIsLoading(true);
    setMessage("");
    listWatchlist(category, { signal: controller.signal })
      .then((response) => setItems(response.items))
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setMessage(caught instanceof Error ? caught.message : copy.loadFailed);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [category, copy.loadFailed]);

  useEffect(() => {
    writeStoredValue(WATCHLIST_MODE_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    writeStoredValue(WATCHLIST_QUOTE_VIEW_STORAGE_KEY, quoteView);
  }, [quoteView]);

  useEffect(() => {
    writeStoredValue(WATCHLIST_FILTER_STORAGE_KEY, localFilter);
  }, [localFilter]);

  useEffect(() => {
    searchControllerRef.current?.abort();
    const text = query.trim();
    if (!text) {
      setResults([]);
      setIsSearching(false);
      return undefined;
    }

    const controller = new AbortController();
    searchControllerRef.current = controller;
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      setMessage("");
      searchWatchlist(text, category, { signal: controller.signal })
        .then((response) => {
          setResults(response.results);
          if (response.total === 0) setMessage(copy.noMatch);
        })
        .catch((caught) => {
          if (!controller.signal.aborted) {
            setResults([]);
            setMessage(caught instanceof Error ? caught.message : copy.searchFailed);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [category, copy.noMatch, copy.searchFailed, query]);

  function selectCategory(next: WatchlistCategory) {
    setCategory(next);
    setResults([]);
    setMessage("");
  }

  function selectMode(next: WatchlistMode) {
    setMode(next);
    if (next === "quotes" && !overview && !isOverviewLoading) {
      void loadOverview();
    }
  }

  function markOverviewStale() {
    if (overview) setOverviewStale(true);
  }

  async function loadOverview() {
    if (isOverviewLoading) return;
    setIsOverviewLoading(true);
    setOverviewError("");
    try {
      const response = await getWatchlistOverview();
      setOverview(response);
      setOverviewStale(false);
    } catch (caught) {
      setOverviewError(caught instanceof Error ? caught.message : copy.overviewFailed);
    } finally {
      setIsOverviewLoading(false);
    }
  }

  async function handleAdd(result: WatchlistSearchResult) {
    setMessage("");
    try {
      const item = await addWatchlistItem(result);
      if (item.category === category) {
        setItems((current) => [...current.filter((e) => e.symbol !== item.symbol), item]);
      }
      setResults((current) => current.filter((e) => e.symbol !== item.symbol));
      markOverviewStale();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : copy.addFailed);
    }
  }

  async function handleDelete(item: WatchlistItem) {
    const previous = items;
    setMessage("");
    setItems((current) => current.filter((e) => e.id !== item.id));
    try {
      await deleteWatchlistItem(item.id);
      markOverviewStale();
    } catch (caught) {
      setItems(previous);
      setMessage(caught instanceof Error ? caught.message : copy.deleteFailed);
    }
  }

  async function handleAddToPortfolio(item: WatchlistItem | WatchlistOverviewRow) {
    if (item.category === "H") {
      setMessage(copy.addPortfolioUnsupported);
      return;
    }
    setMessage("");
    try {
      await addPortfolioItem({
        market: item.category as PortfolioMarket,
        symbol: item.symbol,
        name: stockName(item) === "-" ? "" : stockName(item),
        shares: null,
        cost_price: null,
        note: "",
      });
      setMessage(formatTemplate(copy.addPortfolioSuccess, { symbol: item.symbol }));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : copy.addPortfolioFailed);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((current) => {
      const oldIndex = current.findIndex((e) => e.id === active.id);
      const newIndex = current.findIndex((e) => e.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      const previous = current;
      const next = arrayMove(current, oldIndex, newIndex);
      reorderWatchlist(next.map((e) => e.id))
        .then(markOverviewStale)
        .catch(() => {
          setItems(previous);
          setMessage(copy.reorderFailed);
        });
      return next;
    });
  }

  return (
    <section className="panel motion-panel page-enter finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="panel-header flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Star className="size-5 text-secondary" />
            <p className="font-semibold">{copy.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
        </div>

        <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row xl:items-center">
          <div className="inline-flex h-7 w-fit max-w-full shrink-0 items-center overflow-x-auto rounded-full border border-border bg-muted/45 p-0.5">
            {watchlistCategories.map((item) => (
              <button
                aria-pressed={category === item.id}
                className={cn(
                  "h-6 min-w-[4.25rem] rounded-full px-2.5 text-xs font-medium transition-colors",
                  category === item.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={item.id}
                onClick={() => selectCategory(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="inline-flex h-7 w-fit max-w-full shrink-0 items-center overflow-x-auto rounded-full border border-border bg-muted/45 p-0.5">
            {(["manage", "quotes"] as const).map((item) => (
              <button
                aria-pressed={mode === item}
                className={cn(
                  "h-6 min-w-[4.5rem] rounded-full px-2.5 text-xs font-medium transition-colors",
                  mode === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                key={item}
                onClick={() => selectMode(item)}
                type="button"
              >
                {item === "manage" ? copy.manageView : copy.quotesView}
              </button>
            ))}
          </div>
          <Badge variant="outline">{formatTemplate(copy.symbols, { count: items.length })}</Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 py-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden lg:py-4">
        <div className="finance-module flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
          <div className="finance-module-header flex flex-col gap-3 p-2 sm:p-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-semibold">
                {mode === "manage"
                  ? formatTemplate(copy.listTitle, { label: selectedCategory?.label ?? category })
                  : `${selectedCategory?.label ?? category} ${copy.quotesView}`}
              </p>
              <p className="hidden text-xs text-muted-foreground sm:block">
                {mode === "manage"
                  ? formatTemplate(copy.dragHint, { hint: selectedCategory?.hint ?? category })
                  : quoteStatus}
              </p>
            </div>
            {mode === "manage" ? (
              <div className="relative w-full xl:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label={copy.localFilter}
                  className="pl-8"
                  placeholder={copy.localFilterPlaceholder}
                  value={localFilter}
                  onChange={(event) => setLocalFilter(event.target.value)}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted/40 p-0.5">
                  {QUOTE_VIEWS.map((item) => (
                    <button
                      aria-pressed={quoteView === item}
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                        quoteView === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                      key={item}
                      onClick={() => setQuoteView(item)}
                      type="button"
                    >
                      {quoteViewLabel(item, copy)}
                    </button>
                  ))}
                </div>
                <Button className="shrink-0" disabled={isOverviewLoading} onClick={loadOverview} size="sm" type="button" variant="outline">
                  {isOverviewLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {copy.refreshQuotes}
                </Button>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 p-2 lg:overflow-y-auto lg:p-3">
            {mode === "manage" ? (
              <ManageList
                commonLoading={common.loading}
                copy={copy}
                filteredItems={filteredItems}
                isLoading={isLoading}
                items={items}
                onAddToPortfolio={handleAddToPortfolio}
                onAnalyze={onAnalyzeStock}
                onDelete={handleDelete}
                onDragEnd={handleDragEnd}
                onOpenFinancials={onOpenFinancials}
                onOpenNews={onOpenNews}
                sensors={sensors}
              />
            ) : (
              <QuoteList
                copy={copy}
                error={overviewError || overview?.error || overview?.quote_error || ""}
                isLoading={isOverviewLoading}
                onAddToPortfolio={handleAddToPortfolio}
                onAnalyze={onAnalyzeStock}
                onOpenFinancials={onOpenFinancials}
                onOpenNews={onOpenNews}
                onRefresh={loadOverview}
                overview={overview}
                rows={quoteRows}
                stale={overviewStale || Boolean(overview?.stale)}
              />
            )}
          </div>
        </div>

        <aside className="finance-module flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
          <div className="finance-module-header p-3">
            <form className="flex gap-2" onSubmit={(event) => event.preventDefault()}>
              <Input
                placeholder={selectedCategory?.placeholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button className="shrink-0" disabled={isSearching || !query.trim()} type="submit">
                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
                {common.search}
              </Button>
            </form>
            {message ? (
              <div className="finance-soft-state mt-3 rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {message}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 p-3 lg:overflow-y-auto">
            <div className="space-y-2">
              {results.map((result) => {
                const exists = symbolSet.has(result.symbol);
                return (
                  <div className="finance-row-card rounded-md border border-border/80 bg-card/80 p-3" key={result.symbol}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{result.symbol}</p>
                        <p className="truncate text-xs text-muted-foreground">{stockName(result)}</p>
                      </div>
                      <Button disabled={exists} onClick={() => handleAdd(result)} size="sm" variant={exists ? "outline" : "default"}>
                        <Plus />
                        {exists ? common.added : common.add}
                      </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <QuoteMetric label={copy.last} value={result.last_done ?? "-"} />
                      <QuoteMetric label={copy.change} value={result.change_value ?? "-"} tone={rateTone(result.change_value)} />
                      <QuoteMetric label={copy.rate} value={result.change_rate ?? "-"} tone={rateTone(result.change_rate)} />
                    </div>
                  </div>
                );
              })}
              {results.length === 0 ? (
                <div className="finance-soft-state rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                  {copy.inputHint}
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ManageList({
  commonLoading,
  copy,
  filteredItems,
  isLoading,
  items,
  onAddToPortfolio,
  onAnalyze,
  onDelete,
  onDragEnd,
  onOpenFinancials,
  onOpenNews,
  sensors,
}: {
  commonLoading: string;
  copy: typeof i18n.zh.watchlist;
  filteredItems: WatchlistItem[];
  isLoading: boolean;
  items: WatchlistItem[];
  onAddToPortfolio: (item: WatchlistItem) => void;
  onAnalyze: (symbol: string) => void;
  onDelete: (item: WatchlistItem) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onOpenFinancials: (symbol: string) => void;
  onOpenNews: (symbol: string) => void;
  sensors: ReturnType<typeof useSensors>;
}) {
  if (isLoading && items.length === 0) {
    return <SoftState icon={<Loader2 className="size-5 animate-spin" />}>{commonLoading}</SoftState>;
  }
  if (items.length === 0) {
    return (
      <SoftState icon={<Star className="size-8 text-muted-foreground" />}>
        <span className="block text-sm font-medium">{copy.emptyTitle}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{copy.emptyHint}</span>
      </SoftState>
    );
  }
  if (filteredItems.length === 0) {
    return <SoftState icon={<Search className="size-6 text-muted-foreground" />}>{copy.localNoMatch}</SoftState>;
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={filteredItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="grid gap-1.5 sm:gap-2 2xl:grid-cols-2">
          {filteredItems.map((item) => (
            <SortableWatchlistItem
              copy={copy}
              item={item}
              key={item.id}
              onAddToPortfolio={onAddToPortfolio}
              onAnalyze={onAnalyze}
              onDelete={onDelete}
              onOpenFinancials={onOpenFinancials}
              onOpenNews={onOpenNews}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function QuoteList({
  copy,
  error,
  isLoading,
  onAddToPortfolio,
  onAnalyze,
  onOpenFinancials,
  onOpenNews,
  onRefresh,
  overview,
  rows,
  stale,
}: {
  copy: typeof i18n.zh.watchlist;
  error: string;
  isLoading: boolean;
  onAddToPortfolio: (item: WatchlistOverviewRow) => void;
  onAnalyze: (symbol: string) => void;
  onOpenFinancials: (symbol: string) => void;
  onOpenNews: (symbol: string) => void;
  onRefresh: () => void;
  overview: WatchlistOverviewResponse | null;
  rows: WatchlistOverviewRow[];
  stale: boolean;
}) {
  if (!overview && isLoading) {
    return <SoftState icon={<Loader2 className="size-5 animate-spin" />}>{copy.quotesLoading}</SoftState>;
  }
  if (!overview) {
    return (
      <SoftState icon={<Activity className="size-7 text-muted-foreground" />}>
        <span className="block">{copy.quotesNotLoaded}</span>
        <Button className="mt-3" disabled={isLoading} onClick={onRefresh} size="sm" type="button" variant="outline">
          {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {copy.refreshQuotes}
        </Button>
      </SoftState>
    );
  }
  return (
    <div className="space-y-3">
      {stale ? <InlineState>{copy.quotesStale}</InlineState> : null}
      {error ? <InlineState>{error}</InlineState> : null}
      {rows.length === 0 ? (
        <SoftState icon={<Activity className="size-7 text-muted-foreground" />}>{copy.noQuoteRows}</SoftState>
      ) : (
        <div className="grid gap-2 2xl:grid-cols-2">
          {rows.map((item) => (
            <QuoteWatchlistItem
              copy={copy}
              item={item}
              key={`${item.id}-${item.symbol}`}
              onAddToPortfolio={onAddToPortfolio}
              onAnalyze={onAnalyze}
              onOpenFinancials={onOpenFinancials}
              onOpenNews={onOpenNews}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SoftState({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="finance-soft-state grid h-full min-h-56 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 text-center text-sm text-muted-foreground">
      <div>
        {icon ? <div className="mb-3 flex justify-center">{icon}</div> : null}
        {children}
      </div>
    </div>
  );
}

function InlineState({ children }: { children: React.ReactNode }) {
  return (
    <div className="finance-soft-state rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      {children}
    </div>
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

function stockName(item: NameParts) {
  return item.name || item.name_cn || item.name_hk || item.name_en || "-";
}

function watchlistSearchText(item: NameParts & { symbol: string; exchange?: string; currency?: string; note?: string }) {
  return [item.symbol, item.name, item.name_cn, item.name_hk, item.name_en, item.exchange, item.currency, item.note]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function rateTone(value: string | null): "up" | "down" | "flat" {
  if (!value) return "flat";
  if (value.startsWith("-")) return "down";
  if (value !== "-" && value !== "0" && value !== "0.00%") return "up";
  return "flat";
}

function formatCompactValue(value: string | null): string {
  if (!value) return "-";
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return value;
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 1, notation: "compact" });
}

function quoteViewLabel(view: WatchlistQuoteView, copy: typeof i18n.zh.watchlist) {
  if (view === "gainers") return copy.quoteGainers;
  if (view === "losers") return copy.quoteLosers;
  if (view === "active") return copy.quoteActive;
  return copy.quoteMovers;
}

function quoteSourceLabel(source: WatchlistOverviewResponse["source"], copy: typeof i18n.zh.watchlist) {
  if (source === "live") return copy.quoteSourceLive;
  if (source === "cache") return copy.quoteSourceCache;
  return copy.quoteSourceLocal;
}

function formatUpdatedAt(value: string | null | undefined, language: AppLanguage) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(localeFor(language), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
