import { getMessages } from "@/i18n";
import { BarChart3, BookOpen, BriefcaseBusiness, Building2, Loader2, ScrollText } from "lucide-react";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { FinancialReportsPage } from "@/components/FinancialReportsPage";
import TechnicalAnalysis from "@/components/TechnicalAnalysis";
import { Button } from "@/components/ui/button";
import type { AppLanguage } from "@/i18n";
import { listPortfolio } from "@/lib/api";
import { CompanyPositionController } from "@/lib/company-position-controller";
import { NewsPage } from "@/pages/NewsPage";

export type CompanyTab = "chart" | "financials" | "news" | "position";

const tabs = [
  { id: "chart", icon: BarChart3 },
  { id: "financials", icon: ScrollText },
  { id: "news", icon: BookOpen },
  { id: "position", icon: BriefcaseBusiness },
] as const;

export function CompanyWorkspacePage({ language, onNavigateTab, onOpenPortfolio, onSymbolChange, symbol, tab }: {
  language: AppLanguage;
  onNavigateTab: (tab: CompanyTab) => void;
  onOpenPortfolio: () => void;
  onSymbolChange: (symbol: string) => void;
  symbol: string;
  tab: CompanyTab;
}) {
  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar flex items-center gap-2">
        <Building2 className="size-5 text-primary" />
        <h1 className="text-base font-semibold">{symbol}</h1>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border/70 px-3 py-2">
        {tabs.map(({ id, icon: Icon }) => (
          <Button key={id} onClick={() => onNavigateTab(id)} size="sm" variant={tab === id ? "secondary" : "ghost"}>
            <Icon />{getMessages(language).company.tabs[id]}
          </Button>
        ))}
      </div>
      <div className="panel-body flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-y-auto">
        {tab === "chart" ? <TechnicalAnalysis embedded language={language} onSymbolChange={onSymbolChange} symbol={symbol} /> : null}
        {tab === "financials" ? <FinancialReportsPage key={symbol} initialSymbol={symbol} language={language} /> : null}
        {tab === "news" ? <NewsPage key={symbol} initialSymbol={symbol} language={language} /> : null}
        {tab === "position" ? <PositionTab key={symbol} language={language} onOpenPortfolio={onOpenPortfolio} symbol={symbol} /> : null}
      </div>
    </section>
  );
}

function PositionTab({ language, onOpenPortfolio, symbol }: { language: AppLanguage; onOpenPortfolio: () => void; symbol: string }) {
  const controller = useMemo(() => new CompanyPositionController(listPortfolio), []);
  const { position, loading, error } = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => { controller.activate(symbol); return () => controller.dispose(); }, [controller, symbol]);

  return (
    <div className="max-w-2xl rounded-md border border-border/80 bg-background/60 p-4">
      <h2 className="font-semibold">{symbol} · {getMessages(language).company.position}</h2>
      {loading ? <Loader2 className="mt-3 size-5 animate-spin" /> : error ? <p className="mt-3 text-sm text-destructive">{error}</p> : position ? (
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            [getMessages(language).company.market, position.market],
            [getMessages(language).company.shares, position.shares],
            [getMessages(language).company.cost, position.cost_price],
          ].map(([label, value]) => <div className="rounded-md border border-border/70 bg-muted/15 p-2" key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{value ?? "—"}</dd></div>)}
        </dl>
      ) : <p className="mt-3 text-sm text-muted-foreground">{getMessages(language).company.noPosition}</p>}
      <Button className="mt-4" onClick={onOpenPortfolio} variant="outline"><BriefcaseBusiness />{getMessages(language).company.openPortfolio}</Button>
    </div>
  );
}
