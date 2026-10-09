import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { formatTemplate, getMessages, localizedSymbolName, type AppLanguage } from "@/i18n";
import { RADAR_MAX_SYMBOLS, type EarningsRadarController } from "@/lib/earnings-radar-controller";
import { matchesCompany } from "@/lib/watchlist-view";
import type { WatchlistItem } from "@/types/app";

export function EarningsWatchlistDialog({ language, controller, items, loading, error, initialSymbols, onClose, onConfirm }: {
  language: AppLanguage;
  controller: EarningsRadarController;
  items: WatchlistItem[];
  loading: boolean;
  error: string;
  initialSymbols: string[];
  onClose: () => void;
  onConfirm: (symbols: string[]) => void;
}) {
  const copy = getMessages(language).earnings;
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState(initialSymbols);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogFocus(true, panelRef, onClose, searchRef);
  useEffect(() => {
    void controller.loadWatchlist();
    return () => controller.cancelWatchlist();
  }, [controller]);

  // 选中草稿仅在确认时交给页面；搜索不清除隐藏勾选，刷新后剔除已移除的自选股。
  const options = [...new Map(items.map((item) => [item.symbol, item])).values()];
  const selected = options.filter((item) => selection.includes(item.symbol)).map((item) => item.symbol);
  const visible = options.filter((item) => matchesCompany(item, query));
  const visibleSelection = [...new Set([...selected, ...visible.map((item) => item.symbol)])];
  const overLimit = selected.length > RADAR_MAX_SYMBOLS;
  const busy = loading || Boolean(error);

  return createPortal(
    <div className="apple-dialog-layer fixed inset-0 z-[1100] flex items-center justify-center p-4" data-state="open">
      <div className="apple-dialog-backdrop absolute inset-0" aria-hidden="true" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}
        className="apple-dialog-surface apple-material-thick relative flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-[1.375rem] border border-border/60 shadow-2xl">
        <header className="shrink-0 space-y-3 border-b border-border p-4">
          <div className="flex items-center justify-between gap-3"><h2 id={titleId} className="font-semibold">{copy.selectWatchlist}</h2><Button type="button" variant="ghost" size="icon" aria-label={copy.closeImport} onClick={onClose}><X /></Button></div>
          <p id={descriptionId} className="text-xs leading-5 text-muted-foreground">{copy.selectionHint}</p>
          <Input ref={searchRef} aria-label={copy.watchlistSearch} placeholder={copy.watchlistSearchHint} value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={busy || !visible.length || visibleSelection.length > RADAR_MAX_SYMBOLS} onClick={() => setSelection(visibleSelection)}>{copy.selectVisible}</Button><Button type="button" variant="ghost" size="sm" disabled={busy || !selected.length} onClick={() => setSelection([])}>{copy.clearSelection}</Button></div>
            <span role="status" className="text-xs tabular-nums text-muted-foreground">{formatTemplate(copy.selectionCount, { count: selected.length, max: RADAR_MAX_SYMBOLS })}</span>
          </div>
          {(overLimit || visibleSelection.length > RADAR_MAX_SYMBOLS) && <p className="text-xs text-muted-foreground">{formatTemplate(copy.selectionLimit, { max: RADAR_MAX_SYMBOLS })}</p>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {loading ? <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{copy.loadingWatchlist}</p>
            : error ? <div role="alert" className="space-y-3 py-6 text-sm"><p>{error}</p><Button type="button" variant="outline" onClick={() => void controller.loadWatchlist()}>{copy.retryWatchlist}</Button></div>
            : visible.length ? <div className="divide-y divide-border/60">{visible.map((item) => {
              const checked = selected.includes(item.symbol);
              return <label className="flex min-h-14 cursor-pointer items-center gap-3 py-3 has-[:disabled]:cursor-default has-[:disabled]:opacity-50" key={item.symbol}>
                <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={checked} disabled={!checked && selected.length >= RADAR_MAX_SYMBOLS}
                  onChange={(event) => setSelection(event.target.checked ? [...selected, item.symbol] : selected.filter((symbol) => symbol !== item.symbol))} />
                <span className="min-w-0"><span className="block text-sm font-medium">{item.symbol}</span><span className="block truncate text-xs text-muted-foreground">{localizedSymbolName(item, language)}</span></span>
              </label>;
            })}</div> : <p className="py-10 text-center text-sm text-muted-foreground">{items.length ? copy.noWatchlistMatch : copy.emptyWatchlist}</p>}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="outline" onClick={onClose}>{copy.cancelImport}</Button>
          <Button type="button" disabled={busy || !selected.length || overLimit} onClick={() => onConfirm(selected)}>{copy.confirmImport}</Button>
        </footer>
      </div>
    </div>, document.body,
  );
}
