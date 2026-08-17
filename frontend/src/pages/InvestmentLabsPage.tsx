import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Building2,
  Calculator,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  FlaskConical,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

import { Field } from "@/components/common/Field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  analyzePortfolioLab,
  compareValuationPeers,
  createAlertRule,
  createValuationModel,
  getGreaterChinaContext,
  listValuationModels,
} from "@/lib/api";
import type { AppLanguage } from "@/lib/i18n";
import type { GreaterChinaContext, PeerComparisonResult, PortfolioLabResult, ValuationModel } from "@/types/app";

export type LabTab = "portfolio" | "valuation" | "greater-china";

type ScenarioPreset = "none" | "standard" | "severe" | "custom";
type ValuationType = "dcf" | "reverse_dcf" | "relative";
type TargetDraft = { symbol: string; weight: string };
type CashFlowDraft = { amount: string; currency: string; date: string };
type ValuationFields = {
  revenue: string;
  fcf_margin: string;
  revenue_growth: string;
  wacc: string;
  terminal_growth: string;
  shares_outstanding: string;
  cash: string;
  debt: string;
  years: string;
  target_price: string;
  peer_median: string;
  target_metric: string;
};

const tabLabels = {
  zh: { portfolio: "组合体检", valuation: "公司估值", "greater-china": "大中华研究" },
  en: { portfolio: "Portfolio check", valuation: "Company valuation", "greater-china": "Greater China" },
} as const;

const scenarioShocks: Record<Exclude<ScenarioPreset, "custom">, Record<string, number>> = {
  none: {},
  standard: { "market:US": -0.1, "market:A": -0.08, "market:H": -0.12 },
  severe: { "market:US": -0.2, "market:A": -0.16, "market:H": -0.2 },
};

const fxDefaults: Record<string, Record<string, string>> = {
  USD: { USD: "1", HKD: "0.1282", CNY: "0.1389" },
  HKD: { USD: "7.8", HKD: "1", CNY: "1.083" },
  CNY: { USD: "7.2", HKD: "0.923", CNY: "1" },
};

const valuationFieldLabels = {
  zh: {
    revenue: "当前收入",
    fcf_margin: "自由现金流率",
    revenue_growth: "收入增速",
    wacc: "折现率",
    terminal_growth: "永续增长率",
    shares_outstanding: "总股本",
    cash: "现金",
    debt: "有息负债",
    years: "预测年数",
    target_price: "当前市场价格",
    peer_median: "同业估值倍数",
    target_metric: "公司基准指标",
  },
  en: {
    revenue: "Current revenue",
    fcf_margin: "Free-cash-flow margin",
    revenue_growth: "Revenue growth",
    wacc: "Discount rate",
    terminal_growth: "Terminal growth",
    shares_outstanding: "Shares outstanding",
    cash: "Cash",
    debt: "Debt",
    years: "Forecast years",
    target_price: "Current market price",
    peer_median: "Peer valuation multiple",
    target_metric: "Company base metric",
  },
} as const;

const chinaTranslations: Record<string, string> = {
  "Reconcile Chinese and English company names and reporting currency.": "核对中英文公司名称及报表币种。",
  "Check latest filings, dividends and corporate actions.": "检查最新公告、分红和公司行动。",
  "Separate operating fundamentals from listing-venue and currency effects.": "区分经营基本面、上市地和汇率带来的影响。",
  "Compare HK disclosure with mainland operations and any A-share counterpart.": "对照港股披露、内地业务及对应 A 股。",
  "Review liquidity, shareholder concentration and southbound-flow sensitivity.": "关注流动性、股东集中度和南向资金敏感度。",
  "Review exchange board, trading-status and company-announcement context.": "核对上市板块、交易状态和公司公告。",
  "Compare with any H-share counterpart and sector policy exposure.": "对照对应 H 股并评估行业政策暴露。",
  "Review listing structure, audit/disclosure jurisdiction and any HK dual listing.": "核查上市架构、审计披露管辖地及港股双重上市。",
  "Reconcile ADR ratio and reporting currency before peer comparison.": "同业比较前先统一 ADR 比例和报表币种。",
  "policy and regulatory exposure": "政策与监管暴露",
  "VIE or listing structure where applicable": "VIE 或上市架构",
  "RMB/HKD/USD currency path": "人民币、港币和美元汇率路径",
  "cross-border capital flow sensitivity": "跨境资金流敏感度",
  "controlling shareholder and related-party governance": "控股股东与关联交易治理",
  "A/H/ADR price and disclosure differences where applicable": "A/H/ADR 价格与披露差异",
};

function initialQueryTab(): LabTab {
  if (typeof window === "undefined") return "portfolio";
  const value = new URLSearchParams(window.location.search).get("tab");
  return value === "valuation" || value === "greater-china" ? value : "portfolio";
}

