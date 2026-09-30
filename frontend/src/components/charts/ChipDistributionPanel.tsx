import { useEffect, useId, useMemo, useState, type PointerEvent } from "react";
import { calcChipDistribution, type ChipInputBar } from "@/lib/chip-distribution";
import { useChartColors } from "@/lib/color-scheme";
import { chipCopy, formatTemplate, type AppLanguage } from "@/lib/i18n";
import { readStoredValue, writeStoredValue } from "@/lib/local-storage";
import { cn } from "@/lib/utils";

const LOOKBACKS = ["60", "120", "250"] as const;
const STORAGE_KEY = "stocks-assistant.chart-chip-lookback";

export function ChipDistributionPanel({ bars, period, language, loading, visibleRange }: {
  bars: readonly ChipInputBar[];
  period: "1D" | "1W" | "1M";
  language: AppLanguage;
  loading: boolean;
  visibleRange: { min: number; max: number } | null;
}) {
  const copy = chipCopy[language];
  const hintId = useId();
  const { upColor, downColor } = useChartColors();
  const [lookback, setLookback] = useState(() => readStoredValue(STORAGE_KEY, LOOKBACKS, "120"));
  const [follow, setFollow] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const result = useMemo(() => calcChipDistribution(bars.slice(-Number(lookback))), [bars, lookback]);
  useEffect(() => { writeStoredValue(STORAGE_KEY, lookback); }, [lookback]);
  useEffect(() => { setSelectedIndex(null); }, [result, follow, visibleRange]);

  const formatPrice = (price: number | null) => price == null ? "—" : price.toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
    ...(price < 0.01 ? { maximumSignificantDigits: 4 } : { minimumFractionDigits: 2, maximumFractionDigits: price < 1 ? 4 : 2 }),
  });
  const rangeText = (range: [number, number] | null) => range ? `${formatPrice(range[0])} – ${formatPrice(range[1])}` : "—";
  const first = result.chips[0];
  const last = result.chips[result.chips.length - 1];
  const fullMin = Math.min(first?.low ?? 0, result.lastClose ?? 0);
  const fullMax = Math.max(last?.high ?? 1, result.lastClose ?? 1);
  const padding = Math.max((fullMax - fullMin) * 0.06, fullMax * 0.002, 1e-10);
  const useVisible = follow && visibleRange && Number.isFinite(visibleRange.min) && Number.isFinite(visibleRange.max) && visibleRange.max > visibleRange.min;
  const min = useVisible ? visibleRange.min : Math.max(0, fullMin - padding);
  const max = useVisible ? visibleRange.max : fullMax + padding;
  const span = max - min;
  const visible = result.chips.filter((chip) => chip.high >= min && chip.low <= max);
  const selected = selectedIndex == null ? null : visible[selectedIndex] ?? null;
  const maxShare = Math.max(...result.chips.map((chip) => chip.percent), 1);
  const position = (price: number) => Math.max(0, Math.min(100, (price - min) / span * 100));
  const profit = result.profitRatio;

  function selectAtPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const price = max - (event.clientY - rect.top) / rect.height * span;
    let nearest = 0;
    visible.forEach((chip, index) => {
      if (Math.abs(chip.price - price) < Math.abs(visible[nearest].price - price)) nearest = index;
    });
    setSelectedIndex(nearest);
  }

  return (
    <aside className="technical-chip-panel" aria-label={copy.title} aria-busy={loading}>
      <div className="chip-profile-header space-y-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center justify-between gap-1">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">{copy.title}<span className="rounded bg-muted px-1 py-0.5 text-[9px] font-normal text-muted-foreground" title={copy.method}>{copy.estimate}</span></h3>
          <button type="button" aria-pressed={follow} title={copy.followHint} onClick={() => setFollow((value) => !value)}
            className={cn("min-h-7 shrink-0 rounded px-1.5 text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", follow ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>{copy.follow}</button>
        </div>
        <div role="group" aria-label={copy.range} className="grid grid-cols-3 gap-1 rounded-md bg-muted/50 p-0.5">
          {LOOKBACKS.map((value) => <button key={value} type="button" aria-pressed={lookback === value} onClick={() => setLookback(value)}
            className={cn("min-h-7 rounded px-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", value === lookback ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {formatTemplate(copy.bars, { count: value })}
          </button>)}
        </div>
      </div>

      {loading || !result.chips.length ? <div role="status" className="grid min-h-48 flex-1 place-items-center px-3 text-xs text-muted-foreground">{loading ? copy.loading : copy.empty}</div> : <>
        <div className="chip-profile-ratio shrink-0 px-3 pb-2 pt-2.5">
          <div className="mb-1 flex justify-between gap-2 text-[10px] tabular-nums">
            <span style={{ color: upColor }}>{copy.profit} <strong>{profit!.toFixed(1)}%</strong></span>
            <span style={{ color: downColor }}>{copy.loss} <strong>{(100 - profit!).toFixed(1)}%</strong></span>
          </div>
          <div className="flex h-1 overflow-hidden rounded-full" aria-hidden="true">
            <div style={{ width: `${profit}%`, background: upColor }} /><div className="flex-1" style={{ background: downColor }} />
          </div>
        </div>

        <div className="chip-profile-chart px-3 pt-2">
          {visible.length ? <div className="chip-profile-plot relative h-full outline-none focus-visible:ring-2 focus-visible:ring-ring" role="slider" tabIndex={0}
            aria-label={copy.inspect} aria-describedby={hintId} aria-orientation="vertical"
            aria-valuemin={0} aria-valuemax={visible.length - 1} aria-valuenow={selectedIndex ?? 0}
            aria-valuetext={selected ? `${formatPrice(selected.price)}, ${copy.share} ${selected.percent.toFixed(2)}%` : copy.inspectHint}
            onPointerMove={selectAtPointer} onPointerDown={selectAtPointer}
            onPointerLeave={(event) => { if (event.pointerType === "mouse") setSelectedIndex(null); }}
            onFocus={() => setSelectedIndex((current) => current ?? 0)} onBlur={() => setSelectedIndex(null)}
            onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(event.key)) return;
              event.preventDefault();
              if (event.key === "Escape") { setSelectedIndex(null); return; }
              setSelectedIndex((current) => event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1
                : Math.max(0, Math.min(visible.length - 1, (current ?? 0) + (event.key === "ArrowUp" ? 1 : -1))));
            }}>
            <div className="absolute inset-y-0 left-0 right-14 overflow-hidden" aria-hidden="true">
              {result.cost90 && <div className="absolute inset-x-0 bg-primary/[0.045]" style={{ bottom: `${position(result.cost90[0])}%`, height: `${position(result.cost90[1]) - position(result.cost90[0])}%` }} />}
              {visible.map((chip, index) => {
                const bottom = position(chip.low), top = position(chip.high);
                return <div key={index} className={cn("chip-profile-bin absolute left-0 flex overflow-hidden rounded-[1px]", selectedIndex === index ? "opacity-100 ring-1 ring-foreground/50" : "opacity-70")}
                  style={{ bottom: `${bottom}%`, height: `max(1px, calc(${top - bottom}% - 1px))`, width: `${chip.percent / maxShare * 100}%` }}>
                  <div className="h-full" style={{ width: `${chip.profitVolume / chip.volume * 100}%`, background: upColor }} />
                  <div className="h-full flex-1" style={{ background: downColor }} />
                </div>;
              })}
              {[[result.averageCost, "border-foreground/60 border-dotted"], [result.lastClose, "border-primary border-dashed"]].map(([price, style], index) => (
                typeof price === "number" && price >= min && price <= max ? <div key={index} className={cn("pointer-events-none absolute inset-x-0 border-t", style as string)} style={{ bottom: `${position(price)}%` }} /> : null
              ))}
            </div>
            {[max, min + span / 2, min].map((price, index) => <div key={index} className="pointer-events-none absolute inset-x-0 flex items-center gap-1" style={{ top: `${index * 50}%`, transform: "translateY(-50%)" }} aria-hidden="true">
              <div className="flex-1 border-t border-border/35" /><span className="w-14 text-right font-mono text-[9px] text-muted-foreground">{formatPrice(price)}</span>
            </div>)}
          </div> : <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground" role="status">
            {copy.outOfRange}<button type="button" className="rounded px-2 py-1 text-primary hover:bg-primary/10" onClick={() => setFollow(false)}>{copy.fullRange}</button>
          </div>}
        </div>

        <div className="chip-profile-detail min-h-9 shrink-0 px-3 pt-3 text-[10px] tabular-nums" aria-live="polite">
          {selected ? <div className="flex justify-between gap-2"><span>{formatPrice(selected.low)} – {formatPrice(selected.high)}</span><strong>{copy.share} {selected.percent.toFixed(2)}%</strong></div>
            : <span className="text-muted-foreground">{copy.inspectHint}</span>}
        </div>
        <dl className="chip-profile-stats grid shrink-0 grid-cols-2 gap-x-2 gap-y-2 border-t border-border/60 px-3 py-2 text-[10px] tabular-nums">
          <div><dt className="text-muted-foreground"><span className="mr-1 inline-block w-3 align-middle border-t border-dashed border-primary" />{copy.close}</dt><dd className="mt-0.5 font-mono text-xs font-semibold">{formatPrice(result.lastClose)}</dd></div>
          <div><dt className="text-muted-foreground"><span className="mr-1 inline-block w-3 align-middle border-t border-dotted border-foreground/60" />{copy.average}</dt><dd className="mt-0.5 font-mono text-xs font-semibold">{formatPrice(result.averageCost)}</dd></div>
          {[[copy.peak, formatPrice(result.peakCost)], [copy.cost70, rangeText(result.cost70)], [copy.cost90, rangeText(result.cost90)]].map(([label, value]) => (
            <div key={label} className="col-span-2 flex justify-between gap-1" title={label === copy.peak ? undefined : copy.intervalHint}><dt className="text-muted-foreground">{label}</dt><dd className="font-mono">{value}</dd></div>
          ))}
        </dl>
      </>}
      <div id={hintId} className="chip-profile-method shrink-0 border-t border-border/60 px-3 py-2 text-[9px] leading-4 text-muted-foreground">
        <p>{formatTemplate(copy.sample, { count: loading ? 0 : result.sampleCount, period: period === "1D" ? copy.daily : period === "1W" ? copy.weekly : copy.monthly })}</p>
        <p>{copy.method}</p>
      </div>
    </aside>
  );
}
