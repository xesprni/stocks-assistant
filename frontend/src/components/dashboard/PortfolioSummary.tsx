import { useErrorToast } from "@/components/common/Toast";
import { formatNumeric, formatPercent, marketLabel, rateTone, signedChange, toneClass } from "@/components/dashboard/model";
import { FinanceSection, InlineState } from "@/components/dashboard/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTemplate, getMessages, i18n, type AppLanguage } from "@/i18n";
import { cn } from "@/lib/utils";
import type {
  DashboardPortfolioMarket,
  DashboardPortfolioModule
} from "@/types/app";
import {
  ArrowRight,
  BriefcaseBusiness,
  Loader2
} from "lucide-react";

export function PortfolioSummary({
  error,
  language,
  loading,
  module,
  onOpenPortfolio,
  subtitle,
}: {
  error: string;
  language: AppLanguage;
  loading: boolean;
  module: DashboardPortfolioModule | null | undefined;
  onOpenPortfolio: () => void;
  subtitle?: string;
}) {
  const copy = i18n[language].overview;
  const markets = module?.markets ?? [];
  const moduleError = error;
  useErrorToast(moduleError, copy.portfolioTitle);

  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenPortfolio}>{copy.viewPortfolio}<ArrowRight /></Button>}
      icon={<BriefcaseBusiness />}
      subtitle={subtitle ?? copy.portfolioSubtitle}
      title={copy.portfolioTitle}
    >
      {loading && markets.length === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingPortfolio}</InlineState>
      ) : markets.length === 0 ? (
        <InlineState>{copy.emptyPortfolio}</InlineState>
      ) : (
        <div className="space-y-4">
          <div className="grid divide-y divide-border/55 border-y border-border/55 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {markets.map((market) => (
              <PortfolioMarketSummary key={market.market} language={language} market={market} />
            ))}
          </div>
        </div>
      )}
    </FinanceSection>
  );
}

export function PortfolioMarketSummary({ language, market }: { language: AppLanguage; market: DashboardPortfolioMarket }) {
  const copy = i18n[language].overview;
  const labels = getMessages(language).dashboard.portfolio;
  const dayTone = rateTone(market.day_change_rate || market.day_change_value);
  const pnlTone = rateTone(market.unrealized_pnl_value);
  return (
    <div className="min-w-0 px-1 py-3 sm:px-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">{marketLabel(market.market, language)}</p>
        <Badge className="border-transparent bg-muted/35 shadow-none" variant="outline">
          {formatTemplate(copy.positionsCount, { count: market.position_count })}
        </Badge>
      </div>
      <p className="text-lg font-semibold tabular-nums">{formatNumeric(market.total_assets, language)}</p>
      <div className="mt-2 grid gap-1 text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{labels.day}</span>
          <span className={cn("font-semibold tabular-nums", toneClass(dayTone))}>
            {signedChange(market.day_change_value, dayTone, language)}
            {market.day_change_rate ? ` (${formatPercent(market.day_change_rate, language)})` : ""}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{labels.pnl}</span>
          <span className={cn("font-semibold tabular-nums", toneClass(pnlTone))}>
            {signedChange(market.unrealized_pnl_value, pnlTone, language)}
            {market.unrealized_pnl_ratio ? ` (${formatPercent(market.unrealized_pnl_ratio, language)})` : ""}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>{labels.marketValue}</span>
          <span className="tabular-nums">{formatNumeric(market.market_value, language)}</span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>{labels.cash}</span>
          <span className="tabular-nums">
            {formatNumeric(market.cash_amount, language)} {market.cash_ratio ? `(${formatPercent(market.cash_ratio, language)})` : ""}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>{labels.cost}</span>
          <span className="tabular-nums">{formatNumeric(market.cost_value, language)}</span>
        </div>
      </div>
    </div>
  );
}
