import { getMessages, formatTemplate, localeFor, type AppLanguage } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import type { EarningsRadarItem } from "@/types/earnings";

export function radarPercent(value: number | null, signed = false) {
  return value == null ? "—" : `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function EarningsRadarCard({ item, language }: { item: EarningsRadarItem; language: AppLanguage }) {
  const copy = getMessages(language).earnings;
  const option = item.option;
  const max = Math.max(1, ...item.history.map((move) => Math.abs(move.move_pct)), option?.implied_move_pct ?? 0);
  const timestamp = (value: string | null) => value ? new Date(value).toLocaleString(localeFor(language), { timeZone: "America/New_York", timeZoneName: "short" }) : "—";
  return <article className="min-w-0 rounded-lg border border-border bg-card p-4">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="text-lg font-semibold tracking-tight">{item.symbol}</h2><p className="text-xs text-muted-foreground">{item.name}</p></div>
      <Badge variant="outline">{copy.valuation[item.valuation]}</Badge>
    </header>
    <div className="my-4 flex flex-wrap justify-between gap-3 border-y border-border py-3">
      <div><p className="text-xs text-muted-foreground">{copy.event}</p><p className="mt-1 text-sm font-medium">{item.next_event ? `${item.next_event.date} · ${copy.timing[item.next_event.timing]}` : item.issues.includes("upcoming_calendar_unavailable") ? copy.unavailable : copy.noEvent}</p>
        <p className="mt-1 text-xs text-muted-foreground">{item.next_event?.period}</p></div>
      <div><p className="text-xs text-muted-foreground">{copy.spot} · USD</p><p className="mt-1 font-mono">{item.spot ?? "—"}</p></div>
    </div>
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <Metric label={copy.eps} value={item.next_event?.eps_estimate || "—"} />
      <Metric label={`${copy.revenue} ${item.next_event?.currency ?? ""}`} value={item.next_event?.revenue_estimate || "—"} />
    </dl>
    <div className="my-4 grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-3">
      <div><p className="text-xs text-muted-foreground">{copy.implied}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{option ? `±${radarPercent(option.implied_move_pct)}` : "—"}</p></div>
      <div><p className="text-xs text-muted-foreground">{copy.median}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{radarPercent(item.historical_median_pct)}</p></div>
      <p className="col-span-2 text-xs text-muted-foreground">{copy.ratio}: <strong className="text-foreground">{item.ratio == null ? "—" : `${item.ratio.toFixed(2)}×`}</strong> · {formatTemplate(copy.samples, { count: item.sample_count })}</p>
    </div>
    {option && <p className="mb-4 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{copy.expiry}: {option.expiry}</span><span>· {formatTemplate(copy.dte, { days: option.dte })}</span><span>· {formatTemplate(copy.gap, { days: option.days_after_earnings })}</span>{option.fallback && <Badge variant="outline">{copy.fallback} ({option.primary_expiry})</Badge>}</p>}
    <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-medium">{copy.history}</h3>{(item.history.length > 0 || option) && <span className="text-xs text-muted-foreground">±{max.toFixed(1)}%</span>}</div>
    <div className="my-3 space-y-1.5" role="img" aria-label={`${copy.history}: ${item.history.length ? item.history.map((move) => `${move.date} ${radarPercent(move.move_pct, true)}`).join(", ") : copy.unavailable}`}>
      {item.history.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">{copy.unavailable}</p>}
      {item.history.map((move) => <div className="grid grid-cols-[5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-[11px]" key={move.date}>
        <span className="text-muted-foreground">{move.date}</span>
        <div className="relative h-4 rounded-sm bg-muted/50"><span className="absolute inset-y-0 left-1/2 border-l border-border" /><span className={`absolute top-0.5 h-3 rounded-sm ${move.move_pct < 0 ? "bg-red-500" : "bg-emerald-500"}`} style={{ left: `${move.move_pct < 0 ? 50 - Math.abs(move.move_pct) / max * 50 : 50}%`, width: `${Math.abs(move.move_pct) / max * 50}%` }} /></div>
        <span className="text-right font-mono">{radarPercent(move.move_pct, true)}</span>
      </div>)}
      {option && <div className="grid grid-cols-[5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-[11px]"><span className="text-amber-600 dark:text-amber-400">{copy.implied}</span><div className="relative h-4 rounded-sm bg-muted/50"><span className="absolute top-0.5 h-3 rounded-sm bg-amber-500/70" style={{ left: `${50 - option.implied_move_pct / max * 50}%`, width: `${option.implied_move_pct / max * 100}%` }} /><span className="absolute inset-y-0 left-1/2 border-l border-foreground/40" /></div><span className="text-right font-mono">±{option.implied_move_pct.toFixed(2)}%</span></div>}
    </div>
    <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm"><Metric label={copy.iv} value={radarPercent(option?.iv_pct ?? null)} /><Metric label={copy.hv} value={radarPercent(item.hv30_pct)} /></dl>
    {item.issues.length > 0 && <ul className="mt-4 space-y-1 border-l-2 border-amber-500/50 pl-3 text-xs leading-5 text-muted-foreground">{item.issues.map((issue) => <li key={issue}>{copy.issues[issue as keyof typeof copy.issues] ?? issue}</li>)}</ul>}
    <details className="mt-4 border-t border-border pt-3 text-xs">
      <summary className="cursor-pointer font-medium">{copy.details}</summary>
      <dl className="mt-3 grid grid-cols-2 gap-3"><Metric label={copy.priceTime} value={timestamp(item.spot_timestamp)} />{option && <>
        <Metric label={copy.strike} value={option.strike} /><Metric label={copy.straddle} value={`${option.call_price} + ${option.put_price} = ${option.straddle}`} />
        <Metric label={option.call_symbol} value={timestamp(option.call_timestamp)} /><Metric label={option.put_symbol} value={timestamp(option.put_timestamp)} />
      </>}</dl>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-2">{copy.history}</th><th className="p-2">{copy.before}</th><th className="p-2">{copy.after}</th><th className="p-2">{copy.move}</th></tr></thead><tbody>{item.history.map((move) => <tr className="border-t border-border" key={move.date}><td className="p-2">{move.date}<br />{copy.timing[move.timing]}</td><td className="p-2">{move.before_date}<br />{move.before_close}</td><td className="p-2">{move.after_date}<br />{move.after_close}</td><td className="p-2 font-mono">{radarPercent(move.move_pct, true)}</td></tr>)}</tbody></table></div>
    </details>
  </article>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="break-words text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium tabular-nums">{value}</dd></div>;
}
