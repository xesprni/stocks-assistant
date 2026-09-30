import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent, type UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FileText, Folder, GripVertical, Loader2, Plus, Search, Star, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { SideDrawer } from "@/components/common/SideDrawer";
import { useToast } from "@/components/common/Toast";
import TechnicalAnalysis from "@/components/TechnicalAnalysis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { WatchlistGroupsDrawer } from "@/components/WatchlistGroupsDrawer";
import { useWatchlistController } from "@/hooks/useWatchlistController";
import { useWatchlistGroups } from "@/hooks/useWatchlistGroups";
import type { AppLanguage } from "@/i18n";
import { formatTemplate, i18n } from "@/i18n";
import { searchWatchlist } from "@/lib/api";
import { cn } from "@/lib/utils";
import { filterWatchlist, quoteNumber, reorderVisibleItems, type WatchlistGroupFilter, type WatchlistSort } from "@/lib/watchlist-view";
import type { WatchlistCategory, WatchlistItem, WatchlistMarket, WatchlistSearchResult } from "@/types/app";

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
  sortingEnabled,
  activeSymbol,
  onDelete,
  onOpenFinancials,
  onSelect,
  copy,
}: {
  item: WatchlistItem;
  sortingEnabled: boolean;
  activeSymbol: string;
  onDelete: (item: WatchlistItem) => void;
  onOpenFinancials: (symbol: string) => void;
  onSelect: (item: WatchlistItem) => void;
  copy: typeof i18n.zh.watchlist;
}) {
  const { active, attributes, listeners, over, setNodeRef, transform, transition, isDragging, isSorting } = useSortable({
    id: item.id, disabled: !sortingEnabled,
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
        "watchlist-sortable-row finance-row-card message-bubble select-none rounded-md border border-border/80 bg-card/80 p-2.5 outline-none transition-colors hover:border-primary/50 focus-visible:border-primary",
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
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
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
          disabled={!sortingEnabled}
          className={cn(
            "watchlist-drag-handle grid size-7 shrink-0 disabled:cursor-default disabled:opacity-20 cursor-grab touch-none select-none place-items-center text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing",
            (isDragging || isDropTarget) && "text-primary",
          )}
          onClick={(event) => event.stopPropagation()}
          type="button"
        >
          <GripVertical className="size-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={stockName(item)}>{stockName(item)}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{item.symbol}</p>
        </div>
        <div className="shrink-0 text-right font-mono tabular-nums">
          <p className="text-xs font-medium" title={item.currency}>{quoteNumber(item.last_done)?.toLocaleString(undefined, { maximumFractionDigits: 3 }) ?? "—"}</p>
          <p className={cn("mt-0.5 text-[11px]", (quoteNumber(item.change_rate) ?? 0) > 0 ? "text-[var(--color-up)]" : (quoteNumber(item.change_rate) ?? 0) < 0 ? "text-[var(--color-down)]" : "text-muted-foreground")}>
            {quoteNumber(item.change_rate) == null ? "—" : `${quoteNumber(item.change_rate)! > 0 ? "+" : ""}${quoteNumber(item.change_rate)!.toFixed(2)}%`}
          </p>
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
      <Button aria-label={copy.financials} className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={(event) => { event.stopPropagation(); onOpenFinancials(); }} size="icon" title={copy.financials} variant="ghost">
        <FileText />
      </Button>
      {showDelete ? (
        <Button aria-label={copy.deleteItem} className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(event) => { event.stopPropagation(); onDelete?.(); }} size="icon" title={copy.deleteItem} variant="ghost">
          <Trash2 />
        </Button>
      ) : null}
    </div>
  );
}

