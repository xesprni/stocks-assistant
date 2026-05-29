import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BriefcaseBusiness, FileText, GripVertical, Loader2, Newspaper, Plus, Search, Sparkles, Star, Trash2 } from "lucide-react";
import { DndContext, DragOverlay, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent, type UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Badge } from "@/components/ui/badge";
import TechnicalAnalysis from "@/components/TechnicalAnalysis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addPortfolioItem, addWatchlistItem, deleteWatchlistItem, listWatchlist, reorderWatchlist, searchWatchlist } from "@/lib/api";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PortfolioMarket, WatchlistCategory, WatchlistItem, WatchlistSearchResult } from "@/types/app";

type NameParts = Pick<WatchlistItem, "name" | "name_cn" | "name_hk" | "name_en">;

const WATCHLIST_CATEGORY_STORAGE_KEY = "stocks-assistant-watchlist-category";
const WATCHLIST_FILTER_STORAGE_KEY = "stocks-assistant-watchlist-filter";

type DragPreviewSize = {
  width: number;
  height: number;
};

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
  activeSymbol,
  onDelete,
  onAnalyze,
  onAddToPortfolio,
  onOpenFinancials,
  onOpenNews,
  onSelect,
  copy,
}: {
  item: WatchlistItem;
  activeSymbol: string;
  onDelete: (item: WatchlistItem) => void;
  onAnalyze: (symbol: string) => void;
  onAddToPortfolio: (item: WatchlistItem) => void;
  onOpenFinancials: (symbol: string) => void;
  onOpenNews: (symbol: string) => void;
  onSelect: (item: WatchlistItem) => void;
  copy: typeof i18n.zh.watchlist;
}) {
  const { active, attributes, listeners, over, setNodeRef, transform, transition, isDragging, isSorting } = useSortable({
    id: item.id,
  });
  const isDropTarget = over?.id === item.id && active?.id !== item.id;
  const pressStartedAtRef = useRef(0);
  const suppressNextClickRef = useRef(false);
  const style: CSSProperties = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition: [
      transition,
      "background-color 180ms ease",
      "border-color 180ms ease",
      "box-shadow 180ms ease",
      "opacity 140ms ease",
    ].filter(Boolean).join(", "),
    opacity: isDragging ? 0.34 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const isSelected = activeSymbol === item.symbol;

  return (
    <div
      className={cn(
        "watchlist-sortable-row finance-row-card message-bubble select-none rounded-md border border-border/80 bg-card/80 p-2 outline-none transition-colors hover:border-primary/50 focus-visible:border-primary sm:p-3",
        isDragging && "watchlist-sortable-row-dragging",
        isDropTarget && "watchlist-sortable-row-over",
        isSorting && !isDragging && "watchlist-sortable-row-sorting",
      )}
      data-dragging={isDragging ? "true" : undefined}
      data-drop-target={isDropTarget ? "true" : undefined}
      data-selected={isSelected ? "true" : undefined}
      onClick={(event) => {
        if (suppressNextClickRef.current) {
          event.preventDefault();
          suppressNextClickRef.current = false;
          return;
        }
        onSelect(item);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(item);
        }
      }}
      onPointerCancel={() => {
        pressStartedAtRef.current = 0;
        suppressNextClickRef.current = false;
      }}
      onPointerDown={(event) => {
        pressStartedAtRef.current = event.timeStamp;
        suppressNextClickRef.current = false;
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== "mouse" && event.timeStamp - pressStartedAtRef.current > 420) {
          suppressNextClickRef.current = true;
        }
      }}
      role="button"
      ref={setNodeRef}
      style={style}
      tabIndex={0}
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          {...attributes}
          {...listeners}
          aria-label={copy.dragSort}
          className={cn(
            "watchlist-drag-handle grid size-7 shrink-0 cursor-grab touch-none select-none place-items-center text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing",
            (isDragging || isDropTarget) && "text-primary",
          )}
          onClick={(event) => event.stopPropagation()}
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

