import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FileText, GripVertical, Loader2, Search, Star, Trash2 } from "lucide-react";
import { DndContext, DragOverlay, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent, type UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/common/Toast";
import TechnicalAnalysis from "@/components/TechnicalAnalysis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addWatchlistItem, deleteWatchlistItem, getWatchlistOverview, listWatchlist, reorderWatchlist, searchWatchlist } from "@/lib/api";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { WatchlistCategory, WatchlistItem, WatchlistSearchResult } from "@/types/app";

type NameParts = Pick<WatchlistItem, "name" | "name_cn" | "name_hk" | "name_en">;

const WATCHLIST_CATEGORY_STORAGE_KEY = "stocks-assistant-watchlist-category";
const DEFAULT_WATCHLIST_REFRESH_SECONDS = 5;
const WATCHLIST_REFRESH_STORAGE_KEY = "stocks-assistant.intraday-refresh-seconds";

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

function writeStoredValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 本地存储不可用时退回当前页面状态。
  }
}

function loadStoredWatchlistRefreshSeconds() {
  try {
    const stored = window.localStorage.getItem(WATCHLIST_REFRESH_STORAGE_KEY);
    const parsed = stored == null ? DEFAULT_WATCHLIST_REFRESH_SECONDS : Number(stored);
    if (!Number.isFinite(parsed)) return DEFAULT_WATCHLIST_REFRESH_SECONDS;
    return Math.min(10, Math.max(1, Math.round(parsed)));
  } catch {
    return DEFAULT_WATCHLIST_REFRESH_SECONDS;
  }
}

