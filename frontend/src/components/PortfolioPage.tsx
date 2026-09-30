import { formatTemplate } from "@/i18n";
import { Field } from "@/components/common/Field";
import { AdjustmentDrawer } from "@/components/portfolio/drawers/AdjustmentDrawer";
import { CashDrawer } from "@/components/portfolio/drawers/CashDrawer";
import { HoldingDetail } from "@/components/portfolio/drawers/HoldingDetail";
import { HoldingEditor } from "@/components/portfolio/drawers/HoldingEditor";
import { SellDrawer } from "@/components/portfolio/drawers/SellDrawer";
import {
  formatMoney,
  holdingPnl,
  parseNumber
} from "@/components/portfolio/model";
import {
  formatDateTime,
  formatPlain,
  formatSignedMoney,
  formatSignedPercent,
  numericTone,
  type PortfolioSortKey,
  type PortfolioViewMode,
} from "@/components/portfolio/page-model";
import { PortfolioPieChart, PortfolioPnlChart, PortfolioTrendChart } from "@/components/portfolio/PortfolioCharts";
import { SortablePortfolioHeader } from "@/components/portfolio/SortablePortfolioHeader";
import { usePortfolioPage, type PortfolioPageProps } from "@/components/portfolio/usePortfolioPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowDownUp,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  CircleDollarSign,
  Eye,
  EyeOff,
  FileText,
  History,
  Loader2,
  Pencil,
  PieChart,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
} from "lucide-react";

