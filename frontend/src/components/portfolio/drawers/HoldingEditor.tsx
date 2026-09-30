import { Field } from "@/components/common/Field";
import { SideDrawer } from "@/components/common/SideDrawer";
import {
  formatMoney
} from "@/components/portfolio/model";
import { formatDraftDecimal, formatPlain } from "@/components/portfolio/page-model";
import { QuoteMetric } from "@/components/portfolio/QuoteMetric";
import type { PortfolioPageState } from "@/components/portfolio/usePortfolioPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = Pick<PortfolioPageState, "adjustingItem" | "copy" | "closeAdjustmentSheet" | "common" | "isSaving" | "adjustmentSaveDisabled" | "handleSaveAdjustment" | "adjustmentDraft" | "setAdjustmentDraft" | "adjustmentErrorText" | "sensitiveValue" | "adjustmentPreview">;

export function HoldingEditor({
    adjustingItem, copy, closeAdjustmentSheet, common, isSaving,
    adjustmentSaveDisabled, handleSaveAdjustment, adjustmentDraft, setAdjustmentDraft, adjustmentErrorText,
    sensitiveValue, adjustmentPreview,
  }: Props) {
  return (<SideDrawer
    open={Boolean(adjustingItem)}
    title={copy.adjustHolding}
    subtitle={adjustingItem ? `${adjustingItem.symbol} · ${copy.adjustHint}` : copy.adjustHint}
    onClose={closeAdjustmentSheet}
    cancelText={common.cancel}
    formId="portfolio-adjustment-form"
    isSaving={isSaving}
    saveDisabled={adjustmentSaveDisabled}
    saveText={common.save}
  >
    <form id="portfolio-adjustment-form" className="space-y-4" onSubmit={handleSaveAdjustment}>
      <Field label={copy.adjustMode}>
        <div className="grid grid-cols-3 gap-2">
          {([
            ["increase", copy.adjustIncrease],
            ["decrease", copy.adjustDecrease],
            ["set", copy.adjustSet],
          ] as const).map(([mode, label]) => (
            <Button
              key={mode}
              size="sm"
              type="button"
              variant={adjustmentDraft.mode === mode ? "default" : "outline"}
              onClick={() => setAdjustmentDraft((current) => ({ ...current, mode }))}
            >
              {label}
            </Button>
          ))}
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={copy.adjustShares}>
          <Input
            inputMode="decimal"
            value={adjustmentDraft.shares}
            onChange={(event) => setAdjustmentDraft((current) => ({ ...current, shares: event.target.value }))}
            placeholder={copy.optional}
          />
        </Field>
        <Field label={copy.adjustPrice}>
          <Input
            inputMode="decimal"
            value={adjustmentDraft.price}
            onChange={(event) => setAdjustmentDraft((current) => ({ ...current, price: event.target.value }))}
            placeholder={formatPlain(adjustingItem?.current_price ?? adjustingItem?.cost_price)}
          />
        </Field>
      </div>

      {adjustmentErrorText ? (
        <div className="finance-soft-state rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {adjustmentErrorText}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <QuoteMetric label={copy.currentShares} value={sensitiveValue(formatPlain(adjustmentPreview.currentShares))} />
        <QuoteMetric label={copy.adjustedShares} value={adjustmentPreview.nextShares == null ? "-" : formatPlain(formatDraftDecimal(adjustmentPreview.nextShares))} />
        <QuoteMetric label={copy.adjustedCost} value={sensitiveValue(adjustmentPreview.nextCost == null ? "-" : formatMoney(adjustmentPreview.nextCost))} />
        <QuoteMetric label={copy.currentPrice} value={sensitiveValue(formatMoney(adjustingItem?.current_price))} />
      </div>
    </form>
  </SideDrawer>);
}