function WatchlistDragPreview({
  copy,
  item,
  size,
}: {
  copy: typeof i18n.zh.watchlist;
  item: WatchlistItem;
  size: DragPreviewSize | null;
}) {
  const style: CSSProperties | undefined = size
    ? { maxWidth: "calc(100vw - 2rem)", minHeight: size.height, width: size.width }
    : undefined;

  return (
    <div className={cn("watchlist-drag-overlay rounded-md px-3 py-2.5", !size && "min-w-[min(22rem,calc(100vw-2rem))]")} style={style}>
      <div className="flex items-center gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <GripVertical className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.symbol}</p>
          <p className="truncate text-xs text-muted-foreground">{stockName(item)}</p>
        </div>
        <Badge className="h-5 px-1.5 text-[10px]" variant="outline">{item.category}</Badge>
        <span className="sr-only">{copy.dragSort}</span>
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
      <Button aria-label={copy.analyze} className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={(event) => { event.stopPropagation(); onAnalyze(); }} size="icon" title={copy.analyze} variant="ghost">
        <Sparkles />
      </Button>
      <Button aria-label={copy.financials} className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={(event) => { event.stopPropagation(); onOpenFinancials(); }} size="icon" title={copy.financials} variant="ghost">
        <FileText />
      </Button>
      <Button aria-label={copy.news} className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={(event) => { event.stopPropagation(); onOpenNews(); }} size="icon" title={copy.news} variant="ghost">
        <Newspaper />
      </Button>
      <Button
        aria-label={copy.addToPortfolio}
        className="h-7 w-7 text-muted-foreground hover:text-primary"
        disabled={category === "H"}
        onClick={(event) => { event.stopPropagation(); onAddToPortfolio(); }}
        size="icon"
        title={category === "H" ? copy.addPortfolioUnsupported : copy.addToPortfolio}
        variant="ghost"
      >
        <BriefcaseBusiness />
      </Button>
      {showDelete ? (
        <Button aria-label={copy.deleteItem} className="h-7 w-7" onClick={(event) => { event.stopPropagation(); onDelete?.(); }} size="icon" title={copy.deleteItem} variant="ghost">
          <Trash2 />
        </Button>
      ) : null}
    </div>
  );
}

