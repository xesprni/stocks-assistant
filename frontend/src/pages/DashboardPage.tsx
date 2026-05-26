import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  Loader2,
  Newspaper,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Star,
} from "lucide-react";

import { MarketPulse } from "@/components/MarketPulse";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDashboard, getSecurityNews } from "@/lib/api";
import { formatTemplate, i18n, localeFor, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  AppConfig,
  DashboardPortfolioMarket,
  DashboardPortfolioModule,
  DashboardPortfolioPosition,
  DashboardResponse,
  DashboardWatchlistModule,
  DashboardWatchlistRow,
  DashboardWatchlistView,
  PortfolioMarket,
  QuoteItem,
  SecurityNewsItem,
  WatchlistCategory,
} from "@/types/app";

const WATCHLIST_FILTERS: Array<"ALL" | WatchlistCategory> = ["ALL", "US", "A", "H"];
const WATCHLIST_VIEWS: DashboardWatchlistView[] = ["movers", "gainers", "losers", "active"];

type SymbolRow = DashboardWatchlistRow;
type Tone = "up" | "down" | "flat";

type DashboardPageProps = {
  canPermission: (permission: string) => boolean;
  config: AppConfig | null;
  enabledCount: number;
  language: AppLanguage;
  modelName: string;
  onOpenChart: (symbol: string) => void;
  onOpenConfig: () => void;
  onOpenMarket: () => void;
  onOpenNews: (symbol?: string) => void;
  onOpenPortfolio: () => void;
  onOpenWatchlist: () => void;
  onPrompt: (value: string) => void;
};

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumeric(value: string | null | undefined, language: AppLanguage, maximumFractionDigits = 2): string {
  const parsed = parseNumber(value);
  if (parsed === null) return value || "-";
  return parsed.toLocaleString(localeFor(language), { maximumFractionDigits });
}

function formatCompactNumeric(value: string | null | undefined, language: AppLanguage): string {
  const parsed = parseNumber(value);
  if (parsed === null) return value || "-";
  return parsed.toLocaleString(localeFor(language), { maximumFractionDigits: 1, notation: "compact" });
}

function formatPercent(value: string | null | undefined, language: AppLanguage): string {
  if (!value) return "-";
  if (value.includes("%")) return value;
  const parsed = parseNumber(value);
  if (parsed === null) return value;
  return `${parsed.toLocaleString(localeFor(language), { maximumFractionDigits: 2 })}%`;
}

function rateTone(rate: string | null | undefined): Tone {
  const parsed = parseNumber(rate);
  if (parsed === null || parsed === 0) return "flat";
  return parsed > 0 ? "up" : "down";
}

function toneClass(tone: Tone) {
  if (tone === "up") return "text-[var(--color-up)]";
  if (tone === "down") return "text-[var(--color-down)]";
  return "text-muted-foreground";
}

function signedChange(value: string | null | undefined, tone: Tone, language: AppLanguage): string {
  if (!value) return "-";
  const formatted = formatNumeric(value, language);
  if (tone === "up" && !formatted.startsWith("+")) return `+${formatted}`;
  return formatted;
}

function marketLabel(market: PortfolioMarket, language: AppLanguage) {
  if (market === "US") return language === "en" ? "US" : "美股";
  return language === "en" ? "A-share" : "A股";
}

function categoryLabel(category: WatchlistCategory, language: AppLanguage) {
  if (category === "US") return language === "en" ? "US" : "美股";
  if (category === "A") return language === "en" ? "A-share" : "A股";
  return language === "en" ? "HK" : "港股";
}

function watchlistFilterLabel(filter: "ALL" | WatchlistCategory, language: AppLanguage) {
  if (filter === "ALL") return language === "en" ? "All" : "全部";
  return categoryLabel(filter, language);
}

function watchlistViewLabel(view: DashboardWatchlistView, language: AppLanguage) {
  const labels = language === "en"
    ? { movers: "Movers", gainers: "Gainers", losers: "Losers", active: "Active" }
    : { movers: "异动", gainers: "领涨", losers: "领跌", active: "活跃" };
  return labels[view];
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    pages.push(rows.slice(index, index + size));
  }
  return pages;
}

