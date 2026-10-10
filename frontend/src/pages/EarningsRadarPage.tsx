import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { Activity, CalendarDays, ChartNoAxesColumn, ChevronDown, CircleAlert, Download, Info, Loader2, Radar, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EarningsSymbolInput } from "@/components/earnings/EarningsSymbolInput";
import { EarningsWatchlistDialog } from "@/components/earnings/EarningsWatchlistDialog";
import { EarningsRadarCard } from "@/components/earnings/EarningsRadarCard";
import { getMessages, formatTemplate, localeFor, type AppLanguage } from "@/i18n";
import { listWatchlist, scanEarningsRadar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EarningsRadarController, resolveRadarSelection, RADAR_DEFAULT_DAYS, RADAR_MAX_SYMBOLS, RADAR_WINDOWS } from "@/lib/earnings-radar-controller";
import { downloadRadar } from "@/lib/earnings-radar-export";

export function EarningsRadarPage({ language, onOpenConfig }: { language: AppLanguage; onOpenConfig: () => void }) {
  const copy = getMessages(language).earnings;
  const auth = useAuth();
  const [controller] = useState(() => new EarningsRadarController(scanEarningsRadar, listWatchlist));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [days, setDays] = useState(RADAR_DEFAULT_DAYS);
  const [message, setMessage] = useState("");
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  useEffect(() => () => controller.dispose(), [controller]);
  const report = state.result;
  const items = report?.items ?? [];
  const selection = resolveRadarSelection(symbols, draft);
  const parsed = selection.symbols;
  const busy = state.loading || state.importing;
  const stats = [
    { label: copy.count, value: items.length, icon: Radar },
    { label: copy.upcoming, value: items.filter((item) => item.next_event).length, icon: CalendarDays },
    { label: copy.priced, value: items.filter((item) => item.ratio != null).length, icon: Activity },
    { label: copy.partial, value: items.filter((item) => item.status !== "ready").length, icon: CircleAlert },
  ];
  function commitSymbols(value: string) {
    const next = resolveRadarSelection(symbols, value);
    if (!next.valid) { setDraft(value); setMessage(copy.invalid); return; }
    setSymbols(next.symbols);
    setDraft("");
    setMessage("");
  }
  function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 点击扫描也包含尚未按回车确认的输入，避免漏掉最后一个标的。
    if (!selection.valid) { setMessage(copy.invalid); return; }
    setSymbols(parsed);
    setDraft("");
    setMessage("");
    void controller.run({ symbols: parsed, days_ahead: days });
  }

  return <section className="earnings-page page-enter min-w-0 flex-1">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="earnings-page-icon"><Radar className="size-6" aria-hidden="true" /></div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.subtitle}</p>
        </div>
      </div>
      {report && <Button variant="outline" size="sm" onClick={() => downloadRadar(report, language)}><Download />{copy.html}</Button>}
    </header>

    <form className="earnings-scan-form" onSubmit={scan}>
      <EarningsSymbolInput language={language} symbols={symbols} draft={draft} disabled={busy} invalid={!!message} count={parsed.length}
        onDraftChange={(value) => { setDraft(value); setMessage(""); }} onCommit={commitSymbols}
        onRemove={(symbol) => { setSymbols((current) => current.filter((value) => value !== symbol)); setMessage(""); }} />
      <div className="earnings-scan-controls">
        {auth.can("watchlist:read") && <Button type="button" variant="ghost" className="earnings-watchlist-shortcut" disabled={busy}
          title={copy.importWatchlist} aria-label={copy.importWatchlist} onClick={() => setWatchlistOpen(true)}><Star /><span>{copy.watchlistShortcut}</span></Button>}
        <div className="earnings-window-control">
          <CalendarDays className="earnings-window-calendar size-3.5" aria-hidden="true" />
          <select id="radar-window" className="earnings-window" aria-label={copy.window} value={days} disabled={busy} onChange={(event) => setDays(Number(event.target.value))}>
            {RADAR_WINDOWS.map((value) => <option value={value} key={value}>{formatTemplate(copy.nextDays, { days: value })}</option>)}
          </select>
          <ChevronDown className="earnings-window-chevron size-3.5" aria-hidden="true" />
        </div>
        <Button type="submit" className="earnings-scan-button" disabled={busy || !parsed.length}>
          {state.loading ? <Loader2 className="animate-spin" /> : <Search />}{copy.scan}
        </Button>
      </div>
      <p id="radar-input-hint" className="earnings-input-hint">{formatTemplate(copy.symbolEntryHint, { max: RADAR_MAX_SYMBOLS })}</p>
      {message && <p id="radar-validation" role="status" className="col-span-full text-xs text-destructive">{message}</p>}
    </form>

    {state.error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 break-words"><p>{state.error}</p>{auth.can("config:read") && <Button className="mt-3" variant="outline" size="sm" onClick={onOpenConfig}>{getMessages(language).ui.nav.config[0]}</Button>}</div>
    </div>}
    {state.loading && <div className="earnings-empty">
      <div role="status"><Loader2 className="mx-auto mb-4 size-7 animate-spin text-primary" /><p className="text-sm font-medium">{copy.scanning}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{copy.loadingHint}</p></div>
      <Button type="button" variant="outline" size="sm" className="mt-5" onClick={() => controller.cancel()}>{copy.cancel}</Button>
    </div>}
    {!report && !state.loading && !state.error && <div className="earnings-empty">
      <h2 className="text-base font-semibold">{copy.empty}</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{copy.emptyHint}</p>
      <div className="earnings-empty-steps">
        {[
          { title: copy.calendarStep, description: copy.calendarStepHint, icon: CalendarDays },
          { title: copy.pricingStep, description: copy.pricingStepHint, icon: Activity },
          { title: copy.historyStep, description: copy.historyStepHint, icon: ChartNoAxesColumn },
        ].map(({ title, description, icon: Icon }) => <div className="min-w-0" key={title}>
          <Icon className="mx-auto mb-3 size-5 text-primary/75" aria-hidden="true" />
          <p className="text-xs font-medium">{title}</p><p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{description}</p>
        </div>)}
      </div>
    </div>}
    {report && <div className="space-y-5">
      <dl className="earnings-summary">
        {stats.map(({ label, value, icon: Icon }, index) => <div className="earnings-summary-cell" key={label}>
          <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={`size-3.5 shrink-0 ${index === 3 && value > 0 ? "text-amber-600 dark:text-amber-400" : ""}`} aria-hidden="true" />{label}</dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
        </div>)}
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{copy.results}</h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"><CalendarDays className="size-3.5" aria-hidden="true" /><span className="tabular-nums">{report.window_start} → {report.window_end}</span><span>· {report.timezone}</span></p>
      </div>
      <div className="earnings-results">{items.map((item) => <EarningsRadarCard key={item.symbol} item={item} language={language} />)}</div>
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 break-words text-[10px] leading-5 text-muted-foreground">
        <span>{copy.source}: {report.source}</span><span>{copy.asOf}: {new Date(report.as_of).toLocaleString(localeFor(language))}</span>
      </p>
    </div>}
    <details className="earnings-methodology">
      <summary className="flex items-center gap-2 text-xs text-muted-foreground"><Info className="size-3.5" aria-hidden="true" /><span className="flex-1">{copy.methodology}</span><ChevronDown className="earnings-disclosure-icon size-4" aria-hidden="true" /></summary>
      <div className="space-y-3 pb-2 pt-4 text-xs leading-6 text-muted-foreground"><p>{copy.method}</p><p>{copy.thresholds}</p><p>{copy.caveat}</p></div>
    </details>
    {watchlistOpen && <EarningsWatchlistDialog language={language} controller={controller}
      items={state.watchlistItems} loading={state.importing} error={state.watchlistError}
      initialSymbols={parsed} onClose={() => setWatchlistOpen(false)}
      onConfirm={(selected) => { setSymbols(selected); setDraft(""); setMessage(""); setWatchlistOpen(false); }} />}
  </section>;
}