export function WatchlistPage({
  language,
  selectedSymbol = "",
  onSelectedSymbolChange,
  onAnalyzeStock,
  onOpenFinancials,
  onOpenNews,
}: {
  language: AppLanguage;
  selectedSymbol?: string;
  onSelectedSymbolChange?: (symbol: string) => void;
  onAnalyzeStock: (symbol: string) => void;
  onOpenFinancials: (symbol: string) => void;
  onOpenNews: (symbol: string) => void;
}) {
  const common = i18n[language].common;
  const copy = i18n[language].watchlist;
  const watchlistCategories = getWatchlistCategories(language);
  const [category, setCategory] = useState<WatchlistCategory>(() =>
    inferCategoryFromSymbol(selectedSymbol) ?? readStoredValue(WATCHLIST_CATEGORY_STORAGE_KEY, ["US", "A", "H"], "US"),
  );
  const [activeSymbol, setActiveSymbol] = useState(selectedSymbol);
  const [localFilter, setLocalFilter] = useState(() => readStoredText(WATCHLIST_FILTER_STORAGE_KEY));
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [activeDragId, setActiveDragId] = useState<UniqueIdentifier | null>(null);
  const [activeDragSize, setActiveDragSize] = useState<DragPreviewSize | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WatchlistSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState("");

  const searchControllerRef = useRef<AbortController | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selectedCategory = watchlistCategories.find((item) => item.id === category);
  const filteredItems = useMemo(() => {
    const text = localFilter.trim().toLowerCase();
    if (!text) return items;
    return items.filter((item) => watchlistSearchText(item).includes(text));
  }, [items, localFilter]);
  const symbolSet = useMemo(() => new Set(items.map((item) => item.symbol)), [items]);
  const activeDragItem = useMemo(
    () => items.find((item) => item.id === activeDragId) ?? null,
    [activeDragId, items],
  );

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
    if (!selectedSymbol || selectedSymbol === activeSymbol) return;
    const inferred = inferCategoryFromSymbol(selectedSymbol);
    if (inferred && inferred !== category) setCategory(inferred);
    setActiveSymbol(selectedSymbol);
  }, [activeSymbol, category, selectedSymbol]);

  useEffect(() => {
    if (activeSymbol) return;
    const fallback = filteredItems[0] ?? items[0];
    if (!fallback) return;
    setActiveSymbol(fallback.symbol);
    onSelectedSymbolChange?.(fallback.symbol);
  }, [activeSymbol, filteredItems, items, onSelectedSymbolChange]);

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
    if (next === category) return;
    setCategory(next);
    setItems([]);
    setActiveSymbol("");
    onSelectedSymbolChange?.("");
    setResults([]);
    setMessage("");
  }

  const handleSelectSymbol = useCallback((itemOrSymbol: WatchlistItem | string) => {
    const nextSymbol = typeof itemOrSymbol === "string" ? itemOrSymbol : itemOrSymbol.symbol;
    if (!nextSymbol) return;
    setActiveSymbol(nextSymbol);
    onSelectedSymbolChange?.(nextSymbol);
  }, [onSelectedSymbolChange]);

  async function handleAdd(result: WatchlistSearchResult) {
    setMessage("");
    try {
      const item = await addWatchlistItem(result);
      if (item.category === category) {
        setItems((current) => [...current.filter((e) => e.symbol !== item.symbol), item]);
        handleSelectSymbol(item);
      }
      setResults((current) => current.filter((e) => e.symbol !== item.symbol));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : copy.addFailed);
    }
  }

  async function handleDelete(item: WatchlistItem) {
    const previous = items;
    const wasActive = item.symbol === activeSymbol;
    setMessage("");
    setItems((current) => current.filter((e) => e.id !== item.id));
    if (wasActive) setActiveSymbol("");
    try {
      await deleteWatchlistItem(item.id);
    } catch (caught) {
      setItems(previous);
      if (wasActive) setActiveSymbol(item.symbol);
      setMessage(caught instanceof Error ? caught.message : copy.deleteFailed);
    }
  }

  async function handleAddToPortfolio(item: WatchlistItem) {
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

  function handleDragStart(event: DragStartEvent) {
    const initialRect = event.active.rect.current.initial;
    setActiveDragId(event.active.id);
    setActiveDragSize(initialRect ? { height: initialRect.height, width: initialRect.width } : null);
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setActiveDragSize(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    setActiveDragSize(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((current) => {
      const oldIndex = current.findIndex((e) => e.id === active.id);
      const newIndex = current.findIndex((e) => e.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      const previous = current;
      const next = arrayMove(current, oldIndex, newIndex);
      reorderWatchlist(next.map((e) => e.id))
        .catch(() => {
          setItems(previous);
          setMessage(copy.reorderFailed);
        });
      return next;
    });
  }

  return (
    <section className="watchlist-page-shell panel motion-panel page-enter finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="panel-header flex flex-col gap-3 border-b border-border/70 bg-background/70 px-3 py-2 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Star className="size-5 text-secondary" />
            <p className="font-semibold">{copy.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
        </div>

        <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row xl:items-center">
          <div className="inline-flex h-8 w-fit max-w-full shrink-0 items-center overflow-x-auto rounded-full border border-border bg-muted/45 p-0.5">
            {watchlistCategories.map((item) => (
              <button
                aria-pressed={category === item.id}
                className={cn(
                  "h-7 min-w-[4.25rem] rounded-full px-2.5 text-xs font-medium transition-colors",
                  category === item.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                key={item.id}
                onClick={() => selectCategory(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <Badge variant="outline">{formatTemplate(copy.symbols, { count: items.length })}</Badge>
        </div>
      </div>

      <div className="watchlist-page-grid grid min-h-0 flex-1 gap-4 py-3 lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden lg:py-4">
        <aside className="watchlist-list-shell finance-module flex min-h-0 flex-col overflow-hidden rounded-md border border-border/80 bg-card/45">
          <div className="finance-module-header space-y-3 border-b border-border/70 p-3">
            <div>
              <p className="text-sm font-semibold">{formatTemplate(copy.listTitle, { label: selectedCategory?.label ?? category })}</p>
              <p className="hidden text-xs text-muted-foreground sm:block">
                {formatTemplate(copy.dragHint, { hint: selectedCategory?.hint ?? category })}
              </p>
            </div>

            <form className="flex gap-2" onSubmit={(event) => event.preventDefault()}>
              <Input
                className="h-8"
                placeholder={selectedCategory?.placeholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button className="h-8 shrink-0" disabled={isSearching || !query.trim()} size="sm" type="submit" variant="outline">
                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
                {common.search}
              </Button>
            </form>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={copy.localFilter}
                className="h-8 pl-8"
                placeholder={copy.localFilterPlaceholder}
                value={localFilter}
                onChange={(event) => setLocalFilter(event.target.value)}
              />
            </div>

            {message ? (
              <div className="finance-soft-state rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {message}
              </div>
            ) : null}

            {(query.trim() || results.length > 0) ? (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {results.map((result) => {
                  const exists = symbolSet.has(result.symbol);
                  return (
                    <div className="finance-row-card rounded-md border border-border/80 bg-card/80 p-2.5" key={result.symbol}>
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
                      <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
                        <QuoteMetric label={copy.last} value={result.last_done ?? "-"} />
                        <QuoteMetric label={copy.change} value={result.change_value ?? "-"} tone={rateTone(result.change_value)} />
                        <QuoteMetric label={copy.rate} value={result.change_rate ?? "-"} tone={rateTone(result.change_rate)} />
                      </div>
                    </div>
                  );
                })}
                {results.length === 0 && !isSearching ? (
                  <div className="finance-soft-state rounded-md border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                    {copy.inputHint}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overscroll-contain p-2 lg:overflow-y-auto">
            <ManageList
              activeDragItem={activeDragItem}
              activeDragSize={activeDragSize}
              activeSymbol={activeSymbol}
              commonLoading={common.loading}
              copy={copy}
              filteredItems={filteredItems}
              isLoading={isLoading}
              items={items}
              onAddToPortfolio={handleAddToPortfolio}
              onAnalyze={onAnalyzeStock}
              onDelete={handleDelete}
              onDragCancel={handleDragCancel}
              onDragEnd={handleDragEnd}
              onDragStart={handleDragStart}
              onOpenFinancials={onOpenFinancials}
              onOpenNews={onOpenNews}
              onSelect={handleSelectSymbol}
              sensors={sensors}
            />
          </div>
        </aside>

        <div className="watchlist-analysis-shell finance-module flex min-h-[560px] min-w-0 flex-col overflow-hidden overscroll-contain rounded-md border border-border/80 bg-card/45 sm:min-h-[640px] lg:min-h-0">
          {activeSymbol ? (
            <TechnicalAnalysis
              embedded
              language={language}
              symbol={activeSymbol}
              onSymbolChange={handleSelectSymbol}
            />
          ) : (
            <SoftState icon={<Star className="size-8 text-muted-foreground" />}>
              <span className="block text-sm font-medium">{copy.emptyTitle}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{copy.emptyHint}</span>
            </SoftState>
          )}
        </div>
      </div>
    </section>
  );
}

function ManageList({
  activeDragItem,
  activeDragSize,
  activeSymbol,
  commonLoading,
  copy,
  filteredItems,
  isLoading,
  items,
  onAddToPortfolio,
  onAnalyze,
  onDelete,
  onDragCancel,
  onDragEnd,
  onDragStart,
  onOpenFinancials,
  onOpenNews,
  onSelect,
  sensors,
}: {
  activeDragItem: WatchlistItem | null;
  activeDragSize: DragPreviewSize | null;
  activeSymbol: string;
  commonLoading: string;
  copy: typeof i18n.zh.watchlist;
  filteredItems: WatchlistItem[];
  isLoading: boolean;
  items: WatchlistItem[];
  onAddToPortfolio: (item: WatchlistItem) => void;
  onAnalyze: (symbol: string) => void;
  onDelete: (item: WatchlistItem) => void;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart: (event: DragStartEvent) => void;
  onOpenFinancials: (symbol: string) => void;
  onOpenNews: (symbol: string) => void;
  onSelect: (item: WatchlistItem) => void;
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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragCancel={onDragCancel} onDragEnd={onDragEnd} onDragStart={onDragStart}>
      <SortableContext items={filteredItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="grid gap-1.5">
          {filteredItems.map((item) => (
            <SortableWatchlistItem
              activeSymbol={activeSymbol}
              copy={copy}
              item={item}
              key={item.id}
              onAddToPortfolio={onAddToPortfolio}
              onAnalyze={onAnalyze}
              onDelete={onDelete}
              onOpenFinancials={onOpenFinancials}
              onOpenNews={onOpenNews}
              onSelect={onSelect}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay adjustScale={false} dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
        {activeDragItem ? <WatchlistDragPreview copy={copy} item={activeDragItem} size={activeDragSize} /> : null}
      </DragOverlay>
    </DndContext>
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

function inferCategoryFromSymbol(symbol: string): WatchlistCategory | null {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.endsWith(".US")) return "US";
  if (normalized.endsWith(".HK")) return "H";
  if (normalized.endsWith(".SH") || normalized.endsWith(".SZ") || normalized.endsWith(".CN")) return "A";
  return null;
}