export function InvestmentLabsPage({
  initialSymbol = "",
  initialTab,
  language,
}: {
  initialSymbol?: string;
  initialTab?: LabTab;
  language: AppLanguage;
}) {
  const [tab, setTab] = useState<LabTab>(initialTab || initialQueryTab());
  const copy = tabLabels[language];

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  function selectTab(value: LabTab) {
    setTab(value);
    if (!initialTab && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (value === "portfolio") url.searchParams.delete("tab");
      else url.searchParams.set("tab", value);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  return (
    <Tabs className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md lg:h-full" onValueChange={(value) => selectTab(value as LabTab)} value={tab}>
      <div className="page-toolbar flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <FlaskConical className="text-primary" />
            {language === "en" ? "Investment workspace" : "投资实验室"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {language === "en" ? "Pick a goal and get to an answer in a few steps." : "选一个目标，几步完成分析。专业参数需要时再展开。"}
          </p>
        </div>
        <TabsList aria-label={language === "en" ? "Investment workspace" : "投资实验室"} className="grid h-auto grid-cols-3 gap-1">
          {(["portfolio", "valuation", "greater-china"] as LabTab[]).map((value) => (
            <TabsTrigger
              className="min-w-0 justify-center gap-1.5 px-2 [&_svg]:size-4"
              key={value}
              value={value}
            >
              {value === "portfolio" ? <BarChart3 /> : value === "valuation" ? <Calculator /> : <Globe2 />}
              <span className="truncate">{copy[value]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="panel-body min-h-0 min-w-0 flex-1 overflow-x-hidden lg:overflow-y-auto">
        <TabsContent className="mt-0 min-w-0 data-[state=inactive]:hidden" forceMount value="portfolio"><PortfolioLab language={language} /></TabsContent>
        <TabsContent className="mt-0 min-w-0 data-[state=inactive]:hidden" forceMount value="valuation"><ValuationLab initialSymbol={initialSymbol} language={language} /></TabsContent>
        <TabsContent className="mt-0 min-w-0 data-[state=inactive]:hidden" forceMount value="greater-china"><GreaterChinaLab initialSymbol={initialSymbol} language={language} /></TabsContent>
      </div>
    </Tabs>
  );
}

function PortfolioLab({ language }: { language: AppLanguage }) {
  const isEnglish = language === "en";
  const [benchmark, setBenchmark] = useState("SPY.US");
  const [lookback, setLookback] = useState("252");
  const [scenario, setScenario] = useState<ScenarioPreset>("standard");
  const [customShocks, setCustomShocks] = useState({ US: "-10", A: "-8", H: "-12" });
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [fxRates, setFxRates] = useState<Record<string, string>>(fxDefaults.USD);
  const [targets, setTargets] = useState<TargetDraft[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlowDraft[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [result, setResult] = useState<PortfolioLabResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setResult(null);
    setError("");
  }, [baseCurrency, benchmark, cashFlows, customShocks, fxRates, lookback, scenario, targets]);

  function changeBaseCurrency(value: string) {
    setBaseCurrency(value);
    setFxRates(fxDefaults[value] || { [value]: "1" });
  }

  function addTarget() {
    setTargets((current) => [...current, { symbol: "", weight: "" }]);
    setAdvancedOpen(true);
  }

  function addCashFlow() {
    setCashFlows((current) => [...current, { amount: "", currency: baseCurrency, date: "" }]);
    setAdvancedOpen(true);
  }

  async function run() {
    setLoading(true);
    setError("");
    try {
      const scenarioPayload = scenario === "custom"
        ? Object.fromEntries(Object.entries(customShocks).map(([market, value]) => [`market:${market}`, requiredNumber(value, isEnglish ? `Shock for ${market}` : `${market} 市场跌幅`) / 100]))
        : scenarioShocks[scenario];
      const targetPayload: Record<string, number> = {};
      targets.forEach((item) => {
        const targetSymbol = item.symbol.trim().toUpperCase();
        if (!targetSymbol && !item.weight.trim()) return;
        if (!targetSymbol || !item.weight.trim()) throw new Error(isEnglish ? "Complete both symbol and target weight." : "目标仓位需要同时填写标的和权重。");
        targetPayload[targetSymbol] = requiredNumber(item.weight, isEnglish ? "Target weight" : "目标权重") / 100;
      });
      const cashFlowPayload = cashFlows.flatMap((item) => {
        if (!item.date && !item.amount.trim()) return [];
        if (!item.date || !item.amount.trim()) throw new Error(isEnglish ? "Complete both date and amount for each cash flow." : "每笔现金流都需要填写日期和金额。");
        return [{ date: `${item.date}T00:00:00Z`, amount: requiredNumber(item.amount, isEnglish ? "Cash-flow amount" : "现金流金额"), currency: item.currency }];
      });
      const fxPayload = Object.fromEntries(Object.entries(fxRates).map(([currency, value]) => [currency, requiredPositiveNumber(value, `${currency} FX`)]));
      setResult(await analyzePortfolioLab({
        markets: ["US", "A", "H"],
        benchmark_symbol: benchmark.trim().toUpperCase(),
        lookback_days: Number(lookback),
        scenario_shocks: scenarioPayload,
        target_weights: targetPayload,
        cash_flows: cashFlowPayload,
        base_currency: baseCurrency,
        fx_rates: fxPayload,
      }));
    } catch (caught) {
      setError(toUserError(caught, isEnglish ? "Portfolio check failed." : "组合体检失败，请检查输入后重试。", language));
    } finally {
      setLoading(false);
    }
  }

  const metrics = result?.metrics || {};
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <IntroCard
        description={isEnglish ? "Uses your current holdings to explain return, risk, drawdown and concentration." : "直接读取当前持仓，告诉你收益、风险、回撤和集中度。"}
        icon={<ShieldCheck />}
        title={isEnglish ? "Check portfolio health" : "看看组合是否健康"}
      />

      <div className="rounded-xl border border-border/80 bg-background/60 p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field description={isEnglish ? "The index used for comparison." : "用于衡量组合表现的参照指数。"} label={isEnglish ? "Benchmark" : "比较基准"}>
            <Input value={benchmark} onChange={(event) => setBenchmark(event.target.value)} />
          </Field>
          <Field label={isEnglish ? "Analysis period" : "分析周期"}>
            <Select
              onValueChange={setLookback}
              options={[
                { label: isEnglish ? "3 months" : "近 3 个月", value: "90" },
                { label: isEnglish ? "1 year" : "近 1 年", value: "252" },
                { label: isEnglish ? "2 years" : "近 2 年", value: "504" },
              ]}
              value={lookback}
            />
          </Field>
          <Field label={isEnglish ? "Stress test" : "压力测试"}>
            <Select
              onValueChange={(value) => setScenario(value as ScenarioPreset)}
              options={[
                { label: isEnglish ? "Standard pullback" : "常规回撤", value: "standard" },
                { label: isEnglish ? "Severe sell-off" : "深度下跌", value: "severe" },
                { label: isEnglish ? "No stress test" : "不做压力测试", value: "none" },
                { label: isEnglish ? "Custom" : "自定义", value: "custom" },
              ]}
              value={scenario}
            />
          </Field>
          <Field label={isEnglish ? "Reporting currency" : "结果币种"}>
            <Select onValueChange={changeBaseCurrency} options={["USD", "HKD", "CNY"].map((value) => ({ label: value, value }))} value={baseCurrency} />
          </Field>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button className="w-full sm:w-auto" disabled={loading || !benchmark.trim()} onClick={() => void run()} size="lg">
            {loading ? <Loader2 className="animate-spin" /> : <BarChart3 />}
            {isEnglish ? "Check my portfolio" : "开始组合体检"}
          </Button>
          <p className="text-xs text-muted-foreground">{isEnglish ? "Usually takes a few seconds." : "通常几秒钟即可完成。"}</p>
        </div>
      </div>

      <AdvancedPanel
        description={isEnglish ? "Only needed for custom shocks, currency conversion, rebalancing or IRR." : "仅在自定义压力、币种换算、调仓或计算资金收益率时需要。"}
        onToggle={() => setAdvancedOpen((value) => !value)}
        open={advancedOpen}
        title={isEnglish ? "Advanced settings" : "专业设置"}
      >
        {scenario === "custom" ? (
          <SettingGroup description={isEnglish ? "Enter the expected move as a percentage." : "填写各市场可能的涨跌幅百分比。"} title={isEnglish ? "Custom stress scenario" : "自定义压力情景"}>
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.entries(customShocks).map(([market, value]) => (
                <Field key={market} label={`${market} ${isEnglish ? "move" : "涨跌幅"}`}>
                  <UnitInput ariaLabel={`${market} ${isEnglish ? "move" : "涨跌幅"}`} onChange={(next) => setCustomShocks((current) => ({ ...current, [market]: next }))} unit="%" value={value} />
                </Field>
              ))}
            </div>
          </SettingGroup>
        ) : null}

        <SettingGroup description={isEnglish ? "Defaults are indicative and can be replaced with your own rates." : "默认值仅用于换算，可替换为你认可的汇率。"} title={isEnglish ? `FX rates to ${baseCurrency}` : `兑 ${baseCurrency} 汇率`}>
          <div className="grid gap-3 sm:grid-cols-3">
            {["USD", "HKD", "CNY"].map((currency) => (
              <Field key={currency} label={`1 ${currency} =`}>
                <UnitInput ariaLabel={`1 ${currency} =`} disabled={currency === baseCurrency} onChange={(value) => setFxRates((current) => ({ ...current, [currency]: value }))} unit={baseCurrency} value={fxRates[currency] ?? ""} />
              </Field>
            ))}
          </div>
        </SettingGroup>

        <SettingGroup
          action={<Button onClick={addTarget} size="sm" variant="outline"><Plus />{isEnglish ? "Add target" : "添加目标"}</Button>}
          description={isEnglish ? "Optional. Use percentages, for example 25 for 25%." : "可选。权重直接填写百分比，例如 25 代表 25%。"}
          title={isEnglish ? "Target allocation" : "目标仓位"}
        >
          {targets.length ? (
            <div className="space-y-2">
              {targets.map((item, index) => (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" key={`target-${index}`}>
                  <Input aria-label={isEnglish ? "Target symbol" : "目标标的"} onChange={(event) => setTargets((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, symbol: event.target.value } : row))} placeholder="AAPL.US" value={item.symbol} />
                  <UnitInput ariaLabel={isEnglish ? "Target weight" : "目标权重"} onChange={(value) => setTargets((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, weight: value } : row))} unit="%" value={item.weight} />
                  <Button aria-label={isEnglish ? "Remove target" : "删除目标"} onClick={() => setTargets((current) => current.filter((_, rowIndex) => rowIndex !== index))} size="icon" variant="ghost"><Trash2 /></Button>
                </div>
              ))}
            </div>
          ) : <EmptyLine text={isEnglish ? "No target allocation added." : "暂未设置目标仓位。"} />}
        </SettingGroup>

        <SettingGroup
          action={<Button onClick={addCashFlow} size="sm" variant="outline"><Plus />{isEnglish ? "Add cash flow" : "添加现金流"}</Button>}
          description={isEnglish ? "Optional. Deposits are negative and withdrawals are positive." : "可选。入金填负数，出金填正数。"}
          title={isEnglish ? "Cash flows for money-weighted return" : "资金收益率现金流"}
        >
          {cashFlows.length ? (
            <div className="space-y-2">
              {cashFlows.map((item, index) => (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]" key={`cash-flow-${index}`}>
                  <Input aria-label={isEnglish ? "Cash-flow date" : "现金流日期"} onChange={(event) => setCashFlows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, date: event.target.value } : row))} type="date" value={item.date} />
                  <Input aria-label={isEnglish ? "Cash-flow amount" : "现金流金额"} onChange={(event) => setCashFlows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} placeholder="-10000" type="number" value={item.amount} />
                  <Select aria-label={isEnglish ? "Cash-flow currency" : "现金流币种"} onValueChange={(value) => setCashFlows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, currency: value } : row))} options={["USD", "HKD", "CNY"].map((value) => ({ label: value, value }))} value={item.currency} />
                  <Button aria-label={isEnglish ? "Remove cash flow" : "删除现金流"} onClick={() => setCashFlows((current) => current.filter((_, rowIndex) => rowIndex !== index))} size="icon" variant="ghost"><Trash2 /></Button>
                </div>
              ))}
            </div>
          ) : <EmptyLine text={isEnglish ? "No cash flows added." : "暂未添加现金流。"} />}
        </SettingGroup>
      </AdvancedPanel>

      {error ? <ErrorBox text={error} /> : null}
      {result ? (
        <section aria-live="polite" className="space-y-4">
          <ResultHeader
            caption={`${isEnglish ? "As of" : "数据时间"} ${formatDateTime(result.as_of)} · ${result.base_currency}`}
            title={isEnglish ? "Portfolio health result" : "组合体检结果"}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric featured label={isEnglish ? "Portfolio return" : "模拟收益"} value={percent(metrics.simulated_twr)} />
            <Metric label={isEnglish ? "Annualized volatility" : "年化波动"} value={percent(metrics.annualized_volatility)} />
            <Metric label={isEnglish ? "Maximum drawdown" : "最大回撤"} value={percent(metrics.max_drawdown)} />
            <Metric label={isEnglish ? "Concentration score" : "集中度指数"} value={number(metrics.concentration_hhi)} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <LabCard title={isEnglish ? "What drove the result" : "哪些持仓贡献了结果"}>
              {result.contribution.length ? (
                <Table
                  headers={[isEnglish ? "Symbol" : "标的", isEnglish ? "Weight" : "权重", isEnglish ? "Return" : "收益", isEnglish ? "Contribution" : "贡献"]}
                  rows={result.contribution.map((item) => [item.symbol, percent(item.weight), percent(item.period_return), percent(item.return_contribution)])}
                />
              ) : <EmptyLine text={isEnglish ? "No holdings to analyze." : "当前没有可分析的持仓。"} />}
            </LabCard>
            <LabCard title={isEnglish ? "Where risk is concentrated" : "风险主要集中在哪里"}>
              <Exposure title={isEnglish ? "Markets" : "市场"} values={result.exposures.market} />
              <Exposure title={isEnglish ? "Currencies" : "币种"} values={result.exposures.currency} />
              <Exposure title={isEnglish ? "Listing venues" : "上市地"} values={result.exposures.country_listing} />
            </LabCard>
          </div>
          <AdvancedPanel
            description={isEnglish ? "Beta, correlation, IRR, stress impact and data notes." : "Beta、相关性、资金收益率、压力结果和数据说明。"}
            onToggle={() => setDetailsOpen((value) => !value)}
            open={detailsOpen}
            title={isEnglish ? "Full analysis" : "查看完整分析"}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label={isEnglish ? "Money-weighted return" : "资金收益率"} value={percent(metrics.money_weighted_irr)} />
              <Metric label="Beta" value={number(metrics.beta)} />
              <Metric label={isEnglish ? "Benchmark correlation" : "基准相关性"} value={number(metrics.benchmark_correlation)} />
              <Metric label={isEnglish ? "History coverage" : "历史覆盖率"} value={percent(result.coverage.history_weight)} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <LabCard title={isEnglish ? "Stress-test impact" : "压力测试结果"}>
                <p className="text-2xl font-semibold">{percent(result.scenario.estimated_return)}</p>
                <p className="mt-2 text-xs text-muted-foreground">{isEnglish ? "Estimated portfolio move under the selected scenario." : "所选情景下的组合估算变动。"}</p>
              </LabCard>
              {result.thesis_links.length ? (
                <LabCard title={isEnglish ? "Research coverage" : "投资逻辑覆盖"}>
                  <div className="space-y-2">
                    {result.thesis_links.map((item) => (
                      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2" key={item.symbol}>
                        <span className="text-sm font-medium">{item.symbol}</span>
                        <span className="text-xs text-muted-foreground">{item.thesis_snapshot_id ? (isEnglish ? "Linked" : "已关联") : (isEnglish ? "Not linked" : "未关联")} · {percent(item.weight)}</span>
                      </div>
                    ))}
                  </div>
                </LabCard>
              ) : null}
            </div>
            {result.rebalance.length ? (
              <LabCard title={isEnglish ? "Rebalancing gap" : "调仓差异"}>
                <Table headers={[isEnglish ? "Symbol" : "标的", isEnglish ? "Current" : "当前", isEnglish ? "Target" : "目标", isEnglish ? "Difference" : "差异"]} rows={result.rebalance.map((item) => [item.symbol, percent(item.current_weight), percent(item.target_weight), percent(item.delta_weight)])} />
              </LabCard>
            ) : null}
            <NoticeList items={[...result.warnings, ...result.limitations]} title={isEnglish ? "Data notes" : "数据说明"} />
          </AdvancedPanel>
        </section>
      ) : null}
    </div>
  );
}

