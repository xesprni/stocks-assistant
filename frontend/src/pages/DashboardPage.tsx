import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
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
import { getIndexQuotes, getSecurityNews, getStockQuotes, listPortfolio, listWatchlist } from "@/lib/api";
import { formatTemplate, i18n, localeFor, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  AppConfig,
  PortfolioItem,
  PortfolioListResponse,
  PortfolioMarket,
  QuoteItem,
  SecurityNewsItem,
  WatchlistCategory,
  WatchlistItem,
} from "@/types/app";

const WATCHLIST_CATEGORIES: WatchlistCategory[] = ["US", "A", "H"];
const PORTFOLIO_MARKETS: PortfolioMarket[] = ["US", "A"];

type SymbolRow = Pick<QuoteItem, "symbol" | "name" | "category" | "last_done" | "change_value" | "change_rate">;
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

function symbolName(item: Pick<WatchlistItem, "name" | "name_cn" | "name_en" | "name_hk">, language: AppLanguage) {
  if (language === "zh") return item.name_cn || item.name_hk || item.name || item.name_en || "-";
  return item.name_en || item.name || item.name_cn || item.name_hk || "-";
}

function fromWatchlistItem(item: WatchlistItem, language: AppLanguage): SymbolRow {
  return {
    symbol: item.symbol,
    name: symbolName(item, language),
    category: item.category,
    last_done: item.last_done,
    change_value: item.change_value,
    change_rate: item.change_rate,
  };
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

function sortByAbsRate(rows: SymbolRow[]) {
  return [...rows].sort((a, b) => Math.abs(parseNumber(b.change_rate) ?? 0) - Math.abs(parseNumber(a.change_rate) ?? 0));
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
  onSelect,
  row,
}: {
  language: AppLanguage;
  onSelect?: (symbol: string) => void;
  row: SymbolRow;
}) {
  const tone = rateTone(row.change_rate);
  const Icon = tone === "down" ? ArrowDownRight : tone === "up" ? ArrowUpRight : Activity;
  return (
    <button
      className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 sm:px-2"
      onClick={() => onSelect?.(row.symbol)}
      type="button"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold">{row.symbol}</p>
          {row.category ? <Badge className="h-5 px-1.5 text-[10px]" variant="outline">{row.category}</Badge> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{row.name || "-"}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums">{formatNumeric(row.last_done, language, 3)}</p>
        <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-xs font-semibold tabular-nums", toneClass(tone))}>
          <Icon className="size-3.5" />
          <span>{formatPercent(row.change_rate, language)}</span>
        </div>
      </div>
    </button>
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
  movers,
  onOpenChart,
  onOpenWatchlist,
  watchlists,
}: {
  error: string;
  language: AppLanguage;
  loading: boolean;
  movers: SymbolRow[];
  onOpenChart: (symbol: string) => void;
  onOpenWatchlist: () => void;
  watchlists: Record<WatchlistCategory, WatchlistItem[]>;
}) {
  const copy = i18n[language].overview;
  const visible = sortByAbsRate(movers).slice(0, 6);
  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenWatchlist}>{copy.viewWatchlist}<ArrowRight /></Button>}
      icon={<Star />}
      subtitle={copy.watchlistMoversSubtitle}
      title={copy.watchlistMovers}
    >
      {loading && visible.length === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingMarket}</InlineState>
      ) : error && visible.length === 0 ? (
        <InlineState>{error}</InlineState>
      ) : visible.length === 0 ? (
        <InlineState>{copy.emptyMovers}</InlineState>
      ) : (
        <div className="divide-y divide-border/55 border-y border-border/55">
          {visible.map((row) => (
            <QuoteRow language={language} key={`${row.category}-${row.symbol}`} onSelect={onOpenChart} row={row} />
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {WATCHLIST_CATEGORIES.map((category) => (
          <Badge className="gap-1.5 border-border/60 bg-background/45" key={category} variant="outline">
            {categoryLabel(category, language)}
            <span className="text-muted-foreground">{watchlists[category]?.length ?? 0}</span>
          </Badge>
        ))}
      </div>
    </FinanceSection>
  );
}

function PortfolioSummary({
  error,
  language,
  loading,
  onOpenPortfolio,
  portfolios,
}: {
  error: string;
  language: AppLanguage;
  loading: boolean;
  onOpenPortfolio: () => void;
  portfolios: PortfolioListResponse[];
}) {
  const copy = i18n[language].overview;
  const positions = portfolios
    .flatMap((portfolio) => portfolio.items.map((item) => ({ ...item, market: portfolio.market })))
    .sort((a, b) => (parseNumber(b.position_ratio) ?? 0) - (parseNumber(a.position_ratio) ?? 0))
    .slice(0, 4);

  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenPortfolio}>{copy.viewPortfolio}<ArrowRight /></Button>}
      icon={<BriefcaseBusiness />}
      subtitle={copy.portfolioSubtitle}
      title={copy.portfolioTitle}
    >
      {loading && portfolios.length === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingPortfolio}</InlineState>
      ) : error && portfolios.length === 0 ? (
        <InlineState>{error}</InlineState>
      ) : portfolios.length === 0 ? (
        <InlineState>{copy.emptyPortfolio}</InlineState>
      ) : (
        <div className="space-y-4">
          <div className="grid divide-y divide-border/55 border-y border-border/55 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {portfolios.map((portfolio) => (
              <div className="px-1 py-3 sm:px-3" key={portfolio.market}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">{marketLabel(portfolio.market, language)}</p>
                  <Badge className="border-transparent bg-muted/35 shadow-none" variant="outline">
                    {formatTemplate(copy.positionsCount, { count: portfolio.total })}
                  </Badge>
                </div>
                <p className="text-lg font-semibold tabular-nums">{formatNumeric(portfolio.total_assets, language)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {copy.cashRatio}: {formatPercent(portfolio.cash_ratio, language)}
                </p>
              </div>
            ))}
          </div>
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