export function WatchlistPage({ language, selectedSymbol = "", onSelectedSymbolChange, onOpenFinancials }: {
  language: AppLanguage; selectedSymbol?: string; onSelectedSymbolChange?: (symbol: string) => void;
  onOpenFinancials: (symbol: string) => void;
}) {
  const common = i18n[language].common, copy = i18n[language].watchlist;
  const [category, setCategory] = useState<WatchlistMarket>(() =>
    inferCategoryFromSymbol(selectedSymbol) ?? readStoredValue(WATCHLIST_CATEGORY_STORAGE_KEY, ["all", "US", "A", "H"], "all"));
  const [activeSymbol, setActiveSymbol] = useState(selectedSymbol);
  const { controller, items, loading: isLoading, refreshing, error } = useWatchlistController("all", loadStoredWatchlistRefreshSeconds());
  const groupState = useWatchlistGroups();
  const [group, setGroup] = useState<WatchlistGroupFilter>("all");
  const [localQuery, setLocalQuery] = useState("");
  const [sort, setSort] = useState<WatchlistSort>("manual");
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WatchlistSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [activeDragId, setActiveDragId] = useState<UniqueIdentifier | null>(null);
  const [activeDragSize, setActiveDragSize] = useState<DragPreviewSize | null>(null);
  const lastErrorToastRef = useRef({ message: "", time: 0 });
  const { showToast } = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const categories = [{ id: "all" as const, label: copy.allMarkets }, ...getWatchlistCategories(language)];
  const visibleItems = useMemo(() => filterWatchlist(items, groupState.groups, { market: category, group, query: localQuery, sort }),
    [items, groupState.groups, category, group, localQuery, sort]);
  const symbolSet = useMemo(() => new Set(items.map((item) => item.symbol)), [items]);
  const activeDragItem = items.find((item) => item.id === activeDragId) ?? null;
  const showError = useCallback((message: string) => {
    if (!message.trim()) return;
    const now = Date.now();
    if (lastErrorToastRef.current.message === message && now - lastErrorToastRef.current.time < 15_000) return;
    lastErrorToastRef.current = { message, time: now };
    showToast({ kind: "error", message, title: copy.companies });
  }, [copy.companies, showToast]);
  useEffect(() => { writeStoredValue(WATCHLIST_CATEGORY_STORAGE_KEY, category); }, [category]);
  useEffect(() => { if (error) showError(error); }, [error, showError]);
  useEffect(() => { if (groupState.error) showError(groupState.error); }, [groupState.error, showError]);
  useEffect(() => {
    if (typeof group === "number" && !groupState.loading && !groupState.groups.some((item) => item.id === group)) setGroup("all");
  }, [group, groupState.groups, groupState.loading]);
  useEffect(() => { if (selectedSymbol) setActiveSymbol(selectedSymbol); }, [selectedSymbol]);
  useEffect(() => {
    if (activeSymbol || !visibleItems.length) return;
    setActiveSymbol(visibleItems[0].symbol);
    onSelectedSymbolChange?.(visibleItems[0].symbol);
  }, [activeSymbol, visibleItems, onSelectedSymbolChange]);
  useEffect(() => {
    const text = query.trim();
    setResults([]);
    setIsSearching(Boolean(addOpen && text));
    if (!addOpen || !text) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      searchWatchlist(text, category, { signal: abort.signal }).then((response) => {
        if (!abort.signal.aborted) setResults(response.results);
      }).catch((caught) => {
        if (!abort.signal.aborted) showError(caught instanceof Error ? caught.message : copy.searchFailed);
      }).finally(() => { if (!abort.signal.aborted) setIsSearching(false); });
    }, 350);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [addOpen, category, query, copy.searchFailed, showError]);
  const handleSelect = useCallback((value: WatchlistItem | string) => {
    const symbol = typeof value === "string" ? value : value.symbol;
    setActiveSymbol(symbol); onSelectedSymbolChange?.(symbol);
  }, [onSelectedSymbolChange]);
  async function handleAdd(result: WatchlistSearchResult) {
    if (adding) return;
    setAdding(true);
    try {
      const item = await controller.add(result);
      if (item) { setGroup("all"); setLocalQuery(""); if (category !== "all") setCategory(item.category); handleSelect(item); }
    } finally { setAdding(false); }
  }
  async function handleDelete(item: WatchlistItem) {
    await controller.remove(item);
    if (!controller.snapshot().items.some((entry) => entry.id === item.id)) {
      if (item.symbol === activeSymbol) { setActiveSymbol(""); onSelectedSymbolChange?.(""); }
      void groupState.controller.load();
    }
  }
  function handleDragStart(event: DragStartEvent) {
    const rect = event.active.rect.current.initial;
    setActiveDragId(event.active.id); setActiveDragSize(rect ? { height: rect.height, width: rect.width } : null);
  }
  function cancelDrag() { setActiveDragId(null); setActiveDragSize(null); }
  function handleDragEnd(event: DragEndEvent) {
    cancelDrag();
    if (sort !== "manual" || !event.over || event.active.id === event.over.id) return;
    const from = visibleItems.findIndex((item) => item.id === event.active.id);
    const to = visibleItems.findIndex((item) => item.id === event.over?.id);
    if (from < 0 || to < 0) return;
    controller.reorder(reorderVisibleItems(items, arrayMove(visibleItems, from, to).map((item) => item.id)));
  }
  const resetFilters = () => { setCategory("all"); setGroup("all"); setLocalQuery(""); setSort("manual"); };
  return (
    <section className="watchlist-page-shell panel motion-panel page-enter finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar watchlist-compact-toolbar flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{copy.companies}</h2>
          <Badge className="gap-1" variant="outline">{refreshing && <Loader2 className="size-3 animate-spin" />}{items.length}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={groupState.loading} onClick={() => setGroupsOpen(true)}><Folder className="size-4" />{copy.manageGroups}</Button>
          <Button size="sm" onClick={() => { setQuery(""); setAddOpen(true); }}><Plus className="size-4" />{copy.addCompany}</Button>
        </div>
      </div>
      <div className="watchlist-page-grid grid min-h-0 flex-1 grid-rows-[max-content_max-content] gap-3 pb-3 pt-2 lg:grid-cols-[370px_minmax(0,1fr)] lg:grid-rows-1 lg:gap-3 lg:overflow-hidden lg:pb-4">
        <aside className="watchlist-list-shell finance-module flex min-h-0 min-w-0 flex-col rounded-md border border-border/80 bg-card/45">
          <div className="relative z-20 shrink-0 space-y-3 border-b border-border/70 p-3">
            <div className="flex gap-1 rounded-lg bg-muted/50 p-1" role="group" aria-label={copy.allMarkets}>
              {categories.map((market) => <button key={market.id} type="button" aria-pressed={category === market.id}
                className={cn("min-h-8 flex-1 whitespace-nowrap rounded-md px-1.5 text-xs font-medium transition-colors", category === market.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setCategory(market.id)}>{market.label}</button>)}
            </div>
            <Select aria-label={copy.groups} value={String(group)} onValueChange={(value) => setGroup(value === "all" || value === "ungrouped" ? value : Number(value))}
              options={[{ value: "all", label: copy.allGroups }, { value: "ungrouped", label: copy.ungrouped }, ...groupState.groups.map((entry) => ({ value: String(entry.id), label: entry.name }))]} />
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label={copy.localFilter} className="pl-8 pr-9" placeholder={copy.localFilterPlaceholder} value={localQuery} onChange={(event) => setLocalQuery(event.target.value)} />
              {localQuery && <button className="absolute right-0 top-0 grid size-9 place-items-center text-muted-foreground" aria-label={common.clear} onClick={() => setLocalQuery("")}><X className="size-4" /></button>}
            </div>
            <Select aria-label={copy.sortLabel} value={sort} onValueChange={(value) => setSort(value as WatchlistSort)} options={[
              { value: "manual", label: copy.manualOrder }, { value: "name", label: copy.nameOrder },
              { value: "gainers", label: copy.gainersOrder }, { value: "losers", label: copy.losersOrder },
            ]} />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span aria-live="polite">{formatTemplate(copy.visibleCount, { visible: visibleItems.length, total: items.length })}</span>
              <span>{copy.price} / {copy.rate}</span>
            </div>
          </div>
          <div className="min-h-0 max-h-[320px] flex-1 overflow-y-auto p-2 lg:max-h-none">
            {!isLoading && !visibleItems.length && items.length > 0 ? <SoftState icon={<Search className="size-6" />}>
              <span className="block">{copy.localNoMatch}</span><Button variant="ghost" size="sm" className="mt-2" onClick={resetFilters}>{copy.resetFilters}</Button>
            </SoftState> : <ManageList activeDragItem={activeDragItem} activeDragSize={activeDragSize} activeSymbol={activeSymbol}
              commonLoading={common.loading} copy={copy} isLoading={isLoading} items={visibleItems} sortingEnabled={sort === "manual"}
              onDelete={handleDelete} onDragCancel={cancelDrag} onDragEnd={handleDragEnd} onDragStart={handleDragStart}
              onOpenFinancials={onOpenFinancials} onSelect={handleSelect} sensors={sensors} />}
          </div>
        </aside>
        <div className="watchlist-analysis-shell finance-module flex min-h-[560px] min-w-0 flex-col overflow-hidden overscroll-contain rounded-md border border-border/80 bg-card/45 sm:min-h-[640px] lg:min-h-0">
          {activeSymbol ? <TechnicalAnalysis embedded language={language} symbol={activeSymbol} onSymbolChange={handleSelect} /> :
            <SoftState icon={<Star className="size-8" />}><span className="block font-medium">{copy.emptyTitle}</span><span className="mt-1 block text-xs">{copy.emptyHint}</span></SoftState>}
        </div>
      </div>
      <SideDrawer open={addOpen} onClose={() => setAddOpen(false)} title={copy.addCompany} subtitle={copy.addSearchHint} dismissDisabled={adding}>
        <div className="space-y-3 p-4">
          <Input aria-label={copy.addCompany} placeholder="AAPL.US / 700.HK / 600519.SH" value={query} onChange={(event) => setQuery(event.target.value)} />
          {isSearching && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{common.loading}</div>}
          {results.map((result) => <div className="flex min-h-14 items-center gap-3 rounded-lg border border-border/60 p-3" key={result.symbol}>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{searchResultName(result)}</p><p className="font-mono text-xs text-muted-foreground">{result.symbol}</p></div>
            <Button size="sm" variant={symbolSet.has(result.symbol) ? "ghost" : "outline"} disabled={adding || symbolSet.has(result.symbol)} onClick={() => void handleAdd(result)}>
              <Star className="size-4" fill={symbolSet.has(result.symbol) ? "currentColor" : "none"} />{symbolSet.has(result.symbol) ? common.added : common.add}
            </Button>
          </div>)}
          {query.trim() && !isSearching && !results.length && <p className="text-sm text-muted-foreground">{copy.noMatch}</p>}
        </div>
      </SideDrawer>
      {groupsOpen && <WatchlistGroupsDrawer open onClose={() => setGroupsOpen(false)} language={language} items={items}
        groups={groupState.groups} controller={groupState.controller} saving={groupState.saving} initialGroup={typeof group === "number" ? group : undefined} />}
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
  sortingEnabled,
}: {
  activeDragItem: WatchlistItem | null;
  activeDragSize: DragPreviewSize | null;
  activeSymbol: string;
  commonLoading: string;
  copy: typeof i18n.zh.watchlist;
  isLoading: boolean;
  items: WatchlistItem[];
  sortingEnabled: boolean;
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
              sortingEnabled={sortingEnabled}
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

function inferCategoryFromSymbol(symbol: string): WatchlistCategory | null {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.endsWith(".US")) return "US";
  if (normalized.endsWith(".HK")) return "H";
  if (normalized.endsWith(".SH") || normalized.endsWith(".SZ") || normalized.endsWith(".CN")) return "A";
  return null;
}
