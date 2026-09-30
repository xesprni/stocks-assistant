import { SideDrawer } from "@/components/common/SideDrawer";
import {
  formatMoney,
  holdingPnl,
  parseNumber
} from "@/components/portfolio/model";
import { formatPlain, formatSignedMoney, numericTone, percentTone } from "@/components/portfolio/page-model";
import { QuoteMetric } from "@/components/portfolio/QuoteMetric";
import type { PortfolioPageState } from "@/components/portfolio/usePortfolioPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  CircleDollarSign,
  FileText,
  Pencil,
  SlidersHorizontal
} from "lucide-react";

type Props = Pick<PortfolioPageState, "detailItem" | "copy" | "setDetailItemId" | "currentMarket" | "sensitiveValue" | "hideSensitive" | "onOpenFinancials" | "editItem" | "language" | "adjustItem" | "sellItem">;

export function HoldingDetail({ detailItem, copy, setDetailItemId, currentMarket, sensitiveValue, hideSensitive, onOpenFinancials, editItem, language, adjustItem, sellItem }: Props) {
  return (<SideDrawer open={Boolean(detailItem)} title={detailItem?.symbol ?? copy.detail} subtitle={detailItem?.name || copy.detail} onClose={() => setDetailItemId(null)} panelClassName="lg:max-w-[560px]">
    {detailItem ? <div className="space-y-5">
      <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/10 to-background p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{copy.currentPrice} · {detailItem.currency || currentMarket.hint}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{sensitiveValue(formatMoney(detailItem.current_price))}</p><p className={cn("mt-1 text-sm font-medium tabular-nums", numericTone(detailItem.change_rate))}>{sensitiveValue(formatSignedMoney(detailItem.change_value))} ({formatPlain(detailItem.change_rate)})</p></div><Badge variant="outline">{detailItem.valuation_price_source === "live" ? copy.liveValuation : detailItem.valuation_price_source === "cost" ? copy.costSource : copy.unavailableSource}</Badge></div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <QuoteMetric label={copy.shares} value={sensitiveValue(formatMoney(detailItem.shares))} />
        <QuoteMetric label={copy.stockValue} value={sensitiveValue(formatMoney(detailItem.stock_value))} />
        <QuoteMetric label={copy.costPrice} value={sensitiveValue(formatMoney(detailItem.cost_price))} />
        <QuoteMetric label={copy.totalPnl} value={sensitiveValue(formatSignedMoney(holdingPnl(detailItem)))} tone={hideSensitive ? undefined : percentTone(holdingPnl(detailItem))} />
        <QuoteMetric label={copy.pnlRatio} value={formatPlain(detailItem.pnl_ratio)} tone={percentTone(detailItem.pnl_ratio)} />
        <QuoteMetric label={copy.assetRatio} value={formatPlain(detailItem.position_ratio)} />
        <QuoteMetric label={copy.pe} value={formatPlain(detailItem.pe_ttm_ratio)} />
        <QuoteMetric label={copy.source} value={detailItem.valuation_price_source === "live" ? "Longbridge" : detailItem.valuation_price_source === "cost" ? copy.costSource : copy.unavailableSource} />
      </div>
      <div className="rounded-xl border border-border/60 p-4"><h3 className="text-xs font-medium">{copy.priceComparison}</h3><div className="mt-4 space-y-4">{[[copy.costPrice, detailItem.cost_price], [copy.currentPrice, detailItem.current_price]].map(([label, value]) => {
        const number = parseNumber(value);
        const maximum = Math.max(parseNumber(detailItem.cost_price) ?? 0, parseNumber(detailItem.current_price) ?? 0, 1);
        return <div key={label}><div className="mb-1.5 flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{sensitiveValue(formatMoney(value))}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted/50"><div className={cn("h-full rounded-full", label === copy.costPrice ? "bg-muted-foreground/45" : "bg-primary")} style={{ width: `${number == null ? 0 : Math.max(0, number) / maximum * 100}%` }} /></div></div>;
      })}</div></div>
      <div><h3 className="mb-2 flex items-center gap-2 text-xs font-medium"><FileText className="size-3.5" />{copy.note}</h3><p className="whitespace-pre-wrap break-words rounded-xl bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">{detailItem.note || copy.noNote}</p></div>
      <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" onClick={() => { setDetailItemId(null); onOpenFinancials(detailItem.symbol); }}><FileText />{copy.financials}</Button></div>
      <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-4"><Button size="sm" variant="outline" onClick={() => { setDetailItemId(null); editItem(detailItem); }}><Pencil />{getMessages(language).portfolio.edit}</Button><Button size="sm" variant="outline" onClick={() => { setDetailItemId(null); adjustItem(detailItem); }}><SlidersHorizontal />{copy.adjust}</Button><Button size="sm" variant="outline" onClick={() => { setDetailItemId(null); sellItem(detailItem); }}><CircleDollarSign />{copy.sell}</Button></div>
      <p className="text-[11px] leading-5 text-muted-foreground">{copy.localOnly}</p>
    </div> : null}
  </SideDrawer>);
}
