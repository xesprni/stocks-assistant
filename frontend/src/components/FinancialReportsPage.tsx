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
import { getFinancialReports } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  FinancialReportKind,
  FinancialReportPeriod,
  FinancialReportRow,
  FinancialReportsResponse,
  FinancialStatementTable,
} from "@/types/app";

const KIND_OPTIONS: Array<{ value: FinancialReportKind; label: string }> = [
  { value: "All", label: "三张表" },
  { value: "IncomeStatement", label: "利润表" },
  { value: "BalanceSheet", label: "资产负债表" },
  { value: "CashFlow", label: "现金流量表" },
];

const PERIOD_OPTIONS: Array<{ value: FinancialReportPeriod | ""; label: string }> = [
  { value: "QuarterlyFull", label: "季度" },
  { value: "Annual", label: "年度" },
  { value: "SemiAnnual", label: "半年度" },
  { value: "Q1", label: "Q1" },
  { value: "Q2", label: "Q2" },
  { value: "Q3", label: "Q3" },
  { value: "ThreeQ", label: "前三季度" },
  { value: "", label: "默认" },
];

const DEFAULT_SYMBOL = "AAPL.US";

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

function StatementTable({ table, query }: { table: FinancialStatementTable; query: string }) {
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
          <p className="text-[11px] text-muted-foreground">最新</p>
          <p className="text-sm font-semibold tabular-nums">{latestPeriod(table)}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border/80">
              <th className="sticky left-0 z-20 w-[260px] bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                科目
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
          <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">没有匹配的科目</div>
        ) : null}
      </div>
    </div>
  );
}

export function FinancialReportsPage() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [draftSymbol, setDraftSymbol] = useState(DEFAULT_SYMBOL);
  const [kind, setKind] = useState<FinancialReportKind>("All");
  const [period, setPeriod] = useState<FinancialReportPeriod | "">("QuarterlyFull");
  const [data, setData] = useState<FinancialReportsResponse | null>(null);
  const [active, setActive] = useState("");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

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
      setError(caught instanceof Error ? caught.message : "财报加载失败");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load(DEFAULT_SYMBOL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    load(draftSymbol);
  }

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            <p className="font-semibold">财报</p>
            {data?.symbol ? <Badge variant="outline">{data.symbol}</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">利润表、资产负债表、现金流量表</p>
        </div>

        <form className="flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={handleSubmit}>
          <div className="relative sm:w-40">
            <Building2 className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 uppercase"
              value={draftSymbol}
              onChange={(event) => setDraftSymbol(event.target.value)}
              placeholder="AAPL.US"
            />
          </div>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={kind}
            onChange={(event) => setKind(event.target.value as FinancialReportKind)}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={period}
            onChange={(event) => setPeriod(event.target.value as FinancialReportPeriod | "")}
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value || "default"} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Button type="submit" disabled={isLoading || !draftSymbol.trim()}>
            {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            刷新
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
            <p className="text-[11px] text-muted-foreground">报表</p>
            <p className="text-lg font-semibold tabular-nums">{data?.statements.length ?? 0}</p>
          </div>
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">科目</p>
            <p className="text-lg font-semibold tabular-nums">{totalRows}</p>
          </div>
          <div className="metric-tile">
            <p className="text-[11px] text-muted-foreground">来源</p>
            <p className="truncate text-lg font-semibold">Longbridge SDK</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative sm:w-80">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="搜索科目"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {activeStatement ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database className="size-3.5" />
              <span>{activeStatement.currency || "—"}</span>
              <span>{activeStatement.columns.length} 期</span>
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
                <StatementTable table={statement} query={query} />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <div className="grid min-h-80 flex-1 place-items-center rounded-md border border-dashed border-border/80 bg-muted/10 px-4 text-center text-sm text-muted-foreground">
            暂无财报数据
          </div>
        )}
      </div>
    </section>
  );
}
