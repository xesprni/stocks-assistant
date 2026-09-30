import { CapitalFlowChart } from "@/components/CapitalFlowChart";
import { IntradayCharts } from "@/components/charts/IntradayCharts";
import { KLineChart } from "@/components/charts/KLineChart";
import { SymbolSideNav } from "@/components/charts/SymbolSideNav";
import { TECHNICAL_ACTIVE_TAB_STORAGE_KEY } from "@/components/charts/technical-data";
import { DEFAULT_MA_PERIODS, MA_PERIODS, MA_SELECTION_STORAGE_KEY, OVERLAY_INDICATORS, SUB_INDICATORS, technicalCopy, type IndicatorKey, type MAPeriod, type Props } from "@/components/charts/technical-settings";
import { useIsDark } from "@/components/charts/useNativeChartTheme";
import { readStoredValue, writeStoredValue } from "@/lib/local-storage";
import { BarChart2 } from "lucide-react";
import {
  useEffect,
  useState
} from "react";

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TechnicalAnalysis({ language, symbol, onSymbolChange, onBack, embedded = false }: Props) {
  const copy = technicalCopy[language];
  const isDark = useIsDark();
  const [displayName, setDisplayName] = useState("");
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorKey>>(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem("stocks-assistant.chart-indicators") ?? "null");
      const allowed = [...SUB_INDICATORS, ...OVERLAY_INDICATORS].map((item) => item.key);
      if (Array.isArray(stored)) return new Set(stored.filter((key): key is IndicatorKey => allowed.includes(key)));
    } catch { /* 存储不可用时保留默认均线。 */ }
    return new Set(["MA"]);
  });
  const [activeMAPeriods, setActiveMAPeriods] = useState<Set<MAPeriod>>(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(MA_SELECTION_STORAGE_KEY) ?? "null");
      if (Array.isArray(stored)) return new Set(MA_PERIODS.filter((period) => stored.includes(period)));
    } catch { /* 存储不可用时显示默认均线组合。 */ }
    return new Set(DEFAULT_MA_PERIODS);
  });
  const [activeTab, setActiveTab] = useState<"kline" | "intraday" | "capital">(() =>
    readStoredValue(TECHNICAL_ACTIVE_TAB_STORAGE_KEY, ["kline", "intraday", "capital"], "kline"),
  );

  useEffect(() => {
    if (!displayName && symbol) setDisplayName(symbol);
  }, [symbol, displayName]);

  useEffect(() => {
    writeStoredValue(TECHNICAL_ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    writeStoredValue("stocks-assistant.chart-indicators", JSON.stringify([...activeIndicators]));
  }, [activeIndicators]);

  useEffect(() => {
    writeStoredValue(MA_SELECTION_STORAGE_KEY, JSON.stringify([...activeMAPeriods]));
  }, [activeMAPeriods]);

  function toggleMA(period: MAPeriod) {
    // 总开关关闭时，点击单条均线只打开该线，避免意外恢复整个组合。
    if (!activeIndicators.has("MA")) {
      setActiveIndicators((previous) => new Set([...previous, "MA"]));
      setActiveMAPeriods(new Set([period]));
      return;
    }
    setActiveMAPeriods((previous) => {
      const next = new Set(previous);
      if (next.has(period)) next.delete(period);
      else next.add(period);
      return next;
    });
  }

  function toggleIndicator(key: IndicatorKey) {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }


  return (
    <div className="technical-analysis-root flex min-h-0 flex-col bg-background text-foreground lg:h-full lg:overflow-hidden">
      {/* ── Header ── */}
      {!embedded ? (
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card/90 px-4 py-2 backdrop-blur">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
            <BarChart2 size={14} className="text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">
              {displayName || symbol || copy.title}
            </div>
            {symbol && displayName && displayName !== symbol && (
              <div className="text-[10px] leading-tight text-muted-foreground">{symbol}</div>
            )}
          </div>
        </header>
      ) : null}

      {/* ── Body ── */}
      <div className={`technical-analysis-body flex min-h-0 flex-1 flex-col lg:overflow-hidden ${embedded ? "" : "md:flex-row"}`}>
        {/* Sidebar */}
        {!embedded ? (
          <SymbolSideNav
            active={symbol}
            copy={copy}
            language={language}
            onSelect={(s, name) => {
              setDisplayName(name);
              onSymbolChange(s);
            }}
          />
        ) : null}

        {/* Main content */}
        <div className="technical-main-content flex min-h-0 flex-1 flex-col lg:overflow-hidden">
          {/* Tab switch: 分时 / K线 */}
          <div className="technical-tab-bar flex shrink-0 items-center gap-2 border-b border-border bg-background px-3">
            <div className="flex h-9 items-center gap-1 border-b border-border/70">
              <button
                onClick={() => setActiveTab("kline")}
                className={`h-9 border-b-2 px-3 text-[11px] font-medium transition-colors ${activeTab === "kline"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
              >
                {copy.kline}
              </button>
              <button
                onClick={() => setActiveTab("intraday")}
                className={`h-9 border-b-2 px-3 text-[11px] font-medium transition-colors ${activeTab === "intraday"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
              >
                {copy.intraday}
              </button>
              <button
                onClick={() => setActiveTab("capital")}
                className={`h-9 border-b-2 px-3 text-[11px] font-medium transition-colors ${activeTab === "capital"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
              >
                {copy.capitalFlow}
              </button>
            </div>
          </div>

          {activeTab === "kline" ? (
            <div className="technical-kline-layout flex min-h-[640px] flex-1 flex-col lg:min-h-0 lg:flex-row lg:overflow-hidden">
              {/* Left: indicator selector + chart */}
              <div className="technical-chart-column flex min-h-0 flex-1 flex-col lg:overflow-hidden">
                {/* Indicator selector (above chart) */}
                <div className="technical-indicator-bar flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-background px-3 py-2">
                  <span className="mr-0.5 text-[10px] font-medium text-muted-foreground">{copy.subIndicators}</span>
                  {SUB_INDICATORS.map(({ key, label, color }) => (
                    <button
                      key={key}
                      aria-pressed={activeIndicators.has(key)}
                      title={label}
                      onClick={() => toggleIndicator(key)}
                      className={`inline-flex h-7 shrink-0 items-center gap-1.5 border-b-2 px-1 text-[11px] font-medium transition-colors ${activeIndicators.has(key)
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      {label}
                    </button>
                  ))}
                  <div className="mx-1.5 h-3 w-px bg-border" />
                  <span className="text-[10px] font-medium text-muted-foreground">{copy.overlays}</span>
                  {OVERLAY_INDICATORS.map(({ key, label, color }) => (
                    <button
                      key={key}
                      aria-pressed={activeIndicators.has(key)}
                      title={label}
                      onClick={() => toggleIndicator(key)}
                      className={`inline-flex h-7 shrink-0 items-center gap-1.5 border-b-2 px-1 text-[11px] font-medium transition-colors ${activeIndicators.has(key)
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      {label}
                    </button>
                  ))}


                </div>

                {/* Chart area (flex-1 fills remaining space) */}
                <KLineChart
                  symbol={symbol}
                  activeIndicators={activeIndicators}
                  activeMAPeriods={activeMAPeriods}
                  onToggleMA={toggleMA}
                  copy={copy}
                  language={language}
                  isDark={isDark}
                />
              </div>

            </div>
          ) : activeTab === "intraday" ? (
            /* Intraday mode */
            <IntradayCharts
              symbol={symbol}
              copy={copy}
              language={language}
              isDark={isDark}
            />
          ) : (
            <CapitalFlowChart
              chartClassName="technical-capital-flow-chart"
              className="flex min-h-[440px] flex-1 lg:min-h-0"
              language={language}
              symbol={symbol}
            />
          )}
        </div>
      </div>
    </div>
  );
}
