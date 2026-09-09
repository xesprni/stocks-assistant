import { useId, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined } from "lucide-react";
import type { PortfolioItem } from "@/types/app";
import { cn } from "@/lib/utils";
import { formatMoney, holdingPnl, type PortfolioPieSegment, type PortfolioTrendPoint } from "./model";

type Language = "zh" | "en";

export function PortfolioTrendChart({ hideSensitive, points, language, currency }: {
  hideSensitive: boolean; points: PortfolioTrendPoint[]; language: Language; currency: string;
}) {
  const gradientId = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const zh = language === "zh";
  const activeIndex = Math.min(hoveredIndex ?? points.length - 1, points.length - 1);
  const active = points[activeIndex];
  const first = points[0];
  const change = active && first ? active.value - first.value : null;
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const margin = Math.max((high - low) * 0.18, Math.abs(high) * 0.005, 1);
  const min = low - margin;
  const max = high + margin;
  const width = 720;
  const height = 210;
  const left = 4;
  const right = width - 4;
  const plotTop = 10;
  const bottom = height - 10;
  const coords = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? width / 2 : left + index / (points.length - 1) * (right - left),
    y: bottom - (point.value - min) / (max - min) * (bottom - plotTop),
  }));
  const path = coords.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const activeCoord = coords[activeIndex];

  return (
    <div className="min-w-0">
      <div className="mb-5 flex min-h-14 flex-wrap items-end justify-between gap-3">
        <div aria-live="polite" aria-atomic="true">
          <p className="text-xs text-muted-foreground">{active?.date ?? (zh ? "等待资产快照" : "Waiting for snapshots")}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{hideSensitive ? "***" : formatMoney(active?.value)} <span className="text-xs font-normal tracking-normal text-muted-foreground">{currency}</span></p>
        </div>
        {change != null && points.length > 1 ? (
          <div className="text-right">
            <p className={cn("inline-flex items-center gap-1 font-medium tabular-nums", change >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]")}>
              {change >= 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
              {hideSensitive ? "***" : `${change > 0 ? "+" : ""}${formatMoney(change)}`}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{zh ? "较本区间首个快照" : "From first snapshot in view"}</p>
          </div>
        ) : null}
      </div>
      {points.length === 0 ? (
        <div className="grid min-h-56 place-content-center gap-3 rounded-xl bg-muted/20 text-center text-sm text-muted-foreground">
          <ChartNoAxesCombined className="mx-auto size-7 opacity-50" />
          {zh ? "完整行情加载后开始记录资产快照" : "Snapshots begin when complete quotes are available"}
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="flex w-16 shrink-0 flex-col justify-between py-2.5 text-right font-mono text-[10px] text-muted-foreground sm:w-20">
            {[max, (min + max) / 2, min].map((value, index) => <span key={index}>{hideSensitive ? "***" : formatMoney(value)}</span>)}
          </div>
          <div
            className="relative min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            tabIndex={0}
            role="group"
            aria-label={zh ? "资产快照图，左右方向键查看各日期" : "Asset snapshots. Use arrow keys to inspect dates"}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setHoveredIndex(Math.max(0, Math.min(points.length - 1, activeIndex + (event.key === "ArrowLeft" ? -1 : 1))));
              }
            }}
            onPointerLeave={() => setHoveredIndex(null)}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setHoveredIndex(Math.max(0, Math.min(points.length - 1, Math.round((event.clientX - bounds.left) / bounds.width * (points.length - 1)))));
            }}
          >
            <svg className="h-56 w-full sm:h-64" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
              <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.22" /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.01" /></linearGradient></defs>
              {[plotTop, (plotTop + bottom) / 2, bottom].map((y) => <line key={y} x1={left} x2={right} y1={y} y2={y} className="stroke-border/70" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" />)}
              {coords.length > 1 ? <><path d={`${path} L ${coords[coords.length - 1].x} ${bottom} L ${coords[0].x} ${bottom} Z`} fill={`url(#${gradientId})`} /><path d={path} fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></> : null}
              {activeCoord ? <>
                <line x1={activeCoord.x} x2={activeCoord.x} y1={plotTop} y2={bottom} className="stroke-primary/35" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
                <circle cx={activeCoord.x} cy={activeCoord.y} r="5" className="fill-primary stroke-background" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              </> : null}
            </svg>
          </div>
        </div>
      )}
      {points.length > 0 ? <div className="ml-[4.75rem] mt-2 flex justify-between text-[10px] tabular-nums text-muted-foreground sm:ml-[5.75rem]">
        <span>{first.date}</span><span>{points.length > 2 ? points[Math.floor(points.length / 2)].label : ""}</span><span>{points.length > 1 ? points[points.length - 1].date : ""}</span>
      </div> : null}
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        {points.length === 1 ? (zh ? "已记录 1 个快照，后续访问会逐日积累。" : "One snapshot recorded. Future visits build your history. ") : ""}
        {zh ? "仅记录此账户在当前浏览器的完整估值；每日本地时间保留最后一次记录。资产变化包含出入金和持仓调整，不代表投资收益。" : "Stored in this browser for this account, using the last complete valuation each local day. Changes include cash flows and position adjustments, and do not represent investment returns."}
      </p>
    </div>
  );
}

