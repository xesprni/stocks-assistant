import { Activity, CalendarDays, ChevronDown, Clock3 } from "lucide-react";
import { getMessages, formatTemplate, localeFor, type AppLanguage } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import type { EarningsRadarItem } from "@/types/earnings";
import { radarHistory, radarPercent } from "@/lib/earnings-radar-presentation";
import { EarningsHistoryChart } from "./EarningsHistoryChart";
import { EarningsDataNotes } from "./EarningsDataNotes";

export { radarPercent } from "@/lib/earnings-radar-presentation";

export function EarningsRadarCard({ item, language }: { item: EarningsRadarItem; language: AppLanguage }) {
  const copy = getMessages(language).earnings;
  const option = item.option;
  const history = radarHistory(item);
  const timestamp = (value: string | null) => value ? new Date(value).toLocaleString(localeFor(language), {
    timeZone: "America/New_York", timeZoneName: "short",
  }) : "—";

  return <article className="earnings-card" aria-label={item.symbol}>
    <header className="earnings-card-header">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-xl font-semibold tracking-tight">{item.symbol}</h2>
          <Badge variant="outline" className={`earnings-valuation earnings-valuation--${item.valuation}`}>
            {copy.valuation[item.valuation]}
          </Badge>
        </div>
        <p className="mt-1.5 break-words text-xs text-muted-foreground">{item.name}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[11px] text-muted-foreground">{copy.spot} <span className="ml-1">USD</span></p>
        <p className="mt-1 text-xl font-medium tabular-nums tracking-tight">{item.spot ?? "—"}</p>
      </div>
    </header>

    <div className="earnings-event-strip">
      <div className="earnings-event-date">
        <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{copy.event}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm font-semibold tabular-nums">{item.next_event?.date ?? (
              item.issues.includes("upcoming_calendar_unavailable") ? copy.unavailable : copy.noEvent
            )}</p>
            {item.next_event && <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock3 className="size-3" aria-hidden="true" />{copy.timing[item.next_event.timing]}
            </span>}
          </div>
          {item.next_event?.period && <p className="mt-1 text-[11px] text-muted-foreground">{item.next_event.period}</p>}
        </div>
      </div>
      <dl className="earnings-estimates">
        <Metric label={copy.eps} value={item.next_event?.eps_estimate || "—"} />
        <Metric label={`${copy.revenue} ${item.next_event?.currency ?? ""}`} value={item.next_event?.revenue_estimate || "—"} />
      </dl>
    </div>

    <div className="earnings-card-content">
      <section className="earnings-pricing" aria-label={copy.pricing}>
        <h3 className="flex items-center gap-2 text-xs font-semibold">
          <Activity className="size-3.5 text-muted-foreground" aria-hidden="true" />{copy.pricing}
        </h3>
        <div className="earnings-comparison">
          <div className="earnings-comparison-metrics">
            <div className="min-w-0">
              <p className="text-xs leading-5 text-muted-foreground">{copy.implied}</p>
              <p className="earnings-primary-value text-amber-700 dark:text-amber-400">
                {option ? <><span className="mr-0.5 text-xl font-normal">±</span>{radarPercent(option.implied_move_pct)}</> : "—"}
              </p>
              <p className="text-[11px] leading-4 text-muted-foreground">{option ? copy.marketExpectation : copy.pricingUnavailable}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs leading-5 text-muted-foreground">{copy.median}</p>
              <p className="earnings-primary-value">{radarPercent(item.historical_median_pct)}</p>
              <p className="text-[11px] leading-4 text-muted-foreground">{copy.historicalBaseline}</p>
            </div>
          </div>
          <div className="earnings-ratio">
            <span className="text-xs text-muted-foreground">{copy.ratio}</span>
            <strong className="text-lg font-semibold tabular-nums" title={item.ratio == null ? copy.comparisonUnavailable : undefined}>
              {item.ratio == null ? "—" : `${item.ratio.toFixed(2)}×`}
            </strong>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <Metric label={copy.iv} value={radarPercent(option?.iv_pct ?? null)} />
          <Metric label={copy.hv} value={radarPercent(item.hv30_pct)} />
        </dl>
        {option && <div className="earnings-expiry">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{copy.expiry}</span><span className="font-medium tabular-nums text-foreground">{option.expiry}</span>
          </div>
          <p className="mt-1.5">{formatTemplate(copy.dte, { days: option.dte })} · {formatTemplate(copy.gap, { days: option.days_after_earnings })}</p>
          {option.fallback && <p className="mt-2 text-amber-700 dark:text-amber-400">{copy.fallback} · {option.primary_expiry}</p>}
        </div>}
        <EarningsDataNotes item={item} language={language} />
      </section>
      <EarningsHistoryChart item={item} language={language} />
    </div>

    <div className="earnings-card-footer">
      <details className="earnings-details">
        <summary className="flex items-center justify-between gap-2 text-xs font-medium">
          {copy.details}<ChevronDown className="earnings-disclosure-icon size-4 text-muted-foreground" aria-hidden="true" />
        </summary>
        <dl className="my-4 grid grid-cols-2 gap-4">
          <Metric label={copy.priceTime} value={timestamp(item.spot_timestamp)} />
          {option && <>
            <Metric label={copy.strike} value={option.strike} />
            <Metric label={copy.straddle} value={`${option.call_price} + ${option.put_price} = ${option.straddle}`} />
            <Metric label={option.call_symbol} value={timestamp(option.call_timestamp)} />
            <Metric label={option.put_symbol} value={timestamp(option.put_timestamp)} />
          </>}
        </dl>
        {history.length > 0 && <div className="earnings-history-table" role="region" aria-label={copy.details} tabIndex={0}>
          <table className="w-full text-left text-xs">
            <thead><tr>{[copy.period, copy.before, copy.after, copy.move].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{history.map((entry) => <tr key={entry.date}>
              <td><p className="font-medium tabular-nums">{entry.date}</p><p className="mt-1 text-muted-foreground">{entry.period}</p><p className="mt-1 text-muted-foreground">{copy.timing[entry.timing]}</p></td>
              <td><p>{entry.move?.before_date ?? "—"}</p><p className="mt-1 text-muted-foreground">{entry.move?.before_close ?? "—"}</p></td>
              <td><p>{entry.move?.after_date ?? "—"}</p><p className="mt-1 text-muted-foreground">{entry.move?.after_close ?? "—"}</p></td>
              <td>{entry.move ? radarPercent(entry.move.move_pct, true) : copy.historyMissing[entry.exclusion_reason ?? "missing_prices"]}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </details>
    </div>
  </article>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0">
    <dt className="break-words text-[11px] leading-4 text-muted-foreground">{label}</dt>
    <dd className="mt-1.5 break-words text-sm font-medium tabular-nums">{value}</dd>
  </div>;
}