function FinanceSection({
  action,
  children,
  className,
  icon,
  subtitle,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className={cn("finance-section min-w-0", className)}>
      <div className="mb-3 flex min-w-0 items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{title}</p>
            {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function InlineState({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-2 rounded-md bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
      {icon}
      <span>{children}</span>
    </div>
  );
}

function QuoteRow({
  language,
  onOpenChart,
  onSelect,
  row,
  selected = false,
}: {
  language: AppLanguage;
  onOpenChart?: (symbol: string) => void;
  onSelect?: (symbol: string) => void;
  row: SymbolRow;
  selected?: boolean;
}) {
  const tone = rateTone(row.change_rate);
  const Icon = tone === "down" ? ArrowDownRight : tone === "up" ? ArrowUpRight : Activity;
  const chartLabel = language === "en" ? `Open chart ${row.symbol}` : `打开图表 ${row.symbol}`;
  const highLowLabel = language === "en" ? "H/L" : "高/低";
  const turnoverLabel = language === "en" ? "Turnover" : "成交额";
  const volumeLabel = language === "en" ? "Vol" : "成交量";
  const rangeMeta = row.high || row.low ? `${highLowLabel} ${formatCompactNumeric(row.high, language)} / ${formatCompactNumeric(row.low, language)}` : "";
  const activityMeta = row.turnover
    ? `${turnoverLabel} ${formatCompactNumeric(row.turnover, language)}`
    : row.volume
      ? `${volumeLabel} ${formatCompactNumeric(row.volume, language)}`
      : "";
  const meta = [rangeMeta, activityMeta].filter(Boolean).join(" · ");
  return (
    <div
      className={cn(
        "group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 transition-colors hover:bg-muted/35",
        selected && "bg-primary/10",
      )}
    >
      <button
        aria-pressed={selected}
        className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 sm:px-2"
        onClick={() => onSelect?.(row.symbol)}
        type="button"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold">{row.symbol}</p>
            {row.category ? <Badge className="h-5 px-1.5 text-[10px]" variant="outline">{row.category}</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{row.name || "-"}</p>
          {meta ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground/85">{meta}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums">{formatNumeric(row.last_done, language, 3)}</p>
          <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-xs font-semibold tabular-nums", toneClass(tone))}>
            <Icon className="size-3.5" />
            <span>{formatPercent(row.change_rate, language)}</span>
          </div>
        </div>
      </button>
      {onOpenChart ? (
        <Button
          aria-label={chartLabel}
          className="mr-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
          onClick={() => onOpenChart(row.symbol)}
          size="icon"
          title={chartLabel}
          type="button"
          variant="ghost"
        >
          <BarChart2 className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function MarketPill({ language, quote }: { language: AppLanguage; quote: QuoteItem }) {
  const tone = rateTone(quote.change_rate);
  return (
    <div className="finance-index-item min-w-[168px] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{quote.name || quote.symbol}</p>
          <p className="truncate text-[11px] text-muted-foreground">{quote.symbol}</p>
        </div>
        <p className={cn("text-xs font-semibold tabular-nums", toneClass(tone))}>{formatPercent(quote.change_rate, language)}</p>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className="text-lg font-semibold tabular-nums">{formatNumeric(quote.last_done, language, 3)}</p>
        <p className={cn("text-xs tabular-nums", toneClass(tone))}>{signedChange(quote.change_value, tone, language)}</p>
      </div>
    </div>
  );
}

function HeroSearch({
  language,
  onPrompt,
}: {
  language: AppLanguage;
  onPrompt: (value: string) => void;
}) {
  const copy = i18n[language].overview;
  const quickPrompts = i18n[language].quickPrompts.slice(0, 3);
  const [query, setQuery] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = query.trim();
    if (text) onPrompt(text);
  }

  return (
    <section className="dashboard-hero min-w-0 py-4 sm:py-6">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">{copy.title}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
        <form className="flex min-w-0 flex-1 gap-2 lg:max-w-3xl 2xl:max-w-4xl" onSubmit={submit}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 rounded-full border-border/70 bg-background/80 pl-9 pr-3 text-sm shadow-none"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
              value={query}
            />
          </div>
          <Button className="h-10 rounded-full px-3 sm:px-4" type="submit">
            <Send />
            <span className="hidden sm:inline">{copy.askAgent}</span>
          </Button>
        </form>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5">
        {quickPrompts.map((prompt) => (
          <button
            className="shrink-0 rounded-full bg-muted/35 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/65 hover:text-foreground"
            key={prompt}
            onClick={() => onPrompt(prompt)}
            type="button"
          >
            {prompt}
          </button>
        ))}
      </div>
    </section>
  );
}

function MarketSnapshot({
  error,
  indices,
  language,
  loading,
  onOpenMarket,
}: {
  error: string;
  indices: QuoteItem[];
  language: AppLanguage;
  loading: boolean;
  onOpenMarket: () => void;
}) {
  const copy = i18n[language].overview;
  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenMarket}>{copy.viewMarket}<ArrowRight /></Button>}
      icon={<BarChart2 />}
      subtitle={copy.marketSnapshotSubtitle}
      title={copy.marketSnapshot}
    >
      {loading && indices.length === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingMarket}</InlineState>
      ) : error && indices.length === 0 ? (
        <InlineState>{error}</InlineState>
      ) : indices.length === 0 ? (
        <InlineState>{copy.emptyMarket}</InlineState>
      ) : (
        <div className="finance-index-strip -mx-2 flex overflow-x-auto sm:mx-0">
          {indices.slice(0, 8).map((quote) => (
            <MarketPill language={language} key={quote.symbol} quote={quote} />
          ))}
        </div>
      )}
    </FinanceSection>
  );
}

function WatchlistMovers({
  error,
  language,
  loading,
  module,
  onOpenChart,
  onOpenWatchlist,
  onSelectNewsSymbol,
  selectedNewsSymbol,
}: {
  error: string;
  language: AppLanguage;
  loading: boolean;
  module: DashboardWatchlistModule | null | undefined;
  onOpenChart?: (symbol: string) => void;
  onOpenWatchlist: () => void;
  onSelectNewsSymbol: (symbol: string) => void;
  selectedNewsSymbol: string;
}) {
  const copy = i18n[language].overview;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<DashboardWatchlistView>("movers");
  const [filter, setFilter] = useState<"ALL" | WatchlistCategory>("ALL");
  const [page, setPage] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(() => (typeof window === "undefined" || window.innerWidth >= 768 ? 8 : 6));
  const rows = useMemo(() => {
    const source = module?.views?.[view] ?? [];
    if (filter === "ALL") return source;
    return source.filter((row) => row.category === filter);
  }, [filter, module?.views, view]);
  const pages = useMemo(() => chunkRows(rows, itemsPerPage), [itemsPerPage, rows]);
  const pageCount = pages.length;
  const total = module?.total ?? 0;
  const moduleError = module?.error || error;
  const previousLabel = language === "en" ? "Previous watchlist page" : "上一页自选";
  const nextLabel = language === "en" ? "Next watchlist page" : "下一页自选";
  const pageLabel = language === "en" ? `${Math.min(page + 1, pageCount || 1)} / ${pageCount || 1}` : `${Math.min(page + 1, pageCount || 1)} / ${pageCount || 1}`;

  useEffect(() => {
    function updatePageSize() {
      setItemsPerPage(window.innerWidth >= 768 ? 8 : 6);
    }
    updatePageSize();
    window.addEventListener("resize", updatePageSize);
    return () => window.removeEventListener("resize", updatePageSize);
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
      icon={<Star />}
      subtitle={copy.watchlistMoversSubtitle}
      title={copy.watchlistMovers}
    >
      {loading && total === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingMarket}</InlineState>
      ) : moduleError && total === 0 ? (
        <InlineState>{moduleError}</InlineState>
      ) : total === 0 ? (
        <InlineState>{copy.emptyMovers}</InlineState>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted/40 p-0.5">
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
            <Badge className="border-transparent bg-muted/35 shadow-none" variant="outline">{total}</Badge>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {WATCHLIST_FILTERS.map((item) => (
              <button
                aria-pressed={filter === item}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                  filter === item
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/70 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                key={item}
                onClick={() => setFilter(item)}
                type="button"
              >
                {watchlistFilterLabel(item, language)}
                <span className="ml-1 text-muted-foreground">
                  {item === "ALL" ? total : (module?.counts_by_category?.[item] ?? 0)}
                </span>
              </button>
            ))}
          </div>
          {module?.quote_error ? <InlineState>{module.quote_error}</InlineState> : null}
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
                    <div className="divide-y divide-border/55 border-y border-border/55">
                      {pageRows.map((row) => (
                        <QuoteRow
                          language={language}
                          key={`${row.category}-${row.symbol}`}
                          onOpenChart={onOpenChart}
                          onSelect={onSelectNewsSymbol}
                          row={row}
                          selected={row.symbol === selectedNewsSymbol}
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

function PortfolioSummary({
  error,
  language,
  loading,
  module,
  onOpenPortfolio,
}: {
  error: string;
  language: AppLanguage;
  loading: boolean;
  module: DashboardPortfolioModule | null | undefined;
  onOpenPortfolio: () => void;
}) {
  const copy = i18n[language].overview;
  const markets = module?.markets ?? [];
  const moduleError = module?.error || error;
  const positions = markets
    .flatMap((market) => market.top_positions.map((item) => ({ ...item, market: item.market || market.market })))
    .sort((a, b) => (parseNumber(b.position_ratio) ?? 0) - (parseNumber(a.position_ratio) ?? 0))
    .slice(0, 5);

  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenPortfolio}>{copy.viewPortfolio}<ArrowRight /></Button>}
      icon={<BriefcaseBusiness />}
      subtitle={copy.portfolioSubtitle}
      title={copy.portfolioTitle}
    >
      {loading && markets.length === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingPortfolio}</InlineState>
      ) : moduleError && markets.length === 0 ? (
        <InlineState>{moduleError}</InlineState>
      ) : markets.length === 0 ? (
        <InlineState>{copy.emptyPortfolio}</InlineState>
      ) : (
        <div className="space-y-4">
          <div className="grid divide-y divide-border/55 border-y border-border/55 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {markets.map((market) => (
              <PortfolioMarketSummary key={market.market} language={language} market={market} />
            ))}
          </div>
          {markets.some((market) => market.quote_error) ? (
            <InlineState>{markets.map((market) => market.quote_error).filter(Boolean).join(" · ")}</InlineState>
          ) : null}
          {positions.length ? (
            <div className="divide-y divide-border/55 border-y border-border/55">
              {positions.map((item) => (
                <PortfolioPosition key={`${item.market}-${item.id}`} item={item} language={language} />
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-muted/25 px-3 py-2 text-xs text-muted-foreground">{copy.emptyPositions}</p>
          )}
        </div>
      )}
    </FinanceSection>
  );
}

function PortfolioMarketSummary({ language, market }: { language: AppLanguage; market: DashboardPortfolioMarket }) {
  const copy = i18n[language].overview;
  const labels = language === "en"
    ? { marketValue: "Market value", cost: "Cost", day: "Day", pnl: "Unrealized P&L", cash: "Cash" }
    : { marketValue: "持仓市值", cost: "成本", day: "日涨跌", pnl: "未实现盈亏", cash: "现金" };
  const dayTone = rateTone(market.day_change_rate || market.day_change_value);
  const pnlTone = rateTone(market.unrealized_pnl_value);
  return (
    <div className="min-w-0 px-1 py-3 sm:px-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">{marketLabel(market.market, language)}</p>
        <Badge className="border-transparent bg-muted/35 shadow-none" variant="outline">
          {formatTemplate(copy.positionsCount, { count: market.position_count })}
        </Badge>
      </div>
      <p className="text-lg font-semibold tabular-nums">{formatNumeric(market.total_assets, language)}</p>
      <div className="mt-2 grid gap-1 text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{labels.day}</span>
          <span className={cn("font-semibold tabular-nums", toneClass(dayTone))}>
            {signedChange(market.day_change_value, dayTone, language)}
            {market.day_change_rate ? ` (${formatPercent(market.day_change_rate, language)})` : ""}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{labels.pnl}</span>
          <span className={cn("font-semibold tabular-nums", toneClass(pnlTone))}>
            {signedChange(market.unrealized_pnl_value, pnlTone, language)}
            {market.unrealized_pnl_ratio ? ` (${formatPercent(market.unrealized_pnl_ratio, language)})` : ""}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>{labels.marketValue}</span>
          <span className="tabular-nums">{formatNumeric(market.market_value, language)}</span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>{labels.cash}</span>
          <span className="tabular-nums">
            {formatNumeric(market.cash_amount, language)} {market.cash_ratio ? `(${formatPercent(market.cash_ratio, language)})` : ""}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>{labels.cost}</span>
          <span className="tabular-nums">{formatNumeric(market.cost_value, language)}</span>
        </div>
      </div>
    </div>
  );
}

function PortfolioPosition({ item, language }: { item: DashboardPortfolioPosition; language: AppLanguage }) {
  const copy = i18n[language].overview;
  const tone = rateTone(item.pnl_ratio);
  const dayTone = rateTone(item.change_rate || item.change_value);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-2">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold">{item.symbol}</p>
          <Badge className="h-5 px-1.5 text-[10px]" variant="outline">{item.market}</Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">{item.name || "-"}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums">{formatNumeric(item.current_price, language)}</p>
        <p className={cn("text-xs font-semibold tabular-nums", toneClass(dayTone))}>
          {formatPercent(item.change_rate, language)}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatNumeric(item.stock_value, language)} · {formatPercent(item.position_ratio, language)}
        </p>
        <p className={cn("text-xs font-semibold tabular-nums", toneClass(tone))}>
          {copy.pnl}: {formatPercent(item.pnl_ratio, language)}
        </p>
      </div>
    </div>
  );
}

function NewsPreview({
  error,
  language,
  loading,
  news,
  onOpenNews,
  sourceSymbol,
}: {
  error: string;
  language: AppLanguage;
  loading: boolean;
  news: SecurityNewsItem[];
  onOpenNews: (symbol?: string) => void;
  sourceSymbol: string;
}) {
  const copy = i18n[language].overview;
  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={() => onOpenNews(sourceSymbol || undefined)}>{copy.viewNews}<ArrowRight /></Button>}
      className="order-1 xl:order-2"
      icon={<Newspaper />}
      subtitle={sourceSymbol ? formatTemplate(copy.newsForSymbol, { symbol: sourceSymbol }) : copy.latestNewsSubtitle}
      title={copy.latestNews}
    >
      {loading && news.length === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingNews}</InlineState>
      ) : error && news.length === 0 ? (
        <InlineState>{error}</InlineState>
      ) : news.length === 0 ? (
        <InlineState>{sourceSymbol ? copy.emptyNews : copy.emptyNewsSource}</InlineState>
      ) : (
        <div className="divide-y divide-border/55 border-y border-border/55">
          {news.slice(0, 4).map((item) => (
            <a
              className="block px-1 py-3 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 sm:px-2"
              href={item.url}
              key={item.id}
              rel="noreferrer"
              target="_blank"
            >
              <p className="line-clamp-2 text-sm font-semibold leading-5">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description || copy.noDescription}</p>
            </a>
          ))}
        </div>
      )}
    </FinanceSection>
  );
}