export function PortfolioPieChart({ emptyLabel, hideSensitive, segments, language, currency, onSelect }: {
  emptyLabel: string; hideSensitive: boolean; segments: PortfolioPieSegment[]; language: Language; currency: string; onSelect?: (label: string) => void;
}) {
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const active = segments.find((segment) => segment.label === hoveredLabel);
  let offset = 0;
  return (
    <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(140px,0.85fr)_minmax(0,1.15fr)] sm:items-center">
      <div className="relative mx-auto flex size-44 items-center justify-center sm:size-48" onPointerLeave={() => setHoveredLabel(null)}>
        <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="82" fill="none" className="stroke-muted/50" strokeWidth="18" />
          {segments.map((segment) => {
            const percent = total > 0 ? segment.value / total * 100 : 0;
            const currentOffset = -offset;
            offset += percent;
            return <circle key={segment.label} cx="100" cy="100" r="82" fill="none" pathLength="100" stroke={segment.color} strokeWidth={hoveredLabel === segment.label ? "23" : "18"}
              strokeDasharray={`${Math.max(0, percent - (segments.length > 1 ? Math.min(0.8, percent / 5) : 0))} 100`} strokeDashoffset={currentOffset}
              opacity={!hoveredLabel || hoveredLabel === segment.label ? 1 : 0.25}
              className="transition-[opacity,stroke-width] motion-reduce:transition-none" onPointerEnter={() => setHoveredLabel(segment.label)} />;
          })}
        </svg>
        <div className="pointer-events-none max-w-[125px] text-center">
          <p className="truncate text-[11px] text-muted-foreground">{active?.label ?? (language === "zh" ? "合计" : "Total")}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{active ? `${(active.value / total * 100).toFixed(1)}%` : hideSensitive ? "***" : formatMoney(total)}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{currency}</p>
        </div>
      </div>
      <div className="max-h-64 min-w-0 space-y-1 overflow-y-auto pr-1" onPointerLeave={() => setHoveredLabel(null)}>
        {segments.length === 0 ? <p className="py-5 text-center text-xs text-muted-foreground">{emptyLabel}</p> : segments.map((segment) => <button
          type="button" key={segment.label} onFocus={() => setHoveredLabel(segment.label)} onBlur={() => setHoveredLabel(null)} onPointerEnter={() => setHoveredLabel(segment.label)}
          onClick={() => { setHoveredLabel(segment.label); onSelect?.(segment.label); }}
          className={cn("w-full rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary", hoveredLabel === segment.label ? "bg-muted/65" : "hover:bg-muted/35")}
          aria-label={`${segment.label} ${(segment.value / total * 100).toFixed(2)}%${onSelect ? (language === "zh" ? "，查看持仓详情" : ", open holding details") : ""}`}
        >
          <div className="flex items-center gap-2 text-xs"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} /><span className="min-w-0 flex-1 truncate font-medium">{segment.label}</span><span className="shrink-0 tabular-nums">{(segment.value / total * 100).toFixed(1)}%</span></div>
          <div className="mt-1.5 flex items-center gap-3 pl-4"><div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/50"><div className="h-full rounded-full" style={{ width: `${segment.value / total * 100}%`, backgroundColor: segment.color }} /></div><span className="text-[10px] tabular-nums text-muted-foreground">{hideSensitive ? "***" : segment.displayValue}</span></div>
        </button>)}
      </div>
    </div>
  );
}

