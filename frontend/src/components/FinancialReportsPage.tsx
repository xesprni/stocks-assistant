import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Building2,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Table2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFinancialReports, listWatchlist } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  FinancialReportKind,
  FinancialReportPeriod,
  FinancialReportRow,
  FinancialReportsResponse,
  FinancialStatementTable,
  WatchlistCategory,
  WatchlistItem,
} from "@/types/app";

type AppLanguage = "zh" | "en";

const financialReportsCopy = {
  zh: {
    title: "财报",
    subtitle: "利润表、资产负债表、现金流量表",
    allStatements: "三张表",
    incomeStatement: "利润表",
    balanceSheet: "资产负债表",
    cashFlow: "现金流量表",
    quarterly: "季度",
    annual: "年度",
    semiAnnual: "半年度",
    threeQ: "前三季度",
    defaultPeriod: "默认",
    latest: "最新",
    subject: "科目",
    noMatchedRows: "没有匹配的科目",
    loadFailed: "财报加载失败",
    loadingWatchlist: "加载自选股...",
    selectWatchlist: "选择自选股",
    symbolPlaceholder: "股票代码 / Symbol",
    refresh: "刷新",
    statements: "报表",
    rows: "科目",
    source: "来源",
    searchRows: "搜索科目",
    periods: "{count} 期",
    empty: "暂无财报数据",
    initialEmpty: "请选择自选股或输入股票代码查询财报",
  },
  en: {
    title: "Financials",
    subtitle: "Income statement, balance sheet, and cash flow",
    allStatements: "All statements",
    incomeStatement: "Income",
    balanceSheet: "Balance sheet",
    cashFlow: "Cash flow",
    quarterly: "Quarterly",
    annual: "Annual",
    semiAnnual: "Semiannual",
    threeQ: "First three quarters",
    defaultPeriod: "Default",
    latest: "Latest",
    subject: "Line item",
    noMatchedRows: "No matching line items",
    loadFailed: "Failed to load financial reports",
    loadingWatchlist: "Loading watchlist...",
    selectWatchlist: "Select watchlist",
    symbolPlaceholder: "Symbol",
    refresh: "Refresh",
    statements: "Statements",
    rows: "Rows",
    source: "Source",
    searchRows: "Search line items",
    periods: "{count} periods",
    empty: "No financial data",
    initialEmpty: "Select a watchlist symbol or enter a symbol to query financials",
  },
} as const;

type FinancialReportsCopy = (typeof financialReportsCopy)[AppLanguage];

function getKindOptions(language: AppLanguage): Array<{ value: FinancialReportKind; label: string }> {
  const copy = financialReportsCopy[language];
  return [
    { value: "All", label: copy.allStatements },
    { value: "IncomeStatement", label: copy.incomeStatement },
    { value: "BalanceSheet", label: copy.balanceSheet },
    { value: "CashFlow", label: copy.cashFlow },
  ];
}

function getPeriodOptions(language: AppLanguage): Array<{ value: FinancialReportPeriod | ""; label: string }> {
  const copy = financialReportsCopy[language];
  return [
    { value: "QuarterlyFull", label: copy.quarterly },
    { value: "Annual", label: copy.annual },
    { value: "SemiAnnual", label: copy.semiAnnual },
    { value: "Q1", label: "Q1" },
    { value: "Q2", label: "Q2" },
    { value: "Q3", label: "Q3" },
    { value: "ThreeQ", label: copy.threeQ },
    { value: "", label: copy.defaultPeriod },
  ];
}

