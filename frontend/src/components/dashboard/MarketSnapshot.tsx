import { useErrorToast } from "@/components/common/Toast";
import { FinanceSection, InlineState, MarketPill } from "@/components/dashboard/shared";
import { Button } from "@/components/ui/button";
import { i18n, type AppLanguage } from "@/i18n";
import type {
  QuoteItem
} from "@/types/app";
import {
  BarChart2,
  Loader2,
  Settings2
} from "lucide-react";

export function MarketSnapshot({
  error,
  indices,
  language,
  loading,
  onOpenMarketConfig,
  subtitle,
}: {
  error: string;
  indices: QuoteItem[];
  language: AppLanguage;
  loading: boolean;
  onOpenMarketConfig: () => void;
  subtitle?: string;
}) {
  const copy = i18n[language].overview;
  useErrorToast(error, copy.marketSnapshot);
  return (
    <FinanceSection
      action={<Button size="sm" variant="ghost" onClick={onOpenMarketConfig}>{copy.config}<Settings2 /></Button>}
      icon={<BarChart2 />}
      subtitle={subtitle ?? copy.marketSnapshotSubtitle}
      title={copy.marketSnapshot}
    >
      {loading && indices.length === 0 ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{copy.loadingMarket}</InlineState>
      ) : indices.length === 0 ? (
        <InlineState>{copy.emptyMarket}</InlineState>
      ) : (
        <div className="space-y-2">
          <div className="finance-index-strip -mx-2 flex overflow-x-auto sm:mx-0">
            {indices.map((quote) => (
              <MarketPill language={language} key={quote.symbol} quote={quote} />
            ))}
          </div>
        </div>
      )}
    </FinanceSection>
  );
}