function PortfolioPosition({ item, language }: { item: PortfolioItem; language: AppLanguage }) {
  const copy = i18n[language].overview;
  const tone = rateTone(item.pnl_ratio);
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
        <p className="text-sm font-semibold tabular-nums">{formatNumeric(item.stock_value, language)}</p>
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

  const [indices, setIndices] = useState<QuoteItem[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [indicesError, setIndicesError] = useState("");
  const [stockQuotes, setStockQuotes] = useState<QuoteItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState("");
  const [watchlists, setWatchlists] = useState<Record<WatchlistCategory, WatchlistItem[]>>({ US: [], A: [], H: [] });
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState("");
  const [portfolios, setPortfolios] = useState<PortfolioListResponse[]>([]);
  const [news, setNews] = useState<SecurityNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState("");

  useEffect(() => {
    if (!canMarket) return undefined;
    let mounted = true;
    setIndicesLoading(true);
    setIndicesError("");
    getIndexQuotes()
      .then((response) => {
        if (mounted) setIndices(response.quotes);
      })
      .catch((caught) => {
        if (mounted) setIndicesError(caught instanceof Error ? caught.message : copy.loadFailed);
      })
      .finally(() => {
        if (mounted) setIndicesLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [canMarket, copy.loadFailed]);

  useEffect(() => {
    if (!canMarket) return undefined;
    let mounted = true;
    setStockLoading(true);
    setStockError("");
    getStockQuotes()
      .then((response) => {
        if (mounted) setStockQuotes(response.quotes);
      })
      .catch((caught) => {
        if (mounted) setStockError(caught instanceof Error ? caught.message : copy.loadFailed);
      })
      .finally(() => {
        if (mounted) setStockLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [canMarket, copy.loadFailed]);

  useEffect(() => {
    if (!canWatchlist) return undefined;
    let mounted = true;
    setWatchlistLoading(true);
    Promise.allSettled(WATCHLIST_CATEGORIES.map((category) => listWatchlist(category)))
      .then((results) => {
        if (!mounted) return;
        const next: Record<WatchlistCategory, WatchlistItem[]> = { US: [], A: [], H: [] };
        results.forEach((result, index) => {
          const category = WATCHLIST_CATEGORIES[index];
          if (result.status === "fulfilled") next[category] = result.value.items;
        });
        setWatchlists(next);
      })
      .finally(() => {
        if (mounted) setWatchlistLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [canWatchlist]);

  useEffect(() => {
    if (!canPortfolio) return undefined;
    let mounted = true;
    setPortfolioLoading(true);
    setPortfolioError("");
    Promise.allSettled(PORTFOLIO_MARKETS.map((market) => listPortfolio(market)))
      .then((results) => {
        if (!mounted) return;
        const fulfilled = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
        setPortfolios(fulfilled);
        if (fulfilled.length === 0) {
          const firstError = results.find((result) => result.status === "rejected");
          setPortfolioError(firstError?.status === "rejected" && firstError.reason instanceof Error ? firstError.reason.message : copy.loadFailed);
        }
      })
      .finally(() => {
        if (mounted) setPortfolioLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [canPortfolio, copy.loadFailed]);

  const watchlistItems = useMemo(() => WATCHLIST_CATEGORIES.flatMap((category) => watchlists[category]), [watchlists]);
  const moverRows = useMemo<SymbolRow[]>(() => {
    if (stockQuotes.length > 0) return stockQuotes;
    return watchlistItems.map((item) => fromWatchlistItem(item, language));
  }, [language, stockQuotes, watchlistItems]);
  const newsSourceSymbol = watchlistItems[0]?.symbol || stockQuotes[0]?.symbol || "";

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
            <MarketSnapshot error={indicesError} indices={indices} language={language} loading={indicesLoading} onOpenMarket={onOpenMarket} />
          ) : (
            <PermissionHidden>{copy.marketHidden}</PermissionHidden>
          )}

          {canMarket ? (
            <WatchlistMovers
              error={stockError}
              language={language}
              loading={stockLoading || watchlistLoading}
              movers={moverRows}
              onOpenChart={onOpenChart}
              onOpenWatchlist={onOpenWatchlist}
              watchlists={watchlists}
            />
          ) : null}
        </main>

        <section className="dashboard-secondary-column dashboard-scroll-column min-w-0 xl:col-start-1 xl:row-start-2 2xl:col-start-2 2xl:row-start-1">
          {canPortfolio ? (
            <PortfolioSummary
              error={portfolioError}
              language={language}
              loading={portfolioLoading}
              onOpenPortfolio={onOpenPortfolio}
              portfolios={portfolios}
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