function SortableWatchlistItem({
  item,
  activeSymbol,
  onDelete,
  onOpenFinancials,
  onSelect,
  copy,
}: {
  item: WatchlistItem;
  activeSymbol: string;
  onDelete: (item: WatchlistItem) => void;
  onOpenFinancials: (symbol: string) => void;
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
        "watchlist-sortable-row finance-row-card message-bubble select-none rounded-md border border-border/80 bg-card/80 p-1.5 outline-none transition-colors hover:border-primary/50 focus-visible:border-primary sm:p-2",
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
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          {...attributes}
          {...listeners}
          aria-label={copy.dragSort}
          className={cn(
            "watchlist-drag-handle grid size-6 shrink-0 cursor-grab touch-none select-none place-items-center text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing",
            (isDragging || isDropTarget) && "text-primary",
          )}
          onClick={(event) => event.stopPropagation()}
          type="button"
        >
          <GripVertical className="size-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold sm:text-sm">{item.symbol}</p>
          <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{stockName(item)}</p>
        </div>
        <RowActions
          copy={copy}
          onDelete={() => onDelete(item)}
          onOpenFinancials={() => onOpenFinancials(item.symbol)}
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
  copy,
  onDelete,
  onOpenFinancials,
  showDelete = false,
}: {
  copy: typeof i18n.zh.watchlist;
  onDelete?: () => void;
  onOpenFinancials: () => void;
  showDelete?: boolean;
}) {
  return (
    <div className="ml-auto flex shrink-0 justify-end gap-0.5">
      <Button aria-label={copy.financials} className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={(event) => { event.stopPropagation(); onOpenFinancials(); }} size="icon" title={copy.financials} variant="ghost">
        <FileText />
      </Button>
      {showDelete ? (
        <Button aria-label={copy.deleteItem} className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={(event) => { event.stopPropagation(); onDelete?.(); }} size="icon" title={copy.deleteItem} variant="ghost">
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
  onOpenFinancials,
}: {
  language: AppLanguage;
  selectedSymbol?: string;
  onSelectedSymbolChange?: (symbol: string) => void;
  onOpenFinancials: (symbol: string) => void;
}) {
  const common = i18n[language].common;
  const copy = i18n[language].watchlist;
  const watchlistCategories = getWatchlistCategories(language);
  const [category, setCategory] = useState<WatchlistCategory>(() =>
    inferCategoryFromSymbol(selectedSymbol) ?? readStoredValue(WATCHLIST_CATEGORY_STORAGE_KEY, ["US", "A", "H"], "US"),
  );
  const [activeSymbol, setActiveSymbol] = useState(selectedSymbol);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [activeDragId, setActiveDragId] = useState<UniqueIdentifier | null>(null);
  const [activeDragSize, setActiveDragSize] = useState<DragPreviewSize | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WatchlistSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isRefreshingQuotes, setIsRefreshingQuotes] = useState(false);

  const searchControllerRef = useRef<AbortController | null>(null);
  const quoteRefreshInFlightRef = useRef(false);
  const lastErrorToastRef = useRef({ message: "", time: 0 });
  const { showToast } = useToast();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selectedCategory = watchlistCategories.find((item) => item.id === category);
  const symbolSet = useMemo(() => new Set(items.map((item) => item.symbol)), [items]);
  const activeDragItem = useMemo(
    () => items.find((item) => item.id === activeDragId) ?? null,
    [activeDragId, items],
  );
  const showWatchlistError = useCallback((text: string) => {
    const message = text.trim();
    if (!message) return;
    const now = Date.now();
    if (lastErrorToastRef.current.message === message && now - lastErrorToastRef.current.time < 15_000) return;
    lastErrorToastRef.current = { message, time: now };
    showToast({ kind: "error", message, title: copy.title });
  }, [copy.title, showToast]);

  useEffect(() => {
    writeStoredValue(WATCHLIST_CATEGORY_STORAGE_KEY, category);
    const controller = new AbortController();
    setIsLoading(true);
    listWatchlist(category, { signal: controller.signal })
      .then((response) => setItems(response.items))
      .catch((caught) => {
        if (!controller.signal.aborted) {
          showWatchlistError(caught instanceof Error ? caught.message : copy.loadFailed);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [category, copy.loadFailed, showWatchlistError]);

  useEffect(() => {
    if (!selectedSymbol || selectedSymbol === activeSymbol) return;
    const inferred = inferCategoryFromSymbol(selectedSymbol);
    if (inferred && inferred !== category) setCategory(inferred);
    setActiveSymbol(selectedSymbol);
  }, [activeSymbol, category, selectedSymbol]);

  useEffect(() => {
    if (activeSymbol) return;
    const fallback = items[0];
    if (!fallback) return;
    setActiveSymbol(fallback.symbol);
    onSelectedSymbolChange?.(fallback.symbol);
  }, [activeSymbol, items, onSelectedSymbolChange]);

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
    setResults([]);
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      searchWatchlist(text, category, { signal: controller.signal })
        .then((response) => {
          setResults(response.results);
        })
        .catch((caught) => {
          if (!controller.signal.aborted) {
            setResults([]);
            showWatchlistError(caught instanceof Error ? caught.message : copy.searchFailed);
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
  }, [category, copy.searchFailed, query, showWatchlistError]);

  function selectCategory(next: WatchlistCategory) {
    if (next === category) return;
    setCategory(next);
    setItems([]);
    setActiveSymbol("");
    onSelectedSymbolChange?.("");
    setResults([]);
  }

  const handleSelectSymbol = useCallback((itemOrSymbol: WatchlistItem | string) => {
    const nextSymbol = typeof itemOrSymbol === "string" ? itemOrSymbol : itemOrSymbol.symbol;
    if (!nextSymbol) return;
    setActiveSymbol(nextSymbol);
    onSelectedSymbolChange?.(nextSymbol);
  }, [onSelectedSymbolChange]);

  async function handleAdd(result: WatchlistSearchResult) {
    try {
      const item = await addWatchlistItem(result);
      if (item.category === category) {
        setItems((current) => [...current.filter((e) => e.symbol !== item.symbol), item]);
        handleSelectSymbol(item);
      }
    } catch (caught) {
      showWatchlistError(caught instanceof Error ? caught.message : copy.addFailed);
    }
  }

  async function handleDelete(item: WatchlistItem) {
    const previous = items;
    const wasActive = item.symbol === activeSymbol;
    setItems((current) => current.filter((e) => e.id !== item.id));
    if (wasActive) setActiveSymbol("");
    try {
      await deleteWatchlistItem(item.id);
    } catch (caught) {
      setItems(previous);
      if (wasActive) setActiveSymbol(item.symbol);
      showWatchlistError(caught instanceof Error ? caught.message : copy.deleteFailed);
    }
  }

  const handleRefreshQuotes = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (quoteRefreshInFlightRef.current) return;
    quoteRefreshInFlightRef.current = true;
    setIsRefreshingQuotes(true);
    try {
      const response = await getWatchlistOverview();
      const nextItems = response.items.filter((item) => item.category === category);
      setItems(nextItems);
      if (activeSymbol && !nextItems.some((item) => item.symbol === activeSymbol)) {
        setActiveSymbol("");
        onSelectedSymbolChange?.("");
      }
      if (response.quote_error || response.error) {
        showWatchlistError(response.quote_error || response.error || copy.overviewFailed);
        return;
      }
      if (!silent) {
        const time = formatQuoteTime(response.fetched_at, language);
        const source = quoteSourceLabel(response.source, copy);
        showToast({
          kind: "success",
          message: formatTemplate(copy.quotesUpdated, { time, source }),
          title: copy.title,
        });
      }
    } catch (caught) {
      showWatchlistError(caught instanceof Error ? caught.message : copy.overviewFailed);
    } finally {
      quoteRefreshInFlightRef.current = false;
      setIsRefreshingQuotes(false);
    }
  }, [activeSymbol, category, copy, language, onSelectedSymbolChange, showToast, showWatchlistError]);

  useEffect(() => {
    if (items.length === 0) return;
    void handleRefreshQuotes({ silent: true });
    const intervalSeconds = loadStoredWatchlistRefreshSeconds();
    const timer = window.setInterval(() => {
      void handleRefreshQuotes({ silent: true });
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [category, handleRefreshQuotes, items.length]);

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
          showWatchlistError(copy.reorderFailed);
        });
      return next;
    });
  }

  return (
    <section className="watchlist-page-shell panel motion-panel page-enter finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar watchlist-compact-toolbar flex flex-nowrap items-center justify-between gap-1.5 overflow-x-auto md:gap-2">
        <div className="inline-flex h-6 w-fit max-w-full shrink-0 items-center overflow-x-auto rounded-full border border-border bg-muted/45 p-0.5">
          {watchlistCategories.map((item) => (
            <button
              aria-pressed={category === item.id}
              className={cn(
                "h-5 min-w-[3.25rem] rounded-full px-1.5 text-[11px] font-medium transition-colors sm:min-w-[4rem] sm:px-2",
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
        <Badge className="h-6 shrink-0 gap-1 px-1.5 text-[11px]" variant="outline">
          {isRefreshingQuotes ? <Loader2 className="size-3 animate-spin" /> : null}
          {formatTemplate(copy.symbols, { count: items.length })}
        </Badge>
      </div>

      <div className="watchlist-page-grid grid min-h-0 flex-1 gap-3 pt-1.5 pb-3 lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden lg:gap-0 lg:pt-2 lg:pb-4">
        <aside className="watchlist-list-shell finance-module flex min-h-0 flex-col overflow-hidden rounded-md border border-border/80 bg-card/45">
          <div className="finance-module-header space-y-2 border-b border-border/70 p-2">
            <div>
              <p className="text-sm font-semibold">{formatTemplate(copy.listTitle, { label: selectedCategory?.label ?? category })}</p>
              <p className="hidden text-xs text-muted-foreground sm:block">
                {formatTemplate(copy.dragHint, { hint: selectedCategory?.hint ?? category })}
              </p>
            </div>

            <div className="relative z-20">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={common.search}
                className="h-8 pr-8 pl-8"
                placeholder={selectedCategory?.placeholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {isSearching ? <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
              {query.trim() ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-30 max-h-64 overflow-y-auto rounded-md border border-border/90 bg-popover p-1 text-popover-foreground shadow-xl">
                  {isSearching && results.length === 0 ? (
                    <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      {common.loading}
                    </div>
                  ) : null}
                  {results.map((result) => {
                    const exists = symbolSet.has(result.symbol);
                    return (
                      <div className="flex min-h-8 items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted/60" key={result.symbol}>
                        <span className="min-w-0 flex-1 truncate">{searchResultName(result)}</span>
                        <button
                          aria-label={exists ? common.added : common.add}
                          className={cn(
                            "grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-primary",
                            exists && "text-primary hover:bg-transparent",
                          )}
                          disabled={exists}
                          onClick={() => void handleAdd(result)}
                          title={exists ? common.added : common.add}
                          type="button"
                        >
                          <Star className="size-4" fill={exists ? "currentColor" : "none"} />
                        </button>
                      </div>
                    );
                  })}
                  {results.length === 0 && !isSearching ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground">
                      {copy.noMatch}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

          </div>

          <div className="min-h-0 flex-1 overscroll-contain p-2 lg:overflow-y-auto">
            <ManageList
              activeDragItem={activeDragItem}
              activeDragSize={activeDragSize}
              activeSymbol={activeSymbol}
              commonLoading={common.loading}
              copy={copy}
              isLoading={isLoading}
              items={items}
              onDelete={handleDelete}
              onDragCancel={handleDragCancel}
              onDragEnd={handleDragEnd}
              onDragStart={handleDragStart}
              onOpenFinancials={onOpenFinancials}
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
  isLoading,
  items,
  onDelete,
  onDragCancel,
  onDragEnd,
  onDragStart,
  onOpenFinancials,
  onSelect,
  sensors,
}: {
  activeDragItem: WatchlistItem | null;
  activeDragSize: DragPreviewSize | null;
  activeSymbol: string;
  commonLoading: string;
  copy: typeof i18n.zh.watchlist;
  isLoading: boolean;
  items: WatchlistItem[];
  onDelete: (item: WatchlistItem) => void;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart: (event: DragStartEvent) => void;
  onOpenFinancials: (symbol: string) => void;
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
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragCancel={onDragCancel} onDragEnd={onDragEnd} onDragStart={onDragStart}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="grid gap-1">
          {items.map((item) => (
            <SortableWatchlistItem
              activeSymbol={activeSymbol}
              copy={copy}
              item={item}
              key={item.id}
              onDelete={onDelete}
              onOpenFinancials={onOpenFinancials}
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

function stockName(item: NameParts) {
  return item.name || item.name_cn || item.name_hk || item.name_en || "-";
}

function searchResultName(item: NameParts & { symbol: string }) {
  const name = stockName(item);
  return name === "-" ? item.symbol : name;
}

function formatQuoteTime(value: string | null | undefined, language: AppLanguage) {
  if (!value) return new Date().toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function quoteSourceLabel(source: string | null | undefined, copy: typeof i18n.zh.watchlist) {
  if (source === "cache") return copy.quoteSourceCache;
  if (source === "live") return copy.quoteSourceLive;
  return copy.quoteSourceLocal;
}

function inferCategoryFromSymbol(symbol: string): WatchlistCategory | null {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.endsWith(".US")) return "US";
  if (normalized.endsWith(".HK")) return "H";
  if (normalized.endsWith(".SH") || normalized.endsWith(".SZ") || normalized.endsWith(".CN")) return "A";
  return null;
}
