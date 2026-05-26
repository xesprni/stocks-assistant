import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Loader2, MessageCircle, Newspaper, Search, Share2, Star, ThumbsUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSecurityNews, listWatchlist } from "@/lib/api";
import { i18n, localeFor, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { SecurityNewsItem, WatchlistCategory, WatchlistItem } from "@/types/app";

type SourceMode = "watchlist" | "symbol";

function getWatchlistCategories(language: AppLanguage): Array<{ id: WatchlistCategory; label: string; hint: string }> {
  const markets = i18n[language].markets;
  return [
    { id: "US", label: markets.us, hint: markets.usHint },
    { id: "A", label: markets.a, hint: markets.aHint },
    { id: "H", label: markets.h, hint: markets.hHint },
  ];
}

export function NewsPage({ initialSymbol, language }: { initialSymbol?: string; language: AppLanguage }) {
  const copy = i18n[language].newsPage;
  const common = i18n[language].common;
  const categories = getWatchlistCategories(language);
  const [sourceMode, setSourceMode] = useState<SourceMode>(initialSymbol ? "symbol" : "watchlist");
  const [category, setCategory] = useState<WatchlistCategory>("US");
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState((initialSymbol ?? "").trim().toUpperCase());
  const [manualSymbol, setManualSymbol] = useState((initialSymbol ?? "").trim().toUpperCase());
  const [news, setNews] = useState<SecurityNewsItem[]>([]);
  const [responseSymbol, setResponseSymbol] = useState("");
  const [isLoadingWatchlist, setIsLoadingWatchlist] = useState(false);
  const [isLoadingNews, setIsLoadingNews] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const next = (initialSymbol ?? "").trim().toUpperCase();
    if (!next) return;
    setSourceMode("symbol");
    setManualSymbol(next);
    setSelectedSymbol(next);
  }, [initialSymbol]);

  useEffect(() => {
    let mounted = true;
    if (sourceMode !== "watchlist") return undefined;

    async function loadWatchlist() {
      setIsLoadingWatchlist(true);
      setMessage("");
      try {
        const response = await listWatchlist(category);
        if (!mounted) return;
        setWatchlist(response.items);
        if (response.items.length === 0) {
          setSelectedSymbol("");
          setNews([]);
          setResponseSymbol("");
        } else if (!response.items.some((item) => item.symbol === selectedSymbol)) {
          setSelectedSymbol(response.items[0].symbol);
        }
      } catch (caught) {
        if (mounted) {
          setWatchlist([]);
          setMessage(caught instanceof Error ? caught.message : copy.loadFailed);
        }
      } finally {
        if (mounted) {
          setIsLoadingWatchlist(false);
        }
      }
    }

    loadWatchlist();
    return () => {
      mounted = false;
    };
  }, [category, sourceMode]);

  useEffect(() => {
    let mounted = true;
    const symbol = selectedSymbol.trim();
    if (!symbol) {
      setNews([]);
      setResponseSymbol("");
      return undefined;
    }

    async function loadNews() {
      setIsLoadingNews(true);
      setMessage("");
      try {
        const response = await getSecurityNews(symbol);
        if (!mounted) return;
        setResponseSymbol(response.symbol);
        setNews(response.news);
        if (response.total === 0) {
          setMessage(copy.emptyNews);
        }
      } catch (caught) {
        if (mounted) {
          setNews([]);
          setResponseSymbol("");
          setMessage(caught instanceof Error ? caught.message : copy.loadFailed);
        }
      } finally {
        if (mounted) {
          setIsLoadingNews(false);
        }
      }
    }

    loadNews();
    return () => {
      mounted = false;
    };
  }, [selectedSymbol]);

  function handleManualSubmit(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const next = manualSymbol.trim().toUpperCase();
    if (!next) {
      setMessage(copy.selectSymbol);
      return;
    }
    setSelectedSymbol(next);
  }

  const selectedWatchlistItem = useMemo(
    () => watchlist.find((item) => item.symbol === selectedSymbol),
    [selectedSymbol, watchlist],
  );

  return (
    <section className="panel motion-panel page-enter finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Newspaper className="size-5 text-secondary" />
            <p className="font-semibold">{copy.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {responseSymbol ? <Badge variant="outline">{responseSymbol}</Badge> : null}
          {isLoadingNews ? (
            <Badge variant="muted" className="gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              {common.loading}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 py-3 lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden lg:py-4">
        <aside className="finance-module flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
          <div className="finance-module-header space-y-3 p-3">
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant={sourceMode === "watchlist" ? "default" : "outline"}
                onClick={() => setSourceMode("watchlist")}
              >
                <Star />
                {copy.sourceWatchlist}
              </Button>
              <Button
                size="sm"
                variant={sourceMode === "symbol" ? "default" : "outline"}
                onClick={() => setSourceMode("symbol")}
              >
                <Search />
                {copy.sourceSymbol}
              </Button>
            </div>

            {sourceMode === "watchlist" ? (
              <div className="space-y-3">
                <div className="inline-flex h-7 max-w-full items-center overflow-x-auto rounded-full border border-border bg-muted/45 p-0.5">
                  {categories.map((item) => (
                    <button
                      aria-pressed={category === item.id}
                      className={cn(
                        "h-6 min-w-[4rem] rounded-full px-2.5 text-xs font-medium transition-colors",
                        category === item.id
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      key={item.id}
                      onClick={() => setCategory(item.id)}
                      type="button"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs font-medium">{copy.selectFromWatchlist}</p>
              </div>
            ) : (
              <form className="space-y-2" onSubmit={handleManualSubmit}>
                <p className="text-xs font-medium">{copy.manualSymbol}</p>
                <div className="flex gap-2">
                  <Input
                    placeholder={copy.symbolPlaceholder}
                    value={manualSymbol}
                    onChange={(event) => setManualSymbol(event.target.value)}
                  />
                  <Button className="shrink-0" disabled={!manualSymbol.trim()} type="submit">
                    {isLoadingNews ? <Loader2 className="animate-spin" /> : <Search />}
                    {copy.loadNews}
                  </Button>
                </div>
              </form>
            )}
          </div>

          <div className="min-h-0 flex-1 p-3 lg:overflow-y-auto">
            {sourceMode === "watchlist" ? (
              <div className="space-y-2">
                {isLoadingWatchlist ? (
                  <div className="finance-soft-state rounded-md border border-border/80 bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
                    {common.loading}
                  </div>
                ) : null}
                {!isLoadingWatchlist && watchlist.length === 0 ? (
                  <div className="finance-soft-state rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                    {copy.emptyWatchlist}
                  </div>
                ) : null}
                {watchlist.map((item) => (
                  <button
                    className={cn(
                      "finance-row-card w-full rounded-md border p-3 text-left transition-colors",
                      selectedSymbol === item.symbol
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/80 bg-card/70 hover:border-primary/45",
                    )}
                    key={item.id}
                    onClick={() => setSelectedSymbol(item.symbol)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{item.symbol}</p>
                        <p className="truncate text-xs text-muted-foreground">{stockName(item)}</p>
                      </div>
                      {selectedSymbol === item.symbol ? <Badge variant="outline">{copy.selected}</Badge> : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="finance-soft-state rounded-md border border-border/80 bg-muted/20 px-3 py-3 text-sm">
                <p className="font-semibold">{selectedSymbol || "-"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{copy.latestNews}</p>
              </div>
            )}
          </div>
        </aside>

        <main className="finance-module flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
          <div className="finance-module-header flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{copy.latestNews}</p>
              <p className="truncate text-xs text-muted-foreground">
                {selectedWatchlistItem ? `${selectedWatchlistItem.symbol} · ${stockName(selectedWatchlistItem)}` : responseSymbol || selectedSymbol || copy.selectSymbol}
              </p>
            </div>
            <Badge variant="muted">{news.length}</Badge>
          </div>

          <div className="min-h-0 flex-1 p-3 lg:overflow-y-auto">
            {message ? (
              <div className="finance-soft-state mb-3 rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {message}
              </div>
            ) : null}

            {!selectedSymbol ? (
              <div className="finance-soft-state grid h-full min-h-64 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 text-center">
                <div>
                  <Newspaper className="mx-auto mb-3 size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{copy.selectSymbol}</p>
                </div>
              </div>
            ) : null}

            {selectedSymbol && isLoadingNews && news.length === 0 ? (
              <div className="finance-soft-state grid h-full min-h-64 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 text-center">
                <div className="text-sm text-muted-foreground">
                  <Loader2 className="mx-auto mb-3 size-7 animate-spin" />
                  {common.loading}
                </div>
              </div>
            ) : null}

            {selectedSymbol && !isLoadingNews && news.length === 0 ? (
              <div className="finance-soft-state grid h-full min-h-64 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 text-center">
                <div>
                  <Newspaper className="mx-auto mb-3 size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{copy.emptyNews}</p>
                </div>
              </div>
            ) : null}

            {news.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {news.map((item) => (
                  <NewsCard item={item} key={item.id || item.url || item.title} language={language} />
                ))}
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </section>
  );
}

function NewsCard({ item, language }: { item: SecurityNewsItem; language: AppLanguage }) {
  const copy = i18n[language].newsPage;
  return (
    <article className="finance-row-card rounded-md border border-border/80 bg-card/80 p-3 transition-colors hover:border-primary/45">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold leading-5">{item.title || "-"}</p>
          {item.description ? (
            <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{item.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {item.published_at ? <Badge variant="outline">{formatNewsTime(item.published_at, language)}</Badge> : null}
          <Metric icon={<ThumbsUp />} label={copy.likes} value={item.likes_count} />
          <Metric icon={<MessageCircle />} label={copy.comments} value={item.comments_count} />
          <Metric icon={<Share2 />} label={copy.shares} value={item.shares_count} />
        </div>
        {item.url ? (
          <a
            className="inline-flex h-8 w-fit items-center gap-2 rounded-md border border-border/80 bg-background/70 px-3 text-xs font-semibold transition-colors hover:border-primary/45 hover:bg-primary/10"
            href={item.url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-3.5" />
            {copy.openSource}
          </a>
        ) : null}
      </div>
    </article>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="[&_svg]:size-3.5">{icon}</span>
      {label}: {value ?? 0}
    </span>
  );
}

function stockName(item: Pick<WatchlistItem, "name" | "name_cn" | "name_hk" | "name_en">) {
  return item.name || item.name_cn || item.name_hk || item.name_en || "-";
}

function formatNewsTime(value: string, language: AppLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(localeFor(language), {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
