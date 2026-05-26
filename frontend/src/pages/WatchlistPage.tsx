import { useEffect, useState } from "react";
import { BriefcaseBusiness, FileText, GripVertical, Loader2, Newspaper, Plus, Search, Sparkles, Star, Trash2 } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addPortfolioItem, addWatchlistItem, deleteWatchlistItem, listWatchlist, reorderWatchlist, searchWatchlist } from "@/lib/api";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PortfolioMarket, WatchlistCategory, WatchlistItem, WatchlistSearchResult } from "@/types/app";

function getWatchlistCategories(language: AppLanguage): Array<{ id: WatchlistCategory; label: string; hint: string; placeholder: string }> {
  const markets = i18n[language].markets;
  return [
    { id: "US", label: markets.us, hint: markets.usHint, placeholder: markets.usPlaceholder },
    { id: "A", label: markets.a, hint: markets.aHint, placeholder: markets.aPlaceholder },
    { id: "H", label: markets.h, hint: markets.hHint, placeholder: markets.hPlaceholder },
  ];
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
      ref={setNodeRef}
      style={style}
      className="finance-row-card message-bubble rounded-md border border-border/80 bg-card/80 p-2 transition-colors hover:border-primary/50 sm:p-3"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          {...attributes}
          {...listeners}
          type="button"
          aria-label={copy.dragSort}
          className="shrink-0 cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold sm:text-base">{item.symbol}</p>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">{stockName(item)}</p>
        </div>
        <div className="ml-auto flex shrink-0 justify-end gap-0.5 sm:gap-1">
        <Button
          aria-label={copy.analyze}
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={() => onAnalyze(item.symbol)}
          title={copy.analyze}
        >
          <Sparkles />
        </Button>
        <Button
          aria-label={copy.financials}
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={() => onOpenFinancials(item.symbol)}
          title={copy.financials}
        >
          <FileText />
        </Button>
        <Button
          aria-label={copy.news}
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={() => onOpenNews(item.symbol)}
          title={copy.news}
        >
          <Newspaper />
        </Button>
        <Button
          aria-label={copy.addToPortfolio}
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          disabled={item.category === "H"}
          onClick={() => onAddToPortfolio(item)}
          title={item.category === "H" ? copy.addPortfolioUnsupported : copy.addToPortfolio}
        >
          <BriefcaseBusiness />
        </Button>
        <Button
          aria-label={copy.deleteItem}
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => onDelete(item)}
          title={copy.deleteItem}
        >
          <Trash2 />
        </Button>
        </div>
      </div>
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
  const [category, setCategory] = useState<WatchlistCategory>("US");
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WatchlistSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let mounted = true;

    async function loadItems() {
      setIsLoading(true);
      setMessage("");
      try {
        const response = await listWatchlist(category);
        if (mounted) {
          setItems(response.items);
        }
      } catch (caught) {
        if (mounted) {
          setMessage(caught instanceof Error ? caught.message : copy.loadFailed);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadItems();
    return () => {
      mounted = false;
    };
  }, [category]);

  async function handleSearch(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const text = query.trim();
    if (!text || isSearching) return;

    setIsSearching(true);
    setMessage("");
    try {
      const response = await searchWatchlist(text, category);
      setResults(response.results);
      if (response.total === 0) {
        setMessage(copy.noMatch);
      }
    } catch (caught) {
      setResults([]);
      setMessage(caught instanceof Error ? caught.message : copy.searchFailed);
    } finally {
      setIsSearching(false);
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
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : copy.addFailed);
    }
  }

  async function handleDelete(item: WatchlistItem) {
    setMessage("");
    try {
      await deleteWatchlistItem(item.id);
      setItems((current) => current.filter((e) => e.id !== item.id));
    } catch (caught) {
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((current) => {
      const oldIndex = current.findIndex((e) => e.id === active.id);
      const newIndex = current.findIndex((e) => e.id === over.id);
      const next = arrayMove(current, oldIndex, newIndex);
      // Persist asynchronously — ignore errors silently
      reorderWatchlist(next.map((e) => e.id)).catch(() => {});
      return next;
    });
  }

  const symbolSet = new Set(items.map((item) => item.symbol));

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
                onClick={() => {
                  setCategory(item.id);
                  setResults([]);
                  setMessage("");
                }}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <Badge variant="outline">{formatTemplate(copy.symbols, { count: items.length })}</Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 py-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:overflow-hidden lg:py-4">
        <div className="finance-module flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
          <div className="finance-module-header flex items-center justify-between p-2 sm:p-3">
            <div>
              <p className="text-sm font-semibold">
                {formatTemplate(copy.listTitle, { label: watchlistCategories.find((item) => item.id === category)?.label ?? category })}
              </p>
              <p className="hidden text-xs text-muted-foreground sm:block">
                {formatTemplate(copy.dragHint, { hint: watchlistCategories.find((item) => item.id === category)?.hint ?? category })}
              </p>
            </div>
            {isLoading ? (
              <Badge variant="muted" className="gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                {common.loading}
              </Badge>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 p-2 lg:overflow-y-auto lg:p-3">
            {items.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <div className="grid gap-1.5 sm:gap-2 2xl:grid-cols-2">
                    {items.map((item) => (
                      <SortableWatchlistItem
                        key={item.id}
                        item={item}
                        onDelete={handleDelete}
                        onAnalyze={onAnalyzeStock}
                        onAddToPortfolio={handleAddToPortfolio}
                        onOpenFinancials={onOpenFinancials}
                        onOpenNews={onOpenNews}
                        copy={copy}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="finance-soft-state grid h-full min-h-56 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 text-center">
                <div>
                  <Star className="mx-auto mb-3 size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{copy.emptyTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{copy.emptyHint}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="finance-module flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
          <div className="finance-module-header p-3">
            <form className="flex gap-2" onSubmit={handleSearch}>
              <Input
                placeholder={watchlistCategories.find((item) => item.id === category)?.placeholder}
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
                      <Button size="sm" variant={exists ? "outline" : "default"} disabled={exists} onClick={() => handleAdd(result)}>
                        <Plus />
                        {exists ? common.added : common.add}
                      </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <QuoteMetric label={copy.last} value={result.last_done ?? "-"} />
                      <QuoteMetric label={copy.change} value={result.change_value ?? "-"} />
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

function stockName(item: Pick<WatchlistItem, "name" | "name_cn" | "name_hk" | "name_en">) {
  return item.name || item.name_cn || item.name_hk || item.name_en || "-";
}

function rateTone(value: string | null): "up" | "down" | "flat" {
  if (!value) return "flat";
  if (value.startsWith("-")) return "down";
  if (value !== "-" && value !== "0" && value !== "0.00%") return "up";
  return "flat";
}
