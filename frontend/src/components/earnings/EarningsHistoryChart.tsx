import { ChartNoAxesColumn } from "lucide-react";
import { formatTemplate, getMessages, type AppLanguage } from "@/i18n";
import { radarHistory, radarPercent } from "@/lib/earnings-radar-presentation";
import type { EarningsRadarItem } from "@/types/earnings";

export function EarningsHistoryChart({ item, language }: { item: EarningsRadarItem; language: AppLanguage }) {
  const copy = getMessages(language).earnings;
  const history = [...radarHistory(item)].sort((a, b) => b.date.localeCompare(a.date));
  const implied = item.option?.implied_move_pct;
  const max = Math.max(1, ...history.map((entry) => Math.abs(entry.move?.move_pct ?? 0)), implied ?? 0);
  const hasMoves = history.some((entry) => entry.move != null) || implied != null;

  return <section className="earnings-history" aria-label={copy.history}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold">
        <ChartNoAxesColumn className="size-3.5 text-muted-foreground" aria-hidden="true" />{copy.history}
      </h3>
      <span className="earnings-sample-count">{formatTemplate(copy.sampleBadge, { count: item.sample_count })}</span>
    </div>
    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
      {formatTemplate(copy.historyCoverage, { count: history.length, samples: item.sample_count })}
    </p>
    {history.length === 0 && <div className="earnings-history-empty">{copy.historyUnavailable}</div>}
    {hasMoves && <div className="earnings-chart-row earnings-chart-axis" aria-hidden="true">
      <span /><div className="flex justify-between"><span>−{max.toFixed(1)}%</span><span>0</span><span>+{max.toFixed(1)}%</span></div><span />
    </div>}
    <ul className="earnings-chart" aria-label={copy.newestFirst}>
      {history.map((entry) => {
        const move = entry.move?.move_pct;
        const missing = entry.exclusion_reason ?? "missing_prices";
        return <li className="earnings-chart-row" key={entry.date} title={`${entry.period} · ${copy.timing[entry.timing]}`}>
          <time className="tabular-nums text-muted-foreground" dateTime={entry.date}>{entry.date}</time>
          {move != null ? <div className="earnings-chart-track" aria-hidden="true">
            <span className="earnings-chart-zero" />
            <span className={`earnings-chart-bar ${move < 0 ? "earnings-chart-bar--down" : "earnings-chart-bar--up"}`} style={{
              left: `${move < 0 ? 50 - Math.abs(move) / max * 50 : 50}%`,
              width: `${Math.abs(move) / max * 50}%`,
            }} />
          </div> : <span className="earnings-chart-missing" title={copy.historyMissing[missing]}>
            {copy.missingShort[missing]}<span className="sr-only"> · {copy.historyMissing[missing]}</span>
          </span>}
          <span className={`text-right font-medium tabular-nums ${move == null ? "text-muted-foreground" : ""}`}>
            {radarPercent(move ?? null, true)}
          </span>
          <span className="sr-only">{entry.period} · {copy.timing[entry.timing]}</span>
        </li>;
      })}
      {implied != null && <li className="earnings-chart-row earnings-chart-implied">
        <span className="leading-4 text-amber-700 dark:text-amber-400">{copy.implied}</span>
        <div className="earnings-chart-track" aria-hidden="true">
          <span className="earnings-chart-bar bg-amber-500/75" style={{ left: `${50 - implied / max * 50}%`, width: `${implied / max * 100}%` }} />
          <span className="earnings-chart-zero" />
        </div>
        <span className="text-right font-medium tabular-nums">±{radarPercent(implied)}</span>
      </li>}
    </ul>
    {hasMoves && <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-[10px] text-muted-foreground" aria-hidden="true">
      <span className="flex items-center gap-1.5"><i className="earnings-chart-bar--down size-1.5 rounded-full" />{copy.negative}</span>
      <span className="flex items-center gap-1.5"><i className="earnings-chart-bar--up size-1.5 rounded-full" />{copy.positive}</span>
    </div>}
  </section>;
}
