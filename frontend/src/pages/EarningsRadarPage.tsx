import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Loader2, Radar, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EarningsWatchlistDialog } from "@/components/earnings/EarningsWatchlistDialog";
import { EarningsRadarCard } from "@/components/earnings/EarningsRadarCard";
import { getMessages, formatTemplate, localeFor, type AppLanguage } from "@/i18n";
import { listWatchlist, scanEarningsRadar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EarningsRadarController, parseRadarSymbols, RADAR_DEFAULT_DAYS, RADAR_MAX_SYMBOLS, RADAR_WINDOWS } from "@/lib/earnings-radar-controller";
import { downloadRadar } from "@/lib/earnings-radar-export";

export function EarningsRadarPage({ language, onOpenConfig }: { language: AppLanguage; onOpenConfig: () => void }) {
  const copy = getMessages(language).earnings;
  const auth = useAuth();
  const [controller] = useState(() => new EarningsRadarController(scanEarningsRadar, listWatchlist));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [symbols, setSymbols] = useState("");
  const [days, setDays] = useState(RADAR_DEFAULT_DAYS);
  const [message, setMessage] = useState("");
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  useEffect(() => () => controller.dispose(), [controller]);
  const report = state.result;
  const items = report?.items ?? [];
  return <section className="panel page-enter flex min-w-0 flex-1 flex-col gap-5 rounded-md p-4 lg:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-semibold"><Radar className="size-6 text-primary" />{copy.title}</h1><p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p></div>
      {report && <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => downloadRadar(report, language)}><Download />{copy.html}</Button></div>}
    </header>
    <form className="rounded-lg border border-border bg-card p-4" onSubmit={(event) => {
      event.preventDefault();
      const parsed = parseRadarSymbols(symbols);
      if (!parsed.length || parsed.length > RADAR_MAX_SYMBOLS || parsed.some((symbol) => !/^[A-Z][A-Z0-9.-]*\.US$/.test(symbol) || symbol.length > 24)) { setMessage(copy.invalid); return; }
      setMessage(""); void controller.run({ symbols: parsed, days_ahead: days });
    }}>
      <div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="radar-symbols" className="text-sm font-medium">{copy.symbols}</label>{auth.can("watchlist:read") && <Button type="button" variant="ghost" size="sm" disabled={state.importing || state.loading} onClick={() => setWatchlistOpen(true)}><Star />{copy.importWatchlist}</Button>}</div>
      <Textarea id="radar-symbols" className="min-h-16" value={symbols} disabled={state.loading || state.importing} onChange={(event) => setSymbols(event.target.value)} placeholder={copy.placeholder} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{formatTemplate(copy.limit, { max: RADAR_MAX_SYMBOLS })}</p><div className="flex flex-wrap items-center gap-3"><label htmlFor="radar-window" className="text-xs text-muted-foreground">{copy.window}</label><select id="radar-window" className="rounded-md border border-border bg-background px-2 py-2 text-sm" value={days} disabled={state.loading} onChange={(event) => setDays(Number(event.target.value))}>{RADAR_WINDOWS.map((value) => <option value={value} key={value}>{formatTemplate(copy.days, { days: value })}</option>)}</select><Button type="submit" disabled={state.loading || state.importing || !symbols.trim()}><Search />{copy.scan}</Button></div></div>
    </form>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {state.error && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm"><p>{state.error}</p>{auth.can("config:read") && <Button className="mt-2" variant="outline" size="sm" onClick={onOpenConfig}>{getMessages(language).ui.nav.config[0]}</Button>}</div>}
    {state.loading && <div role="status" className="rounded-lg border border-border p-8 text-center"><Loader2 className="mx-auto mb-3 size-6 animate-spin text-primary" /><p>{copy.scanning}</p><p className="mt-2 text-xs text-muted-foreground">{copy.loadingHint}</p><Button type="button" variant="ghost" className="mt-3" onClick={() => controller.cancel()}>{copy.cancel}</Button></div>}
    {!report && !state.loading && !state.error && <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center"><Radar className="mx-auto mb-3 size-10 text-muted-foreground" /><h2 className="font-medium">{copy.empty}</h2><p className="mt-2 text-sm text-muted-foreground">{copy.emptyHint}</p></div>}
    {report && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[[copy.count, items.length], [copy.upcoming, items.filter((item) => item.next_event).length], [copy.priced, items.filter((item) => item.ratio != null).length], [copy.partial, items.filter((item) => item.status !== "ready").length]].map(([label, value]) => <div className="rounded-lg border border-border bg-card p-3" key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>)}</div>
      <p className="text-xs text-muted-foreground">{report.window_start} → {report.window_end} · {report.timezone}<br />{copy.source}: {report.source} · {copy.asOf}: {new Date(report.as_of).toLocaleString(localeFor(language))}</p>
      <div className="grid items-start gap-4 xl:grid-cols-2">{items.map((item) => <EarningsRadarCard key={item.symbol} item={item} language={language} />)}</div>
    </>}
    {watchlistOpen && <EarningsWatchlistDialog language={language} controller={controller}
      items={state.watchlistItems} loading={state.importing} error={state.watchlistError}
      initialSymbols={parseRadarSymbols(symbols)} onClose={() => setWatchlistOpen(false)}
      onConfirm={(selected) => { setSymbols(selected.join(", ")); setMessage(""); setWatchlistOpen(false); }} />}
  </section>;
}