function formatTemplate(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

const WATCHLIST_CATEGORIES: WatchlistCategory[] = ["US", "A", "H"];

interface FinancialReportsPageProps {
  initialSymbol?: string;
  language: AppLanguage;
}

function normalizeSymbol(value?: string) {
  return value?.trim().toUpperCase() || "";
}

function asNumber(value: string | null) {
  if (!value) return null;
  const n = Number(value.replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

function formatCompact(value: string | null, percent = false) {
  if (value == null || value === "") return "—";
  const n = asNumber(value);
  if (n == null) return value;
  if (percent) {
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return `${pct.toFixed(2)}%`;
  }
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function formatYoy(value: string | null) {
  if (value == null || value === "") return "";
  if (value.endsWith("%")) return value.startsWith("-") ? value : `+${value}`;
  const n = asNumber(value);
  if (n == null) return value;
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function yoyTone(value: string | null) {
  const n = asNumber(value);
  if (n == null || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]";
}

function rowMatches(row: FinancialReportRow, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return row.name.toLowerCase().includes(q) || row.field.toLowerCase().includes(q) || row.tip.toLowerCase().includes(q);
}

function latestPeriod(table: FinancialStatementTable) {
  return table.columns[0]?.label ?? "—";
}

function formatDateLabel(value: string | null) {
  if (!value) return "";
  if (/^\d{10,13}$/.test(value)) {
    const ms = value.length === 13 ? Number(value) : Number(value) * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }
  return value;
}

function StatementTable({ copy, query, table }: { copy: FinancialReportsCopy; table: FinancialStatementTable; query: string }) {
  const rows = table.rows.filter((row) => rowMatches(row, query));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/80">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/80 bg-muted/20 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Table2 className="size-4 text-primary" />
            <p className="truncate text-sm font-semibold">{table.name}</p>
            {table.currency ? <Badge variant="outline">{table.currency}</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{table.title || table.short_title || table.code}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] text-muted-foreground">{copy.latest}</p>
          <p className="text-sm font-semibold tabular-nums">{latestPeriod(table)}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border/80">
              <th className="sticky left-0 z-20 w-[260px] bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                {copy.subject}
              </th>
              {table.columns.map((column) => (
                <th key={column.key} className="min-w-[150px] px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                  <span className="block tabular-nums">{column.label}</span>
                  {column.fp_end ? <span className="block text-[10px] opacity-70">{formatDateLabel(column.fp_end)}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.field || row.name} className="border-b border-border/60 transition-colors hover:bg-muted/20">
                <td className="sticky left-0 z-10 w-[260px] bg-card px-3 py-2 align-top">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.name || row.field}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{row.field}</p>
                  </div>
                </td>
                {row.cells.map((cell) => {
                  const yoy = formatYoy(cell.yoy);
                  return (
                    <td key={`${row.field}-${cell.period}`} className="px-3 py-2 text-right align-top tabular-nums">
                      <p className="font-medium">{formatCompact(cell.value, row.percent)}</p>
                      {yoy ? <p className={cn("text-[11px]", yoyTone(cell.yoy))}>{yoy}</p> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 ? (
          <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">{copy.noMatchedRows}</div>
        ) : null}
      </div>
    </div>
  );
}

export function FinancialReportsPage({ initialSymbol, language }: FinancialReportsPageProps) {
  const copy = financialReportsCopy[language];
  const kindOptions = getKindOptions(language);
  const periodOptions = getPeriodOptions(language);
  const normalizedInitialSymbol = useMemo(() => normalizeSymbol(initialSymbol), [initialSymbol]);
  const [symbol, setSymbol] = useState(normalizedInitialSymbol);
  const [draftSymbol, setDraftSymbol] = useState(normalizedInitialSymbol);
  const [kind, setKind] = useState<FinancialReportKind>("All");
  const [period, setPeriod] = useState<FinancialReportPeriod | "">("QuarterlyFull");
  const [data, setData] = useState<FinancialReportsResponse | null>(null);
  const [active, setActive] = useState("");
  const [query, setQuery] = useState("");
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [isLoadingWatchlist, setIsLoadingWatchlist] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const watchlistOptions = useMemo(() => {
    const seen = new Set<string>();
    return watchlistItems.filter((item) => {
      const key = item.symbol.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [watchlistItems]);

  const selectedWatchlistSymbol = useMemo(
    () => watchlistOptions.find((item) => item.symbol.toUpperCase() === draftSymbol.toUpperCase())?.symbol ?? "",
    [draftSymbol, watchlistOptions],
  );

  const activeStatement = useMemo(
    () => data?.statements.find((item) => item.code === active) ?? data?.statements[0] ?? null,
    [active, data?.statements],
  );

  const totalRows = useMemo(
    () => data?.statements.reduce((sum, item) => sum + item.rows.length, 0) ?? 0,
    [data?.statements],
  );

  async function load(nextSymbol = symbol) {
    const normalized = nextSymbol.trim().toUpperCase();
    if (!normalized) return;
    setIsLoading(true);
    setError("");
    try {
      const result = await getFinancialReports(normalized, kind, period);
      setData(result);
      setSymbol(normalized);
      setDraftSymbol(normalized);
      setActive(result.statements[0]?.code ?? "");
    } catch (caught) {
      setData(null);
      setActive("");
      setSymbol(normalized);
      setDraftSymbol(normalized);
      setError(caught instanceof Error ? caught.message : copy.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    setIsLoadingWatchlist(true);
    Promise.allSettled(WATCHLIST_CATEGORIES.map((category) => listWatchlist(category)))
      .then((results) => {
        if (!alive) return;
        setWatchlistItems(results.flatMap((result) => (result.status === "fulfilled" ? result.value.items : [])));
      })
      .finally(() => {
        if (alive) setIsLoadingWatchlist(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!normalizedInitialSymbol) {
      setSymbol("");
      setDraftSymbol("");
      setData(null);
      setActive("");
      setError("");
      setQuery("");
      return;
    }
    load(normalizedInitialSymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedInitialSymbol]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    load(draftSymbol);
  }

  function handleWatchlistSelect(value: string) {
    const nextSymbol = normalizeSymbol(value);
    if (!nextSymbol) return;
    setDraftSymbol(nextSymbol);
    load(nextSymbol);
  }

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            <p className="font-semibold">{copy.title}</p>
            {data?.symbol ? <Badge variant="outline">{data.symbol}</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
        </div>

        <form className="flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={handleSubmit}>
          <select
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            value={selectedWatchlistSymbol}
            onChange={(event) => handleWatchlistSelect(event.target.value)}
            disabled={isLoadingWatchlist}
          >
            <option value="">{isLoadingWatchlist ? copy.loadingWatchlist : copy.selectWatchlist}</option>
            {watchlistOptions.map((item) => (
              <option key={`${item.category}-${item.symbol}`} value={item.symbol}>
                {item.symbol} {item.name || item.name_cn || item.name_en || ""}
              </option>
            ))}
          </select>
          <div className="relative sm:w-40">
            <Building2 className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 uppercase"
              value={draftSymbol}
              onChange={(event) => setDraftSymbol(event.target.value)}
              placeholder={copy.symbolPlaceholder}
            />
          </div>
          <select
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            value={kind}
            onChange={(event) => setKind(event.target.value as FinancialReportKind)}
          >
            {kindOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            value={period}
            onChange={(event) => setPeriod(event.target.value as FinancialReportPeriod | "")}
          >
            {periodOptions.map((option) => (
              <option key={option.value || "default"} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Button type="submit" disabled={isLoading || !draftSymbol.trim()}>
            {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {copy.refresh}
          </Button>
        </form>
      </div>

      <div className="panel-body flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid shrink-0 gap-3 md:grid-cols-3">
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">{copy.statements}</p>
            <p className="text-lg font-semibold tabular-nums">{data?.statements.length ?? 0}</p>
          </div>
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">{copy.rows}</p>
            <p className="text-lg font-semibold tabular-nums">{totalRows}</p>
          </div>
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">{copy.source}</p>
            <p className="truncate text-lg font-semibold">Longbridge SDK</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative sm:w-80">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={copy.searchRows}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {activeStatement ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database className="size-3.5" />
              <span>{activeStatement.currency || "—"}</span>
              <span>{formatTemplate(copy.periods, { count: activeStatement.columns.length })}</span>
            </div>
          ) : null}
        </div>

        {isLoading && !data ? (
          <div className="grid min-h-80 flex-1 place-items-center rounded-md border border-dashed border-border/80 bg-muted/10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : data?.statements.length ? (
          <Tabs value={activeStatement?.code ?? ""} onValueChange={setActive} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mb-3 shrink-0">
              {data.statements.map((statement) => (
                <TabsTrigger key={statement.code} value={statement.code}>
                  {statement.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {data.statements.map((statement) => (
              <TabsContent key={statement.code} value={statement.code} className="mt-0 min-h-0 flex-1 overflow-hidden">
                <StatementTable copy={copy} table={statement} query={query} />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <div className="grid min-h-80 flex-1 place-items-center rounded-md border border-dashed border-border/80 bg-muted/10 px-4 text-center text-sm text-muted-foreground">
            {symbol ? copy.empty : copy.initialEmpty}
          </div>
        )}
      </div>
    </section>
  );
}
