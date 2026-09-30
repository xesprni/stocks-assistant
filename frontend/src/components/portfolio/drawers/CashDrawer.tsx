import { Field } from "@/components/common/Field";
import { SideDrawer } from "@/components/common/SideDrawer";
import {
  formatMoney
} from "@/components/portfolio/model";
import { formatPlain } from "@/components/portfolio/page-model";
import { QuoteMetric } from "@/components/portfolio/QuoteMetric";
import type { PortfolioPageState } from "@/components/portfolio/usePortfolioPage";
import { Input } from "@/components/ui/input";

type Props = Pick<PortfolioPageState, "showCashSheet" | "copy" | "currentMarket" | "setShowCashSheet" | "common" | "isSavingCapital" | "handleSaveCapitalSheet" | "capitalDraft" | "setCapitalDraft" | "sensitiveValue" | "totalAssets" | "cashRatio">;

export function CashDrawer({
    showCashSheet, copy, currentMarket, setShowCashSheet, common,
    isSavingCapital, handleSaveCapitalSheet, capitalDraft, setCapitalDraft, sensitiveValue,
    totalAssets, cashRatio,
  }: Props) {
  return (<SideDrawer
    open={showCashSheet}
    title={copy.cash}
    subtitle={`${currentMarket.hint} · ${copy.cashHint}`}
    onClose={() => setShowCashSheet(false)}
    cancelText={common.cancel}
    formId="portfolio-cash-form"
    isSaving={isSavingCapital}
    saveText={common.save}
  >
    <form id="portfolio-cash-form" className="space-y-4" onSubmit={handleSaveCapitalSheet}>
      <Field label={copy.cash}>
        <Input
          className="font-mono"
          inputMode="decimal"
          value={capitalDraft}
          onChange={(event) => setCapitalDraft(event.target.value)}
          placeholder={copy.cash}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <QuoteMetric label={copy.totalAssets} value={sensitiveValue(formatMoney(totalAssets))} />
        <QuoteMetric label={copy.cashRatio} value={formatPlain(cashRatio)} />
      </div>
    </form>
  </SideDrawer>);
}
