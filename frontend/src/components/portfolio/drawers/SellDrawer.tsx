import { Field } from "@/components/common/Field";
import { SideDrawer } from "@/components/common/SideDrawer";
import {
  formatMoney
} from "@/components/portfolio/model";
import { formatPercent, formatSignedPercent, percentTone } from "@/components/portfolio/page-model";
import { QuoteMetric } from "@/components/portfolio/QuoteMetric";
import type { PortfolioPageState } from "@/components/portfolio/usePortfolioPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Search
} from "lucide-react";

type Props = Pick<PortfolioPageState, "showForm" | "editingItem" | "copy" | "resetForm" | "setShowForm" | "common" | "isSaving" | "form" | "handleSaveItem" | "query" | "setQuery" | "handleSearch" | "currentMarket" | "isSearching" | "setForm" | "setSelectedQuote" | "results" | "selectSearchResult" | "sensitiveValue" | "preview">;

export function SellDrawer({
    showForm, editingItem, copy, resetForm, setShowForm,
    common, isSaving, form, handleSaveItem, query,
    setQuery, handleSearch, currentMarket, isSearching, setForm,
    setSelectedQuote, results, selectSearchResult, sensitiveValue, preview,
  }: Props) {
  return (<SideDrawer
    open={showForm}
    title={editingItem ? copy.editHolding : copy.addHolding}
    subtitle={copy.formHint}
    onClose={() => {
      resetForm();
      setShowForm(false);
    }}
    cancelText={common.cancel}
    formId="portfolio-item-form"
    isSaving={isSaving}
    saveDisabled={!form.symbol.trim()}
    saveText={common.save}
  >
    <form id="portfolio-item-form" className="space-y-4" onSubmit={handleSaveItem}>
      <div className="grid gap-3">
        <Field label={copy.searchCode}>
          <div className="flex gap-2">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleSearch(event); }} placeholder={currentMarket.placeholder} />
            <Button size="sm" variant="outline" type="button" aria-label={copy.searchCode} disabled={isSearching || !(query || form.symbol).trim()} onClick={handleSearch}>{isSearching ? <Loader2 className="animate-spin" /> : <Search />}</Button>
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy.stockCode}><Input className="uppercase" value={form.symbol} onChange={(event) => { setForm((current) => ({ ...current, symbol: event.target.value })); setSelectedQuote(null); }} placeholder={currentMarket.placeholder} /></Field>
          <Field label={copy.name}><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={copy.optional} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={copy.shares}>
            <Input
              inputMode="decimal"
              value={form.shares ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, shares: event.target.value }))}
              placeholder={copy.optional}
            />
          </Field>
          <Field label={copy.costPrice}>
            <Input
              inputMode="decimal"
              value={form.cost_price ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, cost_price: event.target.value }))}
              placeholder={copy.optional}
            />
          </Field>
        </div>
      </div>

      {results.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {results.map((result) => (
            <button
              key={result.symbol}
              type="button"
              className="rounded-md bg-muted/20 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/45 hover:text-foreground"
              onClick={() => selectSearchResult(result)}
            >
              <span className="font-semibold">{result.symbol}</span>
              <span className="ml-2 text-muted-foreground">{result.name || "-"}</span>
              {result.last_done ? <span className="ml-2 tabular-nums">{sensitiveValue(formatMoney(result.last_done))}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <Field label={copy.note}>
        <Input
          value={form.note}
          onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          placeholder={copy.notePlaceholder}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <QuoteMetric label={copy.currentPrice} value={sensitiveValue(preview.current != null ? formatMoney(preview.current) : "-")} />
        <QuoteMetric label={copy.stockValue} value={sensitiveValue(preview.stockValue != null ? formatMoney(preview.stockValue) : "-")} />
        <QuoteMetric label={copy.assetRatio} value={preview.positionRatio != null ? formatPercent(preview.positionRatio) : "-"} />
        <QuoteMetric label={copy.pnl} tone={percentTone(preview.pnlRatio)} value={preview.pnlRatio != null ? formatSignedPercent(preview.pnlRatio) : "-"} />
      </div>
    </form>
  </SideDrawer>);
}