function SignalDeck({ language }: { language: AppLanguage }) {
  const copy = i18n[language].overview;
  return (
    <FinanceSection className="order-2 xl:order-1" icon={<Activity />} subtitle={copy.signalDeckSubtitle} title={copy.signalDeck}>
      <MarketPulse />
    </FinanceSection>
  );
}

function SystemStatus({
  config,
  enabledCount,
  language,
  modelName,
  onOpenConfig,
}: {
  config: AppConfig | null;
  enabledCount: number;
  language: AppLanguage;
  modelName: string;
  onOpenConfig: () => void;
}) {
  const copy = i18n[language].overview;
  const loading = language === "en" ? "Loading" : "加载中";
  const capabilities = [
    { active: config?.memory_enabled, icon: <BrainCircuit />, label: copy.memory },
    { active: config?.knowledge_enabled, icon: <Database />, label: copy.knowledge },
    { active: config?.scheduler_enabled, icon: <RefreshCw />, label: copy.scheduler },
    { active: config?.tracing_enabled, icon: <Cpu />, label: copy.tracing },
  ];

  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenConfig}><Settings2 />{copy.config}</Button>}
      className="order-3"
      icon={<Bot />}
      subtitle={copy.systemStatusSubtitle}
      title={copy.systemStatus}
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <StatusLine icon={<Cpu />} label={copy.llmModel} value={modelName} />
          <StatusLine icon={<Sparkles />} label={copy.capabilities} value={formatTemplate(copy.capabilitiesOn, { count: enabledCount })} />
          <StatusLine icon={<Bot />} label={copy.contextTurns} value={String(config?.agent_max_context_turns ?? "-")} />
          <StatusLine icon={<Database />} label={copy.workspace} value={config?.workspace_dir ?? loading} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {capabilities.map((item) => (
            <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/25 px-2 py-2" key={item.label}>
              <div className="flex min-w-0 items-center gap-2 text-muted-foreground [&_svg]:size-3.5">
                {item.icon}
                <span className="truncate text-xs">{item.label}</span>
              </div>
              <Badge className="h-5 px-1.5 text-[10px]" variant={item.active ? "default" : "muted"}>
                {item.active ? "ON" : "OFF"}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </FinanceSection>
  );
}

function StatusLine({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md bg-background/35 px-2 py-2">
      <div className="row-span-2 mt-0.5 text-primary [&_svg]:size-3.5">{icon}</div>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-semibold">{value}</p>
    </div>
  );
}

function PermissionHidden({ children }: { children: ReactNode }) {
  return (
    <FinanceSection title={String(children)}>
      <InlineState>{children}</InlineState>
    </FinanceSection>
  );
}

export function DashboardPage({
  canPermission,
  config,
  enabledCount,
  language,
  modelName,
  onOpenChart,
  onOpenConfig,
  onOpenMarket,
  onOpenNews,
  onOpenPortfolio,
  onOpenWatchlist,
  onPrompt,
}: DashboardPageProps) {
  const copy = i18n[language].overview;
  const canMarket = canPermission("market:read");
  const canPortfolio = canPermission("portfolio:read");
  const canWatchlist = canPermission("watchlist:read");

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [news, setNews] = useState<SecurityNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState("");
  const [selectedNewsSymbol, setSelectedNewsSymbol] = useState("");

  useEffect(() => {
    let mounted = true;
    setDashboardLoading(true);
    setDashboardError("");
    getDashboard()
      .then((response) => {
        if (mounted) setDashboard(response);
      })
      .catch((caught) => {
        if (!mounted) return;
        setDashboard(null);
        setDashboardError(caught instanceof Error ? caught.message : copy.loadFailed);
      })
      .finally(() => {
        if (mounted) setDashboardLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [copy.loadFailed]);

  const marketModule = dashboard?.market;
  const watchlistModule = dashboard?.watchlist;
  const portfolioModule = dashboard?.portfolio;
  const watchlistRows = watchlistModule?.items ?? [];
  const marketRows = marketModule?.indices ?? [];
  const defaultNewsSourceSymbol = watchlistRows[0]?.symbol || marketRows[0]?.symbol || "";
  const availableNewsSymbols = useMemo(
    () => new Set([...watchlistRows.map((item) => item.symbol), ...marketRows.map((quote) => quote.symbol)]),
    [marketRows, watchlistRows],
  );
  const newsSourceSymbol = selectedNewsSymbol || defaultNewsSourceSymbol;

  useEffect(() => {
    if (selectedNewsSymbol && !availableNewsSymbols.has(selectedNewsSymbol)) {
      setSelectedNewsSymbol("");
    }
  }, [availableNewsSymbols, selectedNewsSymbol]);

  useEffect(() => {
    if (!canMarket || !newsSourceSymbol) {
      setNews([]);
      return undefined;
    }
    let mounted = true;
    setNewsLoading(true);
    setNewsError("");
    getSecurityNews(newsSourceSymbol)
      .then((response) => {
        if (mounted) setNews(response.news);
      })
      .catch((caught) => {
        if (mounted) setNewsError(caught instanceof Error ? caught.message : copy.loadFailed);
      })
      .finally(() => {
        if (mounted) setNewsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [canMarket, copy.loadFailed, newsSourceSymbol]);

  return (
    <div className="page-enter mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 flex-col gap-2 lg:h-full lg:overflow-y-auto 2xl:overflow-hidden">
      <HeroSearch language={language} onPrompt={onPrompt} />

      <div className="dashboard-wide-grid grid min-h-0 gap-8 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:flex-1 2xl:grid-cols-[minmax(420px,1fr)_minmax(360px,0.86fr)_390px]">
        <main className="dashboard-scroll-column min-w-0 xl:col-start-1 xl:row-start-1 2xl:col-start-1 2xl:row-start-1">
          {canMarket ? (
            <MarketSnapshot
              error={marketModule?.error || dashboardError}
              indices={marketModule?.indices ?? []}
              language={language}
              loading={dashboardLoading}
              onOpenMarket={onOpenMarket}
            />
          ) : (
            <PermissionHidden>{copy.marketHidden}</PermissionHidden>
          )}

          {canWatchlist ? (
            <WatchlistMovers
              error={watchlistModule?.error || dashboardError}
              language={language}
              loading={dashboardLoading}
              module={watchlistModule}
              onOpenChart={canMarket ? onOpenChart : undefined}
              onOpenWatchlist={onOpenWatchlist}
              onSelectNewsSymbol={setSelectedNewsSymbol}
              selectedNewsSymbol={newsSourceSymbol}
            />
          ) : (
            <PermissionHidden>{copy.watchlistHidden}</PermissionHidden>
          )}
        </main>

        <section className="dashboard-secondary-column dashboard-scroll-column min-w-0 xl:col-start-1 xl:row-start-2 2xl:col-start-2 2xl:row-start-1">
          {canPortfolio ? (
            <PortfolioSummary
              error={portfolioModule?.error || dashboardError}
              language={language}
              loading={dashboardLoading}
              module={portfolioModule}
              onOpenPortfolio={onOpenPortfolio}
            />
          ) : (
            <PermissionHidden>{copy.portfolioHidden}</PermissionHidden>
          )}
          {canMarket ? (
            <NewsPreview
              error={newsError}
              language={language}
              loading={newsLoading}
              news={news}
              onOpenNews={onOpenNews}
              sourceSymbol={newsSourceSymbol}
            />
          ) : null}
        </section>

        <aside className="dashboard-scroll-column finance-right-rail flex min-w-0 flex-col xl:col-start-2 xl:row-span-2 xl:row-start-1 2xl:col-start-3 2xl:row-span-1 2xl:row-start-1">
          <SignalDeck language={language} />
          <SystemStatus config={config} enabledCount={enabledCount} language={language} modelName={modelName} onOpenConfig={onOpenConfig} />
        </aside>
      </div>
    </div>
  );
}