function ValuationLab({ initialSymbol, language }: { initialSymbol: string; language: AppLanguage }) {
  const isEnglish = language === "en";
  const labels = valuationFieldLabels[language];
  const [symbol, setSymbol] = useState(initialSymbol || "AAPL.US");
  const [type, setType] = useState<ValuationType>("dcf");
  const [title, setTitle] = useState(() => `${initialSymbol || "AAPL.US"} ${isEnglish ? "base valuation" : "基准估值"}`);
  const [fields, setFields] = useState<ValuationFields>(emptyValuationFields);
  const [peerText, setPeerText] = useState("");
  const [sourceIds, setSourceIds] = useState("");
  const [thesisId, setThesisId] = useState("");
  const [models, setModels] = useState<ValuationModel[]>([]);
  const [peers, setPeers] = useState<PeerComparisonResult | null>(null);
  const [continueId, setContinueId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [resultDetailsOpen, setResultDetailsOpen] = useState(false);
  const [action, setAction] = useState<"save" | "compare" | null>(null);
  const [error, setError] = useState("");
  const [modelError, setModelError] = useState("");
  const [success, setSuccess] = useState("");

  const normalizedSymbol = symbol.trim().toUpperCase();
  const peerSymbols = useMemo(
    () => [...new Set(peerText.split(/[,\s]+/).map((item) => item.trim().toUpperCase()).filter((item) => item && item !== normalizedSymbol))],
    [normalizedSymbol, peerText],
  );
  const comparisonSymbols = useMemo(() => [...new Set([normalizedSymbol, ...peerSymbols].filter(Boolean))], [normalizedSymbol, peerSymbols]);
  const latestModel = models.find((model) => model.model_type === type) || null;
  const canCalculate = Boolean(normalizedSymbol) && (type === "relative"
    ? Boolean(fields.peer_median.trim() && fields.target_metric.trim())
    : Boolean(fields.revenue.trim() && fields.shares_outstanding.trim() && fields.fcf_margin.trim() && fields.revenue_growth.trim() && (type !== "reverse_dcf" || fields.target_price.trim())));

  function hydrateModel(model: ValuationModel) {
    const nextType = (["dcf", "reverse_dcf", "relative"] as string[]).includes(model.model_type) ? model.model_type as ValuationType : "dcf";
    setType(nextType);
    setTitle(model.title);
    setPeerText(model.peer_symbols.join(", "));
    setSourceIds(model.source_ids.join(", "));
    setThesisId(model.thesis_snapshot_id || "");
    setFields((current) => valuationFieldsFromModel(current, model));
    setContinueId(model.id);
  }

  useEffect(() => {
    const nextSymbol = initialSymbol || "AAPL.US";
    setSymbol(nextSymbol);
    setTitle(`${nextSymbol} ${isEnglish ? "base valuation" : "基准估值"}`);
    setFields(emptyValuationFields());
    setContinueId(null);
    setModels([]);
    setPeers(null);
    setPeerText("");
    setSourceIds("");
    setThesisId("");
    setError("");
    setSuccess("");
  }, [initialSymbol]);

  useEffect(() => {
    setModels([]);
    setModelError("");
    if (!normalizedSymbol) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void listValuationModels(normalizedSymbol, { signal: controller.signal })
        .then((items) => {
          setModels(items);
          const latest = items[0];
          if (!latest) return;
          hydrateModel(latest);
        })
        .catch((caught) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setModelError(toUserError(caught, isEnglish ? "Could not load saved valuations." : "暂时无法读取历史估值。", language));
        });
    }, 350);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isEnglish, language, normalizedSymbol]);

  function updateField(key: keyof ValuationFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function assumptions() {
    if (type === "relative") {
      return {
        metric: "pe_ttm_ratio",
        peer_median: requiredPositiveNumber(fields.peer_median, labels.peer_median),
        target_metric: requiredPositiveNumber(fields.target_metric, labels.target_metric),
      };
    }
    const values = {
      revenue: requiredPositiveNumber(fields.revenue, labels.revenue, true),
      fcf_margin: requiredNumber(fields.fcf_margin, labels.fcf_margin) / 100,
      revenue_growth: requiredNumber(fields.revenue_growth, labels.revenue_growth) / 100,
      wacc: requiredNumber(fields.wacc, labels.wacc) / 100,
      terminal_growth: requiredNumber(fields.terminal_growth, labels.terminal_growth) / 100,
      shares_outstanding: requiredPositiveNumber(fields.shares_outstanding, labels.shares_outstanding),
      cash: requiredPositiveNumber(fields.cash, labels.cash, true),
      debt: requiredPositiveNumber(fields.debt, labels.debt, true),
      years: requiredPositiveNumber(fields.years, labels.years),
    };
    if (values.wacc <= values.terminal_growth) throw new Error(isEnglish ? "Discount rate must be higher than terminal growth." : "折现率需要高于永续增长率。");
    return type === "reverse_dcf" ? { ...values, target_price: requiredPositiveNumber(fields.target_price, labels.target_price) } : values;
  }

  async function save() {
    setAction("save");
    setError("");
    setSuccess("");
    try {
      const model = await createValuationModel(normalizedSymbol, {
        model_id: continueId,
        model_type: type,
        title: title.trim() || (isEnglish ? "Base valuation" : "基准估值"),
        assumptions: assumptions(),
        peer_symbols: peerSymbols,
        source_ids: sourceIds.split(/[,\s]+/).filter(Boolean),
        thesis_snapshot_id: thesisId.trim() || null,
        reason: continueId ? "Model refresh" : "Initial model",
      });
      setModels((current) => [model, ...current]);
      setContinueId(model.id);
      setResultDetailsOpen(false);
      setSuccess(isEnglish ? `Saved as version ${model.version}.` : `已保存为版本 ${model.version}。`);
    } catch (caught) {
      setError(toUserError(caught, isEnglish ? "Valuation failed. Check the assumptions and try again." : "估值失败，请检查输入后重试。", language));
    } finally {
      setAction(null);
    }
  }

  async function compare() {
    if (comparisonSymbols.length < 2) return;
    setAction("compare");
    setError("");
    setSuccess("");
    try {
      setPeers(await compareValuationPeers(comparisonSymbols));
    } catch (caught) {
      setError(toUserError(caught, isEnglish ? "Peer comparison failed." : "同业比较失败，请检查标的代码。", language));
    } finally {
      setAction(null);
    }
  }

  async function monitorLatest() {
    const fairValue = Number(latestModel?.result.value_per_share);
    if (!latestModel || !Number.isFinite(fairValue)) return;
    setError("");
    setSuccess("");
    try {
      await createAlertRule({
        symbol: normalizedSymbol,
        name: `${latestModel.title} fair-value review`,
        condition_type: "price",
        operator: "lte",
        threshold: fairValue,
        severity: "medium",
        channels: ["in_app"],
        evaluation_interval_seconds: 300,
        metadata: { valuation_model_id: latestModel.id },
      });
      setSuccess(isEnglish ? "Price review reminder created." : "价格复核提醒已创建。");
    } catch (caught) {
      setError(toUserError(caught, isEnglish ? "Could not create the review reminder." : "价格复核提醒创建失败。", language));
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <IntroCard
        description={isEnglish ? "Enter a few core assumptions. The result is saved automatically for future updates." : "只填核心假设即可得到结果；每次计算都会自动保存，方便以后更新。"}
        icon={<CircleDollarSign />}
        title={isEnglish ? "Estimate what a company may be worth" : "估算一家公司值多少钱"}
      />

      <div className="rounded-xl border border-border/80 bg-background/60 p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field description={isEnglish ? "Use Longbridge format, for example AAPL.US or 700.HK." : "使用长桥代码格式，例如 AAPL.US 或 700.HK。"} label={isEnglish ? "Company" : "公司代码"}>
            <Input value={symbol} onChange={(event) => {
              const nextSymbol = event.target.value;
              setSymbol(nextSymbol);
              setTitle(`${nextSymbol.trim().toUpperCase() || (isEnglish ? "Company" : "公司")} ${isEnglish ? "base valuation" : "基准估值"}`);
              setFields(emptyValuationFields());
              setContinueId(null);
              setPeers(null);
              setPeerText("");
              setSourceIds("");
              setThesisId("");
              setError("");
              setSuccess("");
            }} />
          </Field>
          <Field label={isEnglish ? "What do you want to know?" : "你想解决什么问题？"}>
            <Select
              onValueChange={(value) => {
                const nextType = value as ValuationType;
                const savedModel = models.find((model) => model.model_type === nextType);
                if (savedModel) hydrateModel(savedModel);
                else {
                  setType(nextType);
                  setFields(emptyValuationFields());
                  setContinueId(null);
                }
                setPeers(null);
                setSuccess("");
              }}
              options={[
                { label: isEnglish ? "Estimate fair value" : "估算合理价值", value: "dcf" },
                { label: isEnglish ? "See what growth is priced in" : "市场价格隐含多少增长", value: "reverse_dcf" },
                { label: isEnglish ? "Value from peer multiples" : "参考同业倍数估值", value: "relative" },
              ]}
              value={type}
            />
          </Field>
        </div>

        {type === "relative" ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field description={isEnglish ? "For example, the peer median P/E." : "例如同业市盈率中位数。"} label={labels.peer_median}>
              <Input min="0" onChange={(event) => updateField("peer_median", event.target.value)} placeholder="20" step="any" type="number" value={fields.peer_median} />
            </Field>
            <Field description={isEnglish ? "The company measure multiplied by the peer multiple." : "与同业倍数相乘的公司指标。"} label={labels.target_metric}>
              <Input min="0" onChange={(event) => updateField("target_metric", event.target.value)} placeholder="1.5" step="any" type="number" value={fields.target_metric} />
            </Field>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={labels.revenue}>
              <Input min="0" onChange={(event) => updateField("revenue", event.target.value)} placeholder="1000" step="any" type="number" value={fields.revenue} />
            </Field>
            <Field label={labels.shares_outstanding}>
              <Input min="0" onChange={(event) => updateField("shares_outstanding", event.target.value)} placeholder="100" step="any" type="number" value={fields.shares_outstanding} />
            </Field>
            <Field label={labels.fcf_margin}>
              <UnitInput ariaLabel={labels.fcf_margin} onChange={(value) => updateField("fcf_margin", value)} placeholder="20" unit="%" value={fields.fcf_margin} />
            </Field>
            <Field label={labels.revenue_growth}>
              <UnitInput ariaLabel={labels.revenue_growth} onChange={(value) => updateField("revenue_growth", value)} placeholder="8" unit="%" value={fields.revenue_growth} />
            </Field>
            {type === "reverse_dcf" ? (
              <Field className="sm:col-span-2 lg:col-span-1" description={isEnglish ? "Used to infer the growth assumption behind the market price." : "用于反推当前市场价格隐含的增长假设。"} label={labels.target_price}>
                <Input min="0" onChange={(event) => updateField("target_price", event.target.value)} placeholder="20" step="any" type="number" value={fields.target_price} />
              </Field>
            ) : null}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button className="w-full sm:w-auto" disabled={action !== null || !canCalculate} onClick={() => void save()} size="lg">
            {action === "save" ? <Loader2 className="animate-spin" /> : <Calculator />}
            {continueId ? (isEnglish ? "Update valuation" : "更新估值") : (isEnglish ? "Calculate valuation" : "计算估值")}
          </Button>
          <p className="text-xs text-muted-foreground">{isEnglish ? "The result is saved as a new version." : "结果会自动保存为新版本。"}</p>
        </div>
      </div>

      <AdvancedPanel
        description={isEnglish ? "Discount rate, terminal growth, cash/debt and audit links." : "折现率、永续增长、现金负债和审计关联信息。"}
        onToggle={() => setAdvancedOpen((value) => !value)}
        open={advancedOpen}
        title={isEnglish ? "Advanced assumptions" : "高级假设"}
      >
        {type !== "relative" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label={labels.wacc}><UnitInput ariaLabel={labels.wacc} onChange={(value) => updateField("wacc", value)} unit="%" value={fields.wacc} /></Field>
            <Field label={labels.terminal_growth}><UnitInput ariaLabel={labels.terminal_growth} onChange={(value) => updateField("terminal_growth", value)} unit="%" value={fields.terminal_growth} /></Field>
            <Field label={labels.cash}><Input min="0" onChange={(event) => updateField("cash", event.target.value)} step="any" type="number" value={fields.cash} /></Field>
            <Field label={labels.debt}><Input min="0" onChange={(event) => updateField("debt", event.target.value)} step="any" type="number" value={fields.debt} /></Field>
            <Field label={labels.years}><Input max="20" min="1" onChange={(event) => updateField("years", event.target.value)} step="1" type="number" value={fields.years} /></Field>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={isEnglish ? "Model name" : "估值名称"}><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field description={isEnglish ? "Optional, for audit traceability." : "可选，用于审计追溯。"} label={isEnglish ? "Thesis snapshot ID" : "投资逻辑版本 ID"}><Input value={thesisId} onChange={(event) => setThesisId(event.target.value)} /></Field>
          <Field description={isEnglish ? "Optional, separated by commas." : "可选，多个 ID 用逗号分隔。"} label={isEnglish ? "Evidence source IDs" : "证据来源 ID"}><Input value={sourceIds} onChange={(event) => setSourceIds(event.target.value)} /></Field>
        </div>
      </AdvancedPanel>

      <div className="rounded-xl border border-border/80 bg-background/60 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <Field className="flex-1" description={isEnglish ? "Add at least one peer; the current company is included automatically." : "至少填写 1 家同业；当前公司会自动加入比较。"} label={isEnglish ? "Peer companies (optional)" : "同业公司（可选）"}>
            <Input placeholder={normalizedSymbol.endsWith(".HK") ? "9988.HK, 9618.HK" : "MSFT.US, GOOGL.US"} value={peerText} onChange={(event) => { setPeerText(event.target.value); setPeers(null); }} />
          </Field>
          <Button disabled={action !== null || comparisonSymbols.length < 2} onClick={() => void compare()} variant="outline">
            {action === "compare" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {isEnglish ? "Compare peers" : "比较同业"}
          </Button>
        </div>
      </div>

      {error ? <ErrorBox text={error} /> : null}
      {modelError ? <ErrorBox text={modelError} /> : null}
      {success ? <SuccessBox text={success} /> : null}
      {latestModel ? (
        <section aria-live="polite" className="space-y-4">
          <ResultHeader caption={`${latestModel.title} · ${isEnglish ? "Version" : "版本"} ${latestModel.version} · ${formatDateTime(latestModel.created_at)}`} title={isEnglish ? "Valuation result" : "估值结果"} />
          <ValuationSummary language={language} model={latestModel} />
          <div className="flex flex-wrap gap-2">
            {typeof latestModel.result.value_per_share === "number" ? (
              <Button onClick={() => void monitorLatest()} size="sm" variant="outline"><ShieldCheck />{isEnglish ? "Create price review reminder" : "创建价格复核提醒"}</Button>
            ) : null}
          </div>
          <AdvancedPanel
            description={isEnglish ? "Forecast detail, sensitivity and the assumptions used." : "预测明细、敏感性和本次使用的假设。"}
            onToggle={() => setResultDetailsOpen((value) => !value)}
            open={resultDetailsOpen}
            title={isEnglish ? "Calculation details" : "查看计算细节"}
          >
            <ValuationDetails language={language} model={latestModel} />
          </AdvancedPanel>
        </section>
      ) : null}

      {peers ? (
        <PeerResults
          language={language}
          onUseMedian={typeof peers.medians.pe_ttm_ratio === "number" ? (value) => {
            setType("relative");
            updateField("peer_median", String(value));
            setContinueId(null);
          } : undefined}
          peers={peers}
        />
      ) : null}
    </div>
  );
}

function GreaterChinaLab({ initialSymbol, language }: { initialSymbol: string; language: AppLanguage }) {
  const isEnglish = language === "en";
  const [symbol, setSymbol] = useState(initialSymbol || "700.HK");
  const [paired, setPaired] = useState("");
  const [usChina, setUsChina] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dataDetailsOpen, setDataDetailsOpen] = useState(false);
  const [context, setContext] = useState<GreaterChinaContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  useEffect(() => {
    setSymbol(initialSymbol || "700.HK");
    setContext(null);
    setError("");
  }, [initialSymbol]);

  useEffect(() => {
    requestVersion.current += 1;
    setContext(null);
    setError("");
  }, [symbol, paired, usChina]);

  async function load() {
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      const nextContext = await getGreaterChinaContext({
        symbol: symbol.trim().toUpperCase(),
        paired_symbol: paired.trim().toUpperCase() || undefined,
        china_related_us_listing: usChina,
      });
      if (version === requestVersion.current) setContext(nextContext);
    } catch (caught) {
      if (version === requestVersion.current) setError(toUserError(caught, isEnglish ? "Could not build the research checklist." : "研究清单生成失败，请检查标的代码。", language));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <IntroCard
        description={isEnglish ? "Get a market-specific checklist for HK, A-share and US-listed China companies." : "针对港股、A 股和中概美股，生成一份真正能照着做的研究清单。"}
        icon={<Globe2 />}
        title={isEnglish ? "Start Greater China research" : "开始大中华公司研究"}
      />

      <div className="rounded-xl border border-border/80 bg-background/60 p-4 sm:p-5">
        <div className="max-w-xl">
          <Field description={isEnglish ? "For example 700.HK, 600519.SH or BABA.US." : "例如 700.HK、600519.SH 或 BABA.US。"} label={isEnglish ? "Company" : "研究标的"}>
            <Input value={symbol} onChange={(event) => setSymbol(event.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button className="w-full sm:w-auto" disabled={loading || !symbol.trim()} onClick={() => void load()} size="lg">
            {loading ? <Loader2 className="animate-spin" /> : <Building2 />}
            {isEnglish ? "Build research checklist" : "生成研究清单"}
          </Button>
          <p className="text-xs text-muted-foreground">{isEnglish ? "Includes disclosure, listing and currency considerations." : "包含披露、上市架构和汇率等专项关注点。"}</p>
        </div>
      </div>

      <AdvancedPanel
        description={isEnglish ? "Use these only for an A/H/ADR comparison or a US-listed China company." : "仅在需要 A/H/ADR 对照或研究中概美股时设置。"}
        onToggle={() => setAdvancedOpen((value) => !value)}
        open={advancedOpen}
        title={isEnglish ? "Comparison settings" : "对照设置"}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field description={isEnglish ? "Optional, for example 600941.SH." : "可选，例如 600941.SH。"} label={isEnglish ? "A/H/ADR counterpart" : "A/H/ADR 对照标的"}>
            <Input placeholder="600941.SH" value={paired} onChange={(event) => setPaired(event.target.value)} />
          </Field>
          <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border/70 bg-[var(--control-bg)] px-3 py-2 text-sm shadow-[var(--control-shadow)]">
            <span>
              <span className="block font-medium">{isEnglish ? "US-listed China company" : "这是中概美股"}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{isEnglish ? "Adds ADR and US disclosure checks." : "将加入 ADR 和美国披露专项检查。"}</span>
            </span>
            <Switch checked={usChina} onCheckedChange={setUsChina} />
          </label>
        </div>
      </AdvancedPanel>

      {error ? <ErrorBox text={error} /> : null}
      {context ? (
        <section aria-live="polite" className="space-y-4">
          <ResultHeader caption={`${context.symbol} · ${context.currency || "—"} · ${formatDateTime(context.fetched_at)}`} title={isEnglish ? "Research checklist" : "专项研究清单"} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric featured label={isEnglish ? "Market" : "市场"} value={marketLabel(context.market, language)} />
            <Metric label={isEnglish ? "Currency" : "交易币种"} value={context.currency || "—"} />
            <Metric label={isEnglish ? "Disclosure languages" : "披露语言"} value={context.disclosure_languages.join(" / ") || "—"} />
            <Metric label={isEnglish ? "Timezone" : "交易时区"} value={context.timezone || "—"} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <LabCard title={isEnglish ? "Start with these checks" : "先检查这些事项"}>
              <NumberedList items={context.research_checklist.map((item) => translateChinaItem(item, language))} />
            </LabCard>
            <LabCard title={isEnglish ? "Risks that are easy to miss" : "容易忽略的风险"}>
              <div className="flex flex-wrap gap-2">
                {context.risk_dimensions.map((item) => <Badge key={item} variant="outline">{translateChinaItem(item, language)}</Badge>)}
              </div>
            </LabCard>
          </div>
          {context.paired_comparison ? <PeerResults language={language} peers={context.paired_comparison} title={isEnglish ? "A/H/ADR comparison" : "A/H/ADR 对照"} /> : null}
          <AdvancedPanel
            description={isEnglish ? "Shows which Longbridge datasets were available and any partial failures." : "查看 Longbridge 数据覆盖和部分数据失败说明。"}
            onToggle={() => setDataDetailsOpen((value) => !value)}
            open={dataDetailsOpen}
            title={isEnglish ? "Data coverage" : "数据覆盖"}
          >
            <div className="flex flex-wrap gap-2">
              {Object.entries(context.insights).map(([key, value]) => (
                <Badge key={key} variant={value ? "outline" : "muted"}>{insightLabel(key, language)} · {value ? (isEnglish ? "Available" : "可用") : (isEnglish ? "Unavailable" : "暂无")}</Badge>
              ))}
            </div>
            {context.errors.length ? <NoticeList items={context.errors} title={isEnglish ? "Partial data issues" : "部分数据未获取"} /> : null}
            <p className="text-xs leading-5 text-muted-foreground">{isEnglish ? "Company, valuation, filing and corporate-action data use Longbridge when available." : "公司资料、估值、公告与公司行动优先使用 Longbridge 数据。"}</p>
          </AdvancedPanel>
        </section>
      ) : null}
    </div>
  );
}

function AdvancedPanel({ children, description, onToggle, open, title }: { children: ReactNode; description: string; onToggle: () => void; open: boolean; title: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-background/45">
      <button aria-expanded={open} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/35" onClick={onToggle} type="button">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="size-4 text-primary" />{title}</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
        </span>
        {open ? <ChevronUp className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
      </button>
      {open ? <div className="space-y-5 border-t border-border/70 p-4">{children}</div> : null}
    </div>
  );
}

function IntroCard({ description, icon, title }: { description: string; icon: ReactNode; title: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.055] p-4">
      <div className="mt-0.5 rounded-lg bg-primary/12 p-2 text-primary [&_svg]:size-5">{icon}</div>
      <div className="min-w-0"><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p></div>
    </div>
  );
}

function SettingGroup({ action, children, description, title }: { action?: ReactNode; children: ReactNode; description: string; title: string }) {
  return (
    <section className="space-y-3 border-b border-border/60 pb-5 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ResultHeader({ caption, title }: { caption: string; title: string }) {
  return <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><h2 className="text-base font-semibold">{title}</h2><p className="text-xs text-muted-foreground">{caption}</p></div>;
}

function ValuationSummary({ language, model }: { language: AppLanguage; model: ValuationModel }) {
  const isEnglish = language === "en";
  const result = model.result;
  if (model.model_type === "relative") {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric featured label={isEnglish ? "Implied value" : "推算价值"} value={number(result.implied_equity_value)} />
        <Metric label={isEnglish ? "Peer multiple" : "同业倍数"} value={number(result.peer_median)} />
        <Metric label={isEnglish ? "Company metric" : "公司指标"} value={number(result.target_metric)} />
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric featured label={isEnglish ? "Estimated value per share" : "每股估值"} value={number(result.value_per_share)} />
      <Metric label={isEnglish ? "Enterprise value" : "企业价值"} value={number(result.enterprise_value)} />
      <Metric label={isEnglish ? "Equity value" : "股权价值"} value={number(result.equity_value)} />
      <Metric label={model.model_type === "reverse_dcf" ? (isEnglish ? "Implied revenue growth" : "隐含收入增速") : (isEnglish ? "Terminal-value share" : "终值占比")} value={model.model_type === "reverse_dcf" ? percent(result.implied_revenue_growth) : percent(result.terminal_value_share)} />
    </div>
  );
}

function ValuationDetails({ language, model }: { language: AppLanguage; model: ValuationModel }) {
  const isEnglish = language === "en";
  const forecast = Array.isArray(model.result.forecast) ? model.result.forecast as Array<Record<string, unknown>> : [];
  const sensitivity = Array.isArray(model.result.sensitivity) ? model.result.sensitivity as Array<Record<string, unknown>> : [];
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {forecast.length ? (
        <LabCard title={isEnglish ? "Forecast" : "预测明细"}>
          <Table headers={[isEnglish ? "Year" : "年度", isEnglish ? "Revenue" : "收入", "FCF", isEnglish ? "Present value" : "现值"]} rows={forecast.map((row) => [number(row.year), number(row.revenue), number(row.fcf), number(row.present_value)])} />
        </LabCard>
      ) : null}
      {sensitivity.length ? (
        <LabCard title={isEnglish ? "Sensitivity" : "敏感性分析"}>
          <Table headers={[isEnglish ? "Discount rate" : "折现率", isEnglish ? "Terminal growth" : "永续增长", isEnglish ? "Value per share" : "每股价值"]} rows={sensitivity.map((row) => [percent(row.wacc), percent(row.terminal_growth), number(row.value_per_share)])} />
        </LabCard>
      ) : null}
      <LabCard title={isEnglish ? "Assumptions used" : "本次使用的假设"}>
        <KeyValueList language={language} values={model.assumptions} />
      </LabCard>
    </div>
  );
}

function PeerResults({ language, onUseMedian, peers, title }: { language: AppLanguage; onUseMedian?: (value: number) => void; peers: PeerComparisonResult; title?: string }) {
  const isEnglish = language === "en";
  const metrics = Object.keys(peers.medians);
  return (
    <LabCard title={title || (isEnglish ? "Peer comparison" : "同业比较")}>
      <Table
        headers={[isEnglish ? "Company" : "公司", ...metrics.map((key) => metricLabel(key, language))]}
        rows={peers.rows.map((row) => [row.name && row.name !== row.symbol ? `${row.name} · ${row.symbol}` : row.symbol, ...metrics.map((key) => number(row.metrics[key]))])}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {metrics.map((key) => <Badge key={key} variant="outline">{metricLabel(key, language)} {isEnglish ? "median" : "中位数"} · {number(peers.medians[key])}</Badge>)}
      </div>
      {onUseMedian && typeof peers.medians.pe_ttm_ratio === "number" ? (
        <Button className="mt-3" onClick={() => onUseMedian(peers.medians.pe_ttm_ratio as number)} size="sm" variant="outline">
          <Calculator />{isEnglish ? "Use median P/E for valuation" : "用市盈率中位数估值"}
        </Button>
      ) : null}
      {peers.errors.length ? <NoticeList items={peers.errors.map((item) => `${item.symbol}: ${item.error}`)} title={isEnglish ? "Unavailable data" : "未获取的数据"} /> : null}
    </LabCard>
  );
}

function KeyValueList({ language, values }: { language: AppLanguage; values: Record<string, unknown> }) {
  const labels = valuationFieldLabels[language] as Record<string, string>;
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {Object.entries(values).filter(([, value]) => typeof value !== "object").map(([key, value]) => {
        const isPercent = ["fcf_margin", "revenue_growth", "wacc", "terminal_growth"].includes(key);
        return <div className="flex items-center justify-between gap-3 border-b border-border/50 py-1.5" key={key}><dt className="text-xs text-muted-foreground">{labels[key] || key.replaceAll("_", " ")}</dt><dd className="text-sm font-medium">{isPercent ? percent(value) : number(value)}</dd></div>;
      })}
    </dl>
  );
}

function NoticeList({ items, title }: { items: string[]; title: string }) {
  if (!items.length) return null;
  return <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3"><p className="text-xs font-semibold text-foreground">{title}</p>{items.map((item, index) => <p className="mt-1 text-xs leading-5 text-muted-foreground" key={`${item}-${index}`}>• {item}</p>)}</div>;
}

function NumberedList({ items }: { items: string[] }) {
  return <ol className="space-y-3">{items.map((item, index) => <li className="flex gap-3 text-sm leading-6" key={item}><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">{index + 1}</span><span>{item}</span></li>)}</ol>;
}

function UnitInput({ ariaLabel, disabled, onChange, placeholder, unit, value }: { ariaLabel?: string; disabled?: boolean; onChange: (value: string) => void; placeholder?: string; unit: string; value: string }) {
  return <div className="relative"><Input aria-label={ariaLabel} className="pr-14" disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} step="any" type="number" value={value} /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unit}</span></div>;
}

function Metric({ featured = false, label, value }: { featured?: boolean; label: string; value: string }) {
  return <div className={`min-w-0 rounded-xl border p-3 ${featured ? "border-primary/30 bg-primary/[0.06]" : "border-border/80 bg-background/60"}`}><p className="text-[11px] text-muted-foreground">{label}</p><p className={`mt-1 truncate font-semibold ${featured ? "text-xl text-primary" : "text-lg"}`}>{value}</p></div>;
}

function LabCard({ children, title }: { children: ReactNode; title: string }) {
  return <div className="min-w-0 rounded-xl border border-border/80 bg-background/60 p-4"><h2 className="mb-3 text-sm font-semibold">{title}</h2>{children}</div>;
}

function ErrorBox({ text }: { text: string }) {
  return <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm leading-6 text-destructive" role="alert">{text}</div>;
}

function SuccessBox({ text }: { text: string }) {
  return <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm leading-6 text-emerald-600 dark:text-emerald-300" role="status">{text}</div>;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-border/70 px-3 py-5 text-center text-xs text-muted-foreground">{text}</p>;
}

function Exposure({ title, values = {} }: { title: string; values?: Record<string, number> }) {
  return <div className="mb-3 last:mb-0"><p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p><div className="flex flex-wrap gap-2">{Object.entries(values).length ? Object.entries(values).map(([key, value]) => <Badge key={key} variant="outline">{key} {percent(value)}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}</div></div>;
}

function Table({ headers, rows }: { headers: string[]; rows: Array<Array<string>> }) {
  return <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-xs"><thead><tr className="border-b border-border/70 text-muted-foreground">{headers.map((header) => <th className="px-2 py-2 font-medium" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-b border-border/50" key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td className="px-2 py-2" key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function percent(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "—";
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
}

function requiredNumber(value: string, label: string) {
  const numeric = Number(value);
  if (!value.trim() || !Number.isFinite(numeric)) throw new Error(`${label} ${/[一-鿿]/.test(label) ? "需要填写有效数字。" : "must be a valid number."}`);
  return numeric;
}

function requiredPositiveNumber(value: string, label: string, allowZero = false) {
  const numeric = requiredNumber(value, label);
  if (numeric < 0 || (!allowZero && numeric === 0)) throw new Error(`${label} ${/[一-鿿]/.test(label) ? "需要大于 0。" : "must be greater than zero."}`);
  return numeric;
}

function emptyValuationFields(): ValuationFields {
  return {
    revenue: "",
    fcf_margin: "",
    revenue_growth: "",
    wacc: "10",
    terminal_growth: "3",
    shares_outstanding: "",
    cash: "0",
    debt: "0",
    years: "5",
    target_price: "",
    peer_median: "",
    target_metric: "",
  };
}

function valuationFieldsFromModel(current: ValuationFields, model: ValuationModel): ValuationFields {
  const next = { ...current };
  const percentKeys = new Set<keyof ValuationFields>(["fcf_margin", "revenue_growth", "wacc", "terminal_growth"]);
  (Object.keys(next) as Array<keyof ValuationFields>).forEach((key) => {
    const raw = model.assumptions[key];
    if (raw === null || raw === undefined || raw === "") return;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return;
    next[key] = String(percentKeys.has(key) ? numeric * 100 : numeric);
  });
  return next;
}

function toUserError(caught: unknown, fallback: string, language: AppLanguage) {
  const message = caught instanceof Error ? caught.message : fallback;
  if (language === "en") return message || fallback;
  if (/Longbridge credentials|Longbridge is not configured/i.test(message)) return "市场数据尚未连接，请先前往“配置”连接 Longbridge。";
  if (/outside the solvable growth range/i.test(message)) return "当前价格超出了这组假设可反推的范围，请调整收入、利润率或折现率。";
  if (/cross-currency|FX rate|missing.*currency/i.test(message)) return "组合包含多种币种，请展开“专业设置”确认换算汇率。";
  if (/DCF requires/i.test(message)) return "请完整填写收入、现金流率、增速、折现率、永续增长率和总股本。";
  return message || fallback;
}

function formatDateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function translateChinaItem(value: string, language: AppLanguage) {
  return language === "en" ? value : chinaTranslations[value] || value;
}

function marketLabel(value: GreaterChinaContext["market"], language: AppLanguage) {
  if (language === "en") return { HK: "Hong Kong", A: "A-share", US_CHINA: "US-listed China", OTHER: "Other" }[value];
  return { HK: "港股", A: "A 股", US_CHINA: "中概美股", OTHER: "其他" }[value];
}

function insightLabel(value: string, language: AppLanguage) {
  const labels: Record<string, [string, string]> = {
    filings: ["公告披露", "Filings"],
    company: ["公司资料", "Company"],
    valuation: ["估值数据", "Valuation"],
    dividends: ["分红", "Dividends"],
    institution_rating: ["机构评级", "Institution ratings"],
    corporate_actions: ["公司行动", "Corporate actions"],
  };
  return labels[value]?.[language === "en" ? 1 : 0] || value.replaceAll("_", " ");
}

function metricLabel(value: string, language: AppLanguage) {
  const labels: Record<string, [string, string]> = {
    pe_ttm_ratio: ["市盈率", "P/E"],
    pb_ratio: ["市净率", "P/B"],
    ps_ttm_ratio: ["市销率", "P/S"],
  };
  return labels[value]?.[language === "en" ? 1 : 0] || value.replaceAll("_", " ");
}
