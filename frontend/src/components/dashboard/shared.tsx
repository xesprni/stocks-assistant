import { MarketPulse } from "@/components/MarketPulse";
import { formatCompactNumeric, formatNumeric, formatPercent, rateTone, signedChange, toneClass, type SymbolRow } from "@/components/dashboard/model";
import { Button } from "@/components/ui/button";
import { formatTemplate, getMessages, i18n, type AppLanguage } from "@/i18n";
import { cn } from "@/lib/utils";
import type {
  QuoteItem
} from "@/types/app";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2
} from "lucide-react";
import { memo, type ReactNode } from "react";

export function FinanceSection({
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
      <div className="dashboard-section-header mb-3 flex min-w-0 items-end justify-between gap-3">
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

export function InlineState({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-2 rounded-md bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
      {icon}
      <span>{children}</span>
    </div>
  );
}

export const QuoteRow = memo(function QuoteRow({
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
  const chartLabel = formatTemplate(getMessages(language).dashboard.chartLabel, { row_symbol: row.symbol });
  const highLowLabel = getMessages(language).dashboard.highLowLabel;
  const turnoverLabel = getMessages(language).dashboard.turnoverLabel;
  const volumeLabel = getMessages(language).dashboard.volumeLabel;
  const rangeMeta = row.high || row.low ? `${highLowLabel} ${formatCompactNumeric(row.high, language)} / ${formatCompactNumeric(row.low, language)}` : "";
  const activityMeta = row.turnover
    ? `${turnoverLabel} ${formatCompactNumeric(row.turnover, language)}`
    : row.volume
      ? `${volumeLabel} ${formatCompactNumeric(row.volume, language)}`
      : "";
  const meta = [rangeMeta, activityMeta].filter(Boolean).join(" · ");
  return (
    <div
      className="dashboard-quote-row group grid w-full min-w-0 select-none grid-cols-[minmax(0,1fr)_auto] items-center gap-1 transition-colors"
      data-selected={selected ? "true" : undefined}
    >
      <button
        aria-pressed={selected}
        className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 pl-3 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
        onClick={() => onSelect?.(row.symbol)}
        type="button"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold tracking-tight">{row.symbol}</p>
            {row.category ? <span className="shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground/75">{row.category}</span> : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.name || "-"}</p>
          {meta ? <p className="mt-1 truncate text-[10px] text-muted-foreground/75">{meta}</p> : null}
        </div>
        <div className="self-start pt-0.5 text-right">
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
          className="mr-1 h-8 w-7 shrink-0 text-muted-foreground/60 hover:text-primary group-hover:text-muted-foreground focus-visible:text-primary"
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
});

export function MarketPill({ language, quote }: { language: AppLanguage; quote: QuoteItem }) {
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

export function SignalDeck({ className, language }: { className?: string; language: AppLanguage }) {
  const copy = i18n[language].overview;
  return (
    <FinanceSection className={className} icon={<Activity />} subtitle={copy.signalDeckSubtitle} title={copy.signalDeck}>
      <MarketPulse />
    </FinanceSection>
  );
}

export function PermissionHidden({ children }: { children: ReactNode }) {
  return (
    <FinanceSection title={String(children)}>
      <InlineState>{children}</InlineState>
    </FinanceSection>
  );
}
