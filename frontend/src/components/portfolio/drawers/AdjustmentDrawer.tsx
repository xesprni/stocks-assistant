import { Field } from "@/components/common/Field";
import { SideDrawer } from "@/components/common/SideDrawer";
import {
  formatMoney
} from "@/components/portfolio/model";
import { formatPlain, formatSignedMoney, percentTone } from "@/components/portfolio/page-model";
import { QuoteMetric } from "@/components/portfolio/QuoteMetric";
import type { PortfolioPageState } from "@/components/portfolio/usePortfolioPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = Pick<PortfolioPageState, "sellingItem" | "copy" | "closeSellSheet" | "common" | "isSaving" | "sellSaveDisabled" | "handleSellItem" | "sensitiveValue" | "setSellDraft" | "sellInvalid" | "sellDraft" | "sellPreview" | "hideSensitive">;

export function AdjustmentDrawer({
    sellingItem, copy, closeSellSheet, common, isSaving,
    sellSaveDisabled, handleSellItem, sensitiveValue, setSellDraft, sellInvalid,
    sellDraft, sellPreview, hideSensitive,
  }: Props) {
  return (<SideDrawer
    open={Boolean(sellingItem)}
    title={copy.sellHolding}
    subtitle={sellingItem ? `${sellingItem.symbol} · ${copy.localOnly}` : copy.sellHolding}
    onClose={closeSellSheet}
    cancelText={common.cancel}
    formId="portfolio-sell-form"
    isSaving={isSaving}
    saveDisabled={sellSaveDisabled}
    saveText={copy.sell}
  >
    <form id="portfolio-sell-form" className="space-y-4" onSubmit={handleSellItem}>
      <div className="flex items-center justify-between rounded-lg bg-muted/35 px-3 py-2 text-xs"><span>{copy.currentShares}: {sensitiveValue(formatPlain(sellingItem?.shares))}</span><Button type="button" size="sm" variant="ghost" onClick={() => setSellDraft((current) => ({ ...current, shares: sellingItem?.shares ?? "" }))}>{copy.sellAll}</Button></div>
      {sellInvalid ? <p role="alert" className="text-xs text-destructive">{copy.sellInvalid}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={copy.sellShares}>
          <Input
            inputMode="decimal"
            value={sellDraft.shares}
            onChange={(event) => setSellDraft((current) => ({ ...current, shares: event.target.value }))}
            placeholder={formatPlain(sellingItem?.shares)}
          />
        </Field>
        <Field label={copy.sellPrice}>
          <Input
            inputMode="decimal"
            value={sellDraft.price}
            onChange={(event) => setSellDraft((current) => ({ ...current, price: event.target.value }))}
            placeholder={formatPlain(sellingItem?.current_price ?? sellingItem?.cost_price)}
          />
        </Field>
      </div>
      <Field label={copy.note}>
        <Input
          value={sellDraft.note}
          onChange={(event) => setSellDraft((current) => ({ ...current, note: event.target.value }))}
          placeholder={copy.notePlaceholder}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <QuoteMetric label={copy.currentShares} value={sensitiveValue(formatPlain(sellingItem?.shares))} />
        <QuoteMetric label={copy.currentPrice} value={sensitiveValue(formatMoney(sellingItem?.current_price))} />
        <QuoteMetric label={copy.transactionAmount} value={sensitiveValue(sellPreview.amount == null ? "-" : formatMoney(sellPreview.amount))} />
        <QuoteMetric
          label={copy.realizedPnl}
          tone={percentTone(sellPreview.realizedPnl)}
          value={hideSensitive ? "***" : sellPreview.realizedPnl == null ? "-" : formatSignedMoney(sellPreview.realizedPnl)}
        />
      </div>
    </form>
  </SideDrawer>);
}