export function PortfolioPnlChart({ items, hideSensitive, language, currency, onSelect }: {
  items: PortfolioItem[]; hideSensitive: boolean; language: Language; currency: string; onSelect: (item: PortfolioItem) => void;
}) {
  const [mode, setMode] = useState<"amount" | "ratio">("amount");
  const points = items.map((item) => {
    const pnl = holdingPnl(item);
    const cost = Number(item.cost_price) * Number(item.shares);
    return { item, value: mode === "amount" ? pnl : pnl != null && cost > 0 ? pnl / cost * 100 : null };
  }).filter((point): point is { item: PortfolioItem; value: number } => point.value != null)
    .sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...points.map((point) => Math.abs(point.value)));
  const zh = language === "zh";
  return <div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold">{zh ? "持仓盈亏贡献" : "Holding P&L"}</h3><p className="mt-1 text-[11px] text-muted-foreground">{zh ? "点击标的查看持仓详情" : "Select a holding to view details"}</p></div>
      <div className="flex rounded-lg bg-muted/45 p-1">{(["amount", "ratio"] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} aria-label={value === "amount" ? (zh ? `按盈亏金额显示，${currency}` : `Show P&L amount in ${currency}`) : (zh ? "按盈亏比例显示" : "Show P&L percentage")} className={cn("rounded-md px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background", mode === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground")} onClick={() => setMode(value)}>{value === "amount" ? currency : "%"}</button>)}</div>
    </div>
    {points.length ? <div className="max-h-80 space-y-1 overflow-y-auto">
      {points.map(({ item, value }) => <button key={item.id} type="button" onClick={() => onSelect(item)} className="grid w-full grid-cols-[80px_minmax(0,1fr)_80px] items-center gap-3 rounded-lg px-2 py-3 text-xs hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[100px_minmax(0,1fr)_110px]">
        <span className="truncate text-left font-medium">{item.symbol}</span>
        <div className="relative h-5"><span className="absolute inset-y-0 left-1/2 w-px bg-border" /><span className="absolute top-1 h-3 rounded-sm opacity-80" style={{ left: `${value < 0 ? 50 - Math.abs(value) / max * 48 : 50}%`, width: `${Math.abs(value) / max * 48}%`, backgroundColor: value >= 0 ? "var(--color-up)" : "var(--color-down)" }} /></div>
        <span className={cn("text-right font-medium tabular-nums", value >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]")}>{hideSensitive && mode === "amount" ? "***" : `${value > 0 ? "+" : ""}${formatMoney(value)}${mode === "ratio" ? "%" : ""}`}</span>
      </button>)}
    </div> : <p className="rounded-lg bg-muted/20 px-4 py-10 text-center text-xs text-muted-foreground">{zh ? "补充股数、成本和有效行情后显示盈亏" : "Add shares, cost basis, and live quotes to view P&L"}</p>}
    <p className="mt-4 text-[11px] text-muted-foreground">{zh ? "仅包含股数、成本及现价完整的持仓，未计入费用和已实现盈亏。" : "Includes holdings with shares, cost, and current quotes. Excludes fees and realized P&L."}</p>
  </div>;
}
