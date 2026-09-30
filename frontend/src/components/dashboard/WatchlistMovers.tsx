import { useErrorToast } from "@/components/common/Toast";
import { chunkRows, WATCHLIST_FILTERS, WATCHLIST_VIEWS, watchlistFilterLabel, watchlistViewLabel } from "@/components/dashboard/model";
import { FinanceSection, InlineState, QuoteRow } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMessages, i18n, type AppLanguage } from "@/i18n";
import { cn } from "@/lib/utils";
import type {
  DashboardWatchlistModule,
  DashboardWatchlistView,
  WatchlistCategory
} from "@/types/app";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Star
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function WatchlistMovers({
  error,
  language,
  loading,
  module,
  onOpenChart,
  onOpenWatchlist,
  onSelectSymbol,
  selectedSymbol,
  subtitle,
}: {
  error: string;
  language: AppLanguage;
  loading: boolean;
  module: DashboardWatchlistModule | null | undefined;
  onOpenChart?: (symbol: string) => void;
  onOpenWatchlist: () => void;
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
  subtitle?: string;
}) {
  const copy = i18n[language].overview;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<DashboardWatchlistView>("movers");
  const [filter, setFilter] = useState<WatchlistCategory | null>(null);
  const [page, setPage] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(() => (typeof window === "undefined" || window.innerWidth >= 768 ? 10 : 6));
  const rows = useMemo(() => {
    const source = module?.views?.[view] ?? [];
    if (filter === null) return source;
    return source.filter((row) => row.category === filter);
  }, [filter, module?.views, view]);
  const pages = useMemo(() => chunkRows(rows, itemsPerPage), [itemsPerPage, rows]);
  const pageCount = pages.length;
  const total = module?.total ?? 0;
  const moduleError = error;
  useErrorToast(moduleError, copy.watchlistMovers);
  const previousLabel = getMessages(language).dashboard.previousLabel;
  const nextLabel = getMessages(language).dashboard.nextLabel;
  const pageLabel = `${Math.min(page + 1, pageCount || 1)} / ${pageCount || 1}`;

  useEffect(() => {
    let raf = 0;
    function updatePageSize() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setItemsPerPage(window.innerWidth >= 768 ? 10 : 6));
    }
    updatePageSize();
    window.addEventListener("resize", updatePageSize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePageSize);
    };
  }, []);

  useEffect(() => {
    setPage(0);
    scrollRef.current?.scrollTo({ left: 0 });
  }, [filter, itemsPerPage, view]);

  useEffect(() => {
    if (page >= pageCount && pageCount > 0) {
      setPage(pageCount - 1);
    }
  }, [page, pageCount]);

  function scrollToPage(nextPage: number) {
    const bounded = Math.max(0, Math.min(pageCount - 1, nextPage));
    setPage(bounded);
    const node = scrollRef.current;
    if (node) node.scrollTo({ left: bounded * node.clientWidth, behavior: "smooth" });
  }

  function handleScroll() {
    const node = scrollRef.current;
    if (!node || node.clientWidth === 0) return;
    const nextPage = Math.round(node.scrollLeft / node.clientWidth);
    if (nextPage !== page) setPage(Math.max(0, Math.min(pageCount - 1, nextPage)));
  }

  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenWatchlist}>{copy.viewWatchlist}<ArrowRight /></Button>}
      className="dashboard-watchlist-section"
      icon={<Star />}
      subtitle={subtitle ?? copy.watchlistMoversSubtitle}
      title={copy.watchlistMovers}
    >
      {loading && total === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingMarket}</InlineState>
      ) : total === 0 ? (
        <InlineState>{copy.emptyMovers}</InlineState>
      ) : (
        <div className="space-y-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2 pb-0.5">
            <div className="flex shrink-0 gap-1 rounded-full bg-muted/40 p-0.5">
              {WATCHLIST_VIEWS.map((item) => (
                <button
                  aria-pressed={view === item}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                    view === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  key={item}
                  onClick={() => setView(item)}
                  type="button"
                >
                  {watchlistViewLabel(item, language)}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 gap-1">
              {WATCHLIST_FILTERS.map((item) => (
                <button
                  aria-pressed={filter === item}
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-1 text-xs font-semibold transition-colors",
                    filter === item
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/70 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  key={item}
                  onClick={() => setFilter(filter === item ? null : item)}
                  type="button"
                >
                  {watchlistFilterLabel(item, language)}
                  <span className="ml-1 text-muted-foreground">
                    {module?.counts_by_category?.[item] ?? 0}
                  </span>
                </button>
              ))}
            </div>
            <Badge className="ml-auto h-6 shrink-0 border-transparent bg-muted/35 px-2 shadow-none" variant="outline">{total}</Badge>
          </div>
          {rows.length === 0 ? (
            <InlineState>{copy.emptyMovers}</InlineState>
          ) : (
            <div className="relative">
              {pageCount > 1 ? (
                <>
                  <Button
                    aria-label={previousLabel}
                    className="absolute -left-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-full bg-card/95 shadow-md"
                    disabled={page <= 0}
                    onClick={() => scrollToPage(page - 1)}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    aria-label={nextLabel}
                    className="absolute -right-2 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-full bg-card/95 shadow-md"
                    disabled={page >= pageCount - 1}
                    onClick={() => scrollToPage(page + 1)}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </>
              ) : null}
              <div
                className="finance-swipe-pages flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
                onScroll={handleScroll}
                ref={scrollRef}
              >
                {pages.map((pageRows, pageIndex) => (
                  <div className="min-w-full snap-start pr-1" key={pageIndex}>
                    <div className="divide-y divide-border/45">
                      {pageRows.map((row) => (
                        <QuoteRow
                          language={language}
                          key={`${row.category}-${row.symbol}`}
                          onOpenChart={onOpenChart}
                          onSelect={onSelectSymbol}
                          row={row}
                          selected={row.symbol === selectedSymbol}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {pageCount > 1 ? (
            <div className="flex items-center justify-center gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">{pageLabel}</span>
              <div className="flex gap-1">
                {pages.map((_, index) => (
                  <button
                    aria-label={`${index + 1}`}
                    className={cn("h-1.5 rounded-full transition-all", page === index ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/35")}
                    key={index}
                    onClick={() => scrollToPage(index)}
                    type="button"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </FinanceSection>
  );
}