export function PortfolioPage(props: PortfolioPageProps) {
  const {
    language, onOpenFinancials, portfolioMarkets, market, switchMarket,
    copy, viewMode, setViewMode, isLoading, currentMarket,
    setCapitalDraft, totalCapital, setShowCashSheet, resetForm, setShowForm,
    autoRefresh, setAutoRefresh, countdown, handleManualRefresh, isAutoRefreshing,
    hideToggleLabel, hideSensitive, setHideSensitive, lastUpdated, sensitiveValue,
    totalAssets, valuationComplete, portfolioStats, items, cashRatio,
    capitalDraft, handleSaveCapital, isSavingCapital, common, loadTransactions,
    isLoadingTransactions, showCashSheet, handleSaveCapitalSheet, adjustingItem, closeAdjustmentSheet,
    isSaving, adjustmentSaveDisabled, handleSaveAdjustment, adjustmentDraft, setAdjustmentDraft,
    adjustmentErrorText, adjustmentPreview, sellingItem, closeSellSheet, sellSaveDisabled,
    handleSellItem, setSellDraft, sellInvalid, sellDraft, sellPreview,
    showForm, editingItem, form, handleSaveItem, query,
    setQuery, handleSearch, isSearching, setForm, setSelectedQuote,
    results, selectSearchResult, preview, detailItem, setDetailItemId,
    editItem, adjustItem, sellItem, trendRange, setTrendRange,
    trendPoints, holdingSegments, assetSegments, filterQuery, setFilterQuery,
    pnlFilter, setPnlFilter, sortState, setSortState, sortedItems,
    handleDelete, toggleSort, transactions,
  } = usePortfolioPage(props);

  function renderMarketSwitcher() {
    return (
      <div className="inline-flex w-fit shrink-0 items-center rounded-xl border border-border/60 bg-muted/35 p-1">
        {portfolioMarkets.map((item) => (
          <button
            aria-pressed={market === item.id}
            className={cn(
              "h-8 min-w-[3.25rem] rounded-lg px-2 text-xs font-medium transition-colors sm:min-w-[4.25rem] sm:px-2.5",
              market === item.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            key={item.id}
            onClick={() => switchMarket(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  function renderViewSwitcher() {
    const views: Array<{ id: PortfolioViewMode; label: string; icon: typeof BriefcaseBusiness }> = [
      { id: "overview", label: copy.overview, icon: BriefcaseBusiness },
      { id: "chart", label: copy.charts, icon: BarChart3 },
      { id: "manage", label: copy.manage, icon: Settings2 },
    ];
    return (
      <div className="inline-flex w-fit shrink-0 items-center rounded-xl border border-border/60 bg-muted/35 p-1">
        {views.map(({ id, label, icon: Icon }) => (
          <button
            aria-label={label}
            aria-pressed={viewMode === id}
            className={cn(
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
              viewMode === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            key={id}
            onClick={() => setViewMode(id)}
            title={label}
            type="button"
          >
            <Icon className="size-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    );
  }

  const emptyState = (
    <div className="finance-soft-state grid min-h-56 place-items-center rounded-lg border border-dashed border-border/80 bg-muted/15 px-4 text-center text-sm text-muted-foreground">
      {isLoading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : (
        <div>
          <BriefcaseBusiness className="mx-auto mb-3 size-8" />
          <p className="font-medium text-foreground">{copy.emptyTitle}</p>
          <p className="mt-1 text-xs">{formatTemplate(copy.emptyHint, { market: currentMarket.label })}</p>
        </div>
      )}
    </div>
  );

  return (
    <section className="panel motion-panel page-enter finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 pb-4 pt-2">
        <div><h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1><p className="mt-1 text-xs text-muted-foreground">{copy.subtitle}</p></div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { setCapitalDraft(totalCapital); setShowCashSheet(true); }}><CircleDollarSign />{copy.saveCash}</Button>
          <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}><Plus />{copy.addHolding}</Button>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 pb-3 md:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {renderMarketSwitcher()}
          {renderViewSwitcher()}
        </div>
        <div className="ml-auto flex flex-none flex-nowrap items-center gap-1.5 md:gap-2">
          <label className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-muted/25 px-1.5 text-xs text-muted-foreground sm:gap-2 sm:px-2">
            <Switch aria-label={copy.realtimeRefresh} checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <span className="hidden whitespace-nowrap sm:inline">{copy.realtimeRefresh}</span>
          </label>
          <Button
            aria-label={copy.manualRefresh}
            title={autoRefresh ? formatTemplate(copy.refreshCountdown, { seconds: countdown }) : copy.manualRefresh}
            size={autoRefresh ? "sm" : "icon"}
            variant="outline"
            onClick={handleManualRefresh}
            disabled={isLoading || isAutoRefreshing}
            className={cn(
              "h-7 shrink-0",
              autoRefresh
                ? "min-w-[3.5rem] gap-1 px-1.5 font-mono text-xs tabular-nums sm:min-w-[4.25rem] sm:gap-1.5 sm:px-2"
                : "w-7",
            )}
          >
            <RefreshCw className={cn((isLoading || isAutoRefreshing) && "animate-spin")} />
            {autoRefresh ? <span>{countdown}s</span> : null}
          </Button>
          <Button
            aria-label={hideToggleLabel}
            aria-pressed={hideSensitive}
            title={hideToggleLabel}
            size="icon"
            variant="outline"
            className="h-7 w-7 shrink-0"
            onClick={() => setHideSensitive((current) => !current)}
          >
            {hideSensitive ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </div>

      <div className="panel-body flex min-h-0 flex-1 flex-col gap-4 lg:overflow-y-auto">
        <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="col-span-2 rounded-xl border border-primary/15 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-4 xl:col-span-1">
            <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">{copy.totalAssets}</p><span className="text-[10px] font-medium text-primary">{currentMarket.hint}</span></div>
            <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{isLoading && !lastUpdated ? "—" : sensitiveValue(formatMoney(totalAssets))}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className={cn("size-1.5 rounded-full", valuationComplete ? "bg-primary" : "bg-amber-500")} />{valuationComplete ? copy.liveValuation : copy.costEstimate}</p>
          </div>
          <div className="rounded-xl border border-border/65 bg-card/60 p-4">
            <p className="text-xs text-muted-foreground">{copy.marketValue}</p><p className="mt-2 text-xl font-semibold tabular-nums">{sensitiveValue(formatMoney(portfolioStats.marketValue))}</p>
            <p className="mt-2 text-[10px] text-muted-foreground">{items.length} {copy.holdingUnit} · {copy.cashRatio} {formatPlain(cashRatio)}</p>
          </div>
          <div className="rounded-xl border border-border/65 bg-card/60 p-4">
            <p className="text-xs text-muted-foreground">{copy.totalPnl}{portfolioStats.missingPnlCount > 0 ? <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">{copy.partial}</span> : null}</p>
            <p className={cn("mt-2 text-xl font-semibold tabular-nums", !hideSensitive && numericTone(portfolioStats.pnl))}>{sensitiveValue(formatSignedMoney(portfolioStats.pnl))}</p>
            <p className={cn("mt-2 text-[10px] tabular-nums", numericTone(portfolioStats.pnlRatio))}>{formatSignedPercent(portfolioStats.pnlRatio)}</p>
          </div>
          <div className="rounded-xl border border-border/65 bg-card/60 p-4">
            <p className="text-xs text-muted-foreground">{copy.dayPnl}{portfolioStats.dayMissingCount > 0 ? <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">{copy.partial}</span> : null}</p>
            <p className={cn("mt-2 text-xl font-semibold tabular-nums", !hideSensitive && numericTone(portfolioStats.dayPnl))}>{sensitiveValue(formatSignedMoney(portfolioStats.dayPnl))}</p>
            <p className="mt-2 text-[10px] tabular-nums text-muted-foreground">{copy.cash}: {sensitiveValue(formatMoney(totalCapital))}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>{copy.localOnly}</span>{lastUpdated ? <span>{formatTemplate(copy.updatedAt, { time: lastUpdated })} · Longbridge</span> : null}</div>
        {!valuationComplete ? <div role="status" className="flex shrink-0 items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs leading-5 text-amber-700 dark:text-amber-300"><AlertCircle className="mt-0.5 size-4 shrink-0" />{copy.valuationHint}</div> : null}

        {viewMode === "manage" ? (
          <div className="finance-module rounded-lg border border-border/80 bg-background/45 p-3">
            <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_auto_auto_auto] md:items-end">
              <Field label={copy.cash}>
                <Input
                  className="font-mono"
                  inputMode="decimal"
                  value={capitalDraft}
                  onChange={(event) => setCapitalDraft(event.target.value)}
                  placeholder={copy.cash}
                />
              </Field>
              <Button size="sm" variant="outline" onClick={handleSaveCapital} disabled={isSavingCapital}>
                {isSavingCapital ? <Loader2 className="animate-spin" /> : <Save />}
                {copy.saveCash}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                }}
              >
                <Plus />
                {common.add}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void loadTransactions()} disabled={isLoadingTransactions}>
                {isLoadingTransactions ? <Loader2 className="animate-spin" /> : <History />}
                {copy.tradeHistory}
              </Button>
            </div>
          </div>
        ) : null}

        <CashDrawer showCashSheet={showCashSheet} copy={copy} currentMarket={currentMarket} setShowCashSheet={setShowCashSheet} common={common} isSavingCapital={isSavingCapital} handleSaveCapitalSheet={handleSaveCapitalSheet} capitalDraft={capitalDraft} setCapitalDraft={setCapitalDraft} sensitiveValue={sensitiveValue} totalAssets={totalAssets} cashRatio={cashRatio} />

        <HoldingEditor adjustingItem={adjustingItem} copy={copy} closeAdjustmentSheet={closeAdjustmentSheet} common={common} isSaving={isSaving} adjustmentSaveDisabled={adjustmentSaveDisabled} handleSaveAdjustment={handleSaveAdjustment} adjustmentDraft={adjustmentDraft} setAdjustmentDraft={setAdjustmentDraft} adjustmentErrorText={adjustmentErrorText} sensitiveValue={sensitiveValue} adjustmentPreview={adjustmentPreview} />

        <AdjustmentDrawer sellingItem={sellingItem} copy={copy} closeSellSheet={closeSellSheet} common={common} isSaving={isSaving} sellSaveDisabled={sellSaveDisabled} handleSellItem={handleSellItem} sensitiveValue={sensitiveValue} setSellDraft={setSellDraft} sellInvalid={sellInvalid} sellDraft={sellDraft} sellPreview={sellPreview} hideSensitive={hideSensitive} />

        <SellDrawer showForm={showForm} editingItem={editingItem} copy={copy} resetForm={resetForm} setShowForm={setShowForm} common={common} isSaving={isSaving} form={form} handleSaveItem={handleSaveItem} query={query} setQuery={setQuery} handleSearch={handleSearch} currentMarket={currentMarket} isSearching={isSearching} setForm={setForm} setSelectedQuote={setSelectedQuote} results={results} selectSearchResult={selectSearchResult} sensitiveValue={sensitiveValue} preview={preview} />

        <HoldingDetail detailItem={detailItem} copy={copy} setDetailItemId={setDetailItemId} currentMarket={currentMarket} sensitiveValue={sensitiveValue} hideSensitive={hideSensitive} onOpenFinancials={onOpenFinancials} editItem={editItem} language={language} adjustItem={adjustItem} sellItem={sellItem} />

        {viewMode === "chart" ? (
          <div className="grid shrink-0 auto-rows-max gap-4 pb-4">
            <div className="min-w-0 rounded-xl border border-border/65 bg-card/60 p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="size-4 text-primary" />
                  {copy.assetTrend}
                </div>
                <div className="inline-flex h-7 items-center rounded-md border border-border bg-muted/30 p-0.5">
                  {([
                    ["day", copy.trendDay],
                    ["week", copy.trendWeek],
                    ["month", copy.trendMonth],
                  ] as const).map(([range, label]) => (
                    <button
                      key={range}
                      type="button"
                      aria-pressed={trendRange === range}
                      className={cn(
                        "h-6 rounded-sm px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        trendRange === range ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setTrendRange(range)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <PortfolioTrendChart hideSensitive={hideSensitive} points={trendPoints} language={language} currency={currentMarket.hint} />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-border/65 bg-card/60 p-4 sm:p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <PieChart className="size-4 text-primary" />
                  {copy.holdingDistribution}
                </div>
                <PortfolioPieChart emptyLabel={copy.emptyTitle} hideSensitive={hideSensitive} segments={holdingSegments} language={language} currency={currentMarket.hint} onSelect={(symbol) => setDetailItemId(items.find((item) => item.symbol === symbol)?.id ?? null)} />
              </div>
              <div className="min-w-0 rounded-xl border border-border/65 bg-card/60 p-4 sm:p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <CircleDollarSign className="size-4 text-primary" />
                  {copy.assetAllocation}
                </div>
                <PortfolioPieChart emptyLabel={copy.emptyTitle} hideSensitive={hideSensitive} segments={assetSegments} language={language} currency={currentMarket.hint} />
              </div>
            </div>
            <div className="rounded-xl border border-border/65 bg-card/60 p-4 sm:p-5"><PortfolioPnlChart items={items} hideSensitive={hideSensitive} language={language} currency={currentMarket.hint} onSelect={(item) => setDetailItemId(item.id)} /></div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label={copy.filterPlaceholder} className="h-9 pl-9" placeholder={copy.filterPlaceholder} value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} /></div>
              <div className="flex rounded-lg bg-muted/40 p-1">{([["all", copy.all], ["gain", copy.gains], ["loss", copy.losses]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={pnlFilter === value} className={cn("rounded-md px-2.5 py-1.5 text-xs", pnlFilter === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground")} onClick={() => setPnlFilter(value)}>{label}</button>)}</div>
              <div className="ml-auto flex items-center gap-1"><label className="sr-only" htmlFor="portfolio-sort">{copy.viewSorted}</label><select id="portfolio-sort" className="h-9 max-w-36 rounded-lg border border-border/70 bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary" value={sortState.key} onChange={(event) => setSortState((current) => ({ ...current, key: event.target.value as PortfolioSortKey }))}>{([["symbol", copy.stockCode], ["stock_value", copy.stockValue], ["pnl_ratio", copy.pnlRatio], ["change_rate", copy.dayChange], ["position_ratio", copy.assetRatio], ["pe_ttm_ratio", copy.pe], ["cost_price", copy.costPrice], ["current_price", copy.currentPrice], ["note", copy.note]] as const).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><Button size="icon" variant="outline" className="size-9" aria-label={sortState.direction === "asc" ? copy.sortDesc : copy.sortAsc} onClick={() => setSortState((current) => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))}><ArrowDownUp className="size-3.5" /></Button></div>
              <span className="text-[10px] tabular-nums text-muted-foreground">{sortedItems.length} / {items.length}</span>
            </div>
            {items.length > 0 && sortedItems.length === 0 ? <div className="grid min-h-36 shrink-0 place-content-center gap-3 rounded-xl border border-dashed border-border text-center"><p className="text-sm text-muted-foreground">{copy.noFiltered}</p><Button size="sm" variant="ghost" onClick={() => { setFilterQuery(""); setPnlFilter("all"); }}>{copy.clearFilters}</Button></div> : null}
            {items.length === 0 ? (
              <div className="lg:hidden">{emptyState}</div>
            ) : (
              <div className="grid gap-1.5 lg:hidden">
                {sortedItems.map((item) => (
                  <article key={item.id} className="portfolio-list-row rounded-xl border border-border/65 bg-card/60 p-3">
                    <div
                      className={cn(
                        "grid items-center gap-2",
                        viewMode === "manage"
                          ? "grid-cols-[minmax(72px,1fr)_minmax(60px,0.65fr)_minmax(65px,0.7fr)]"
                          : "grid-cols-[minmax(72px,1fr)_minmax(60px,0.65fr)_minmax(65px,0.7fr)]",
                      )}
                    >
                      <div className="min-w-0">
                        <button type="button" className="inline-flex max-w-full items-center gap-1 text-sm font-semibold leading-5 text-primary hover:underline" aria-label={`${item.symbol} · ${copy.openDetail}`} onClick={() => setDetailItemId(item.id)}><span className="truncate">{item.symbol}</span><ArrowUpRight className="size-3 shrink-0" /></button>
                        <p className="truncate text-[11px] leading-4 text-muted-foreground">{item.name || item.note || "-"}</p>
                      </div>
                      <div className="min-w-0 text-right">
                        <p className="truncate text-[10px] text-muted-foreground">{copy.currentPrice}</p>
                        <p className="truncate text-xs font-semibold tabular-nums">{sensitiveValue(formatMoney(item.current_price))}</p>
                        <p className={cn("truncate text-[11px] tabular-nums", numericTone(item.change_rate))}>{formatPlain(item.change_rate)}</p>
                      </div>
                      <div className="min-w-0 text-right">
                        <p className="truncate text-[10px] text-muted-foreground">{copy.assetRatio}</p>
                        <p className="truncate text-xs font-semibold tabular-nums">{formatPlain(item.position_ratio)}</p>
                        <p className={cn("truncate text-[11px] tabular-nums", numericTone(item.pnl_ratio))}>{formatPlain(item.pnl_ratio)}</p>
                      </div>
                      {viewMode === "manage" ? (
                        <div className="col-span-3 flex justify-end gap-1 border-t border-border/50 pt-2">
                          <Button aria-label={copy.financials} size="icon" variant="ghost" className="h-7 w-7" title={copy.financials} onClick={() => onOpenFinancials(item.symbol)}>
                            <FileText />
                          </Button>
                          <Button aria-label={copy.adjustHolding} size="icon" variant="ghost" className="h-7 w-7" title={copy.adjustHolding} onClick={() => adjustItem(item)}>
                            <SlidersHorizontal />
                          </Button>
                          <Button aria-label={copy.edit} size="icon" variant="ghost" className="h-7 w-7" title={copy.edit} onClick={() => editItem(item)}>
                            <Pencil />
                          </Button>
                          <Button aria-label={copy.sellHolding} size="icon" variant="ghost" className="h-7 w-7" title={copy.sellHolding} onClick={() => sellItem(item)}>
                            <CircleDollarSign />
                          </Button>
                          <Button aria-label={copy.delete} size="icon" variant="ghost" className="h-7 w-7" title={copy.delete} onClick={() => handleDelete(item)}>
                            <Trash2 />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                      <span className="truncate">{copy.stockValue}: <span className="text-foreground tabular-nums">{sensitiveValue(formatMoney(item.stock_value))}</span></span>
                      <span className="truncate">{copy.costPrice}: <span className="text-foreground tabular-nums">{sensitiveValue(formatMoney(item.cost_price))}</span></span>
                      <span className="truncate">{copy.pe}: <span className="text-foreground tabular-nums">{formatPlain(item.pe_ttm_ratio)}</span></span>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="hidden min-h-52 shrink-0 overflow-auto rounded-xl border border-border/65 bg-card/60 lg:block">
              <table className={cn("w-full border-collapse text-sm", viewMode === "manage" ? "min-w-[1160px]" : "min-w-[980px]")}>
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border/80 text-left text-xs text-muted-foreground">
                    <SortablePortfolioHeader label={copy.stockCode} sortKey="symbol" sortState={sortState} onSort={toggleSort} />
                    <SortablePortfolioHeader label={copy.pe} sortKey="pe_ttm_ratio" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.costPrice} sortKey="cost_price" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.currentPrice} sortKey="current_price" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.stockValue} sortKey="stock_value" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.assetRatio} sortKey="position_ratio" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.pnlRatio} sortKey="pnl_ratio" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.dayChange} sortKey="change_rate" sortState={sortState} onSort={toggleSort} align="right" />
                    <SortablePortfolioHeader label={copy.note} sortKey="note" sortState={sortState} onSort={toggleSort} />
                    {viewMode === "manage" ? <th className="px-3 py-2 text-right font-medium">{copy.actions}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item) => (
                    <tr key={item.id} className="portfolio-table-row border-b border-border/60">
                      <td className="px-3 py-2">
                        <div className="min-w-0">
                          <button type="button" className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline" onClick={() => setDetailItemId(item.id)} aria-label={`${item.symbol} · ${copy.openDetail}`}>{item.symbol}<ArrowUpRight className="size-3" /></button>
                          <p className="max-w-[180px] truncate text-xs text-muted-foreground">{item.name || "-"}</p>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPlain(item.pe_ttm_ratio)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sensitiveValue(formatMoney(item.cost_price))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sensitiveValue(formatMoney(item.current_price))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{sensitiveValue(formatMoney(item.stock_value))}{item.valuation_price_source !== "live" ? <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">{item.valuation_price_source === "cost" ? copy.estimated : "—"}</p> : null}</td>
                      <td className="px-3 py-3 text-right tabular-nums"><span>{formatPlain(item.position_ratio)}</span><div className="ml-auto mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-muted/60"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, Math.max(0, parseNumber(item.position_ratio) ?? 0))}%` }} /></div></td>
                      <td className={cn("px-3 py-3 text-right tabular-nums", numericTone(item.pnl_ratio))}>{formatPlain(item.pnl_ratio)}<p className="mt-0.5 text-[10px]">{sensitiveValue(formatSignedMoney(holdingPnl(item)))}</p></td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", numericTone(item.change_rate))}>{formatPlain(item.change_rate)}</td>
                      <td className="max-w-[240px] truncate px-3 py-2 text-xs text-muted-foreground">{item.note || "-"}</td>
                      {viewMode === "manage" ? (
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button aria-label={copy.financials} size="icon" variant="ghost" className="h-7 w-7" title={copy.financials} onClick={() => onOpenFinancials(item.symbol)}>
                              <FileText />
                            </Button>
                            <Button aria-label={copy.adjustHolding} size="icon" variant="ghost" className="h-7 w-7" title={copy.adjustHolding} onClick={() => adjustItem(item)}>
                              <SlidersHorizontal />
                            </Button>
                            <Button aria-label={copy.edit} size="icon" variant="ghost" className="h-7 w-7" title={copy.edit} onClick={() => editItem(item)}>
                              <Pencil />
                            </Button>
                            <Button aria-label={copy.sellHolding} size="icon" variant="ghost" className="h-7 w-7" title={copy.sellHolding} onClick={() => sellItem(item)}>
                              <CircleDollarSign />
                            </Button>
                            <Button aria-label={copy.delete} size="icon" variant="ghost" className="h-7 w-7" title={copy.delete} onClick={() => handleDelete(item)}>
                              <Trash2 />
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>

              {items.length === 0 ? (
                emptyState
              ) : null}
            </div>

            {viewMode === "manage" ? (
              <div className="shrink-0 overflow-hidden rounded-xl border border-border/65 bg-card/60">
                <div className="flex items-center justify-between border-b border-border/70 px-3 py-2 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2">
                    <History className="size-4 text-primary" />
                    {copy.tradeHistory}
                  </span>
                  {isLoadingTransactions ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
                </div>
                {transactions.length === 0 ? (
                  <div className="px-3 py-5 text-center text-xs text-muted-foreground">{copy.noTransactions}</div>
                ) : (
                  <div className="max-h-52 overflow-auto">
                    <table className="w-full min-w-[720px] border-collapse text-xs">
                      <thead className="sticky top-0 bg-card text-muted-foreground">
                        <tr className="border-b border-border/70 text-left">
                          <th className="px-3 py-2 font-medium">{copy.transactionTime}</th>
                          <th className="px-3 py-2 font-medium">{copy.stockCode}</th>
                          <th className="px-3 py-2 font-medium">{copy.transactionSide}</th>
                          <th className="px-3 py-2 text-right font-medium">{copy.shares}</th>
                          <th className="px-3 py-2 text-right font-medium">{copy.sellPrice}</th>
                          <th className="px-3 py-2 text-right font-medium">{copy.transactionAmount}</th>
                          <th className="px-3 py-2 text-right font-medium">{copy.realizedPnl}</th>
                          <th className="px-3 py-2 font-medium">{copy.note}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((transaction) => (
                          <tr key={transaction.id} className="border-b border-border/60">
                            <td className="px-3 py-2 text-muted-foreground">{formatDateTime(transaction.created_at, language)}</td>
                            <td className="px-3 py-2 font-medium">{transaction.symbol}</td>
                            <td className="px-3 py-2">{transaction.side === "sell" ? copy.sell : transaction.side === "buy" ? copy.buy : copy.adjust}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{sensitiveValue(formatPlain(transaction.shares))}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{sensitiveValue(formatMoney(transaction.price))}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{sensitiveValue(formatMoney(transaction.amount))}</td>
                            <td className={cn("px-3 py-2 text-right font-mono tabular-nums", numericTone(transaction.realized_pnl))}>
                              {hideSensitive ? "***" : formatSignedMoney(transaction.realized_pnl)}
                            </td>
                            <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">{transaction.note || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
