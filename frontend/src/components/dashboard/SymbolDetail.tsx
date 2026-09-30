import { CapitalFlowChart } from "@/components/CapitalFlowChart";
import { formatCompactNumeric, formatNumeric, formatPercent, rateTone, signedChange, toneClass, type Tone } from "@/components/dashboard/model";
import { FinanceSection } from "@/components/dashboard/shared";
import { WatchlistSymbolChart } from "@/components/dashboard/SymbolChart";
import { SymbolInsightsPanel } from "@/components/dashboard/SymbolInsights";
import { Button } from "@/components/ui/button";
import { getMessages, i18n, type AppLanguage } from "@/i18n";
import {
  getDashboardSymbolInsights
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  DashboardSymbolInsightsResponse,
  DashboardWatchlistRow
} from "@/types/app";
import {
  ArrowLeft,
  BarChart2,
  Building2
} from "lucide-react";
import { useEffect, useState } from "react";

export function SymbolDetailMetric({ label, tone, value }: { label: string; tone?: Tone; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/25 px-3 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-sm font-semibold tabular-nums", tone ? toneClass(tone) : undefined)}>{value}</p>
    </div>
  );
}

export function WatchlistSymbolDetail({
  canFundamentals,
  language,
  onBack,
  onOpenChart,
  row,
}: {
  canFundamentals: boolean;
  language: AppLanguage;
  onBack: () => void;
  onOpenChart?: (symbol: string) => void;
  row: DashboardWatchlistRow;
}) {
  const copy = i18n[language].overview;
  const tone = rateTone(row.change_rate || row.change_value);
  const labels = getMessages(language).dashboard.quote;
  const insightFallbackError = getMessages(language).dashboard.insightFallbackError;
  const [insights, setInsights] = useState<DashboardSymbolInsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");

  useEffect(() => {
    setInsights(null);
    setInsightsError("");
    if (!canFundamentals) {
      setInsightsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setInsightsLoading(true);
    getDashboardSymbolInsights(row.symbol, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setInsights(payload);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setInsightsError(caught instanceof Error ? caught.message : insightFallbackError);
      })
      .finally(() => {
        if (!controller.signal.aborted) setInsightsLoading(false);
      });

    return () => controller.abort();
  }, [canFundamentals, insightFallbackError, language, row.symbol]);

  return (
    <FinanceSection
      action={
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft />
          {copy.backToDashboard}
        </Button>
      }
      icon={<Building2 />}
      subtitle={row.name || copy.companyProfile}
      title={row.symbol}
    >
      <div className="space-y-4">
        <WatchlistSymbolChart language={language} row={row} />
        <CapitalFlowChart
          chartClassName="h-[220px]"
          className="min-h-[318px] rounded-md border border-border/65 bg-card/70"
          language={language}
          symbol={row.symbol}
        />

        <div className="rounded-md border-y border-border/55 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{row.name || copy.companyProfile}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{formatNumeric(row.last_done, language, 3)}</p>
            </div>
            <div className={cn("text-right font-semibold tabular-nums", toneClass(tone))}>
              <p className="text-base">{signedChange(row.change_value, tone, language)}</p>
              <p className="text-sm">{formatPercent(row.change_rate, language)}</p>
            </div>
          </div>
          {onOpenChart ? (
            <Button className="mt-4" size="sm" variant="outline" onClick={() => onOpenChart(row.symbol)}>
              <BarChart2 />
              {labels.openChart}
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <SymbolDetailMetric label={labels.price} value={formatNumeric(row.last_done, language, 3)} />
          <SymbolDetailMetric label={labels.change} tone={tone} value={signedChange(row.change_value, tone, language)} />
          <SymbolDetailMetric label={labels.rate} tone={tone} value={formatPercent(row.change_rate, language)} />
          <SymbolDetailMetric label={labels.open} value={formatNumeric(row.open, language, 3)} />
          <SymbolDetailMetric label={labels.previousClose} value={formatNumeric(row.prev_close, language, 3)} />
          <SymbolDetailMetric label={labels.high} value={formatNumeric(row.high, language, 3)} />
          <SymbolDetailMetric label={labels.low} value={formatNumeric(row.low, language, 3)} />
          <SymbolDetailMetric label={labels.volume} value={formatCompactNumeric(row.volume, language)} />
          <SymbolDetailMetric label={labels.turnover} value={formatCompactNumeric(row.turnover, language)} />
        </div>

        <SymbolInsightsPanel
          canFundamentals={canFundamentals}
          error={insightsError}
          insights={insights}
          language={language}
          loading={insightsLoading}
        />
      </div>
    </FinanceSection>
  );
}
