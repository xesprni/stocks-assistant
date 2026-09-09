import type { AppLanguage } from "@/lib/i18n";
import type { LabAIKind } from "@/types/app";

export const labAiCopy = {
  zh: {
    ai: "AI 自动分析", manual: "手动分析", heading: "从问题到研究结论，交给 AI 完成。",
    subtitle: "读取相关数据，调用分析工具，整理依据与结论。", symbol: "研究标的", symbolHint: "使用完整代码，如 AAPL.US、700.HK、600519.SH；多个标的用逗号分隔。",
    objective: "你想重点了解什么？", optional: "选填", start: "开始自动分析", stop: "停止分析", stopping: "正在停止…", running: "分析进行中", completed: "已完成", failed: "未完成", canceled: "已停止",
    history: "最近分析", noHistory: "完成的分析会保存在这里，方便随时回看。", historyError: "无法加载分析记录", refresh: "刷新记录", steps: "执行记录", report: "研究报告", artifacts: "数据与计算", warnings: "数据说明", empty: "准备好后，开始一次自动分析", emptyHint: "AI 将根据你的目标读取数据、完成计算，并保留分析报告与计算依据。",
    preparing: "正在准备分析…", collecting: "获取数据", reasoning: "分析与计算", writing: "整理报告", source: "数据来源", copied: "已复制", copy: "复制报告", export: "导出 Markdown", noReport: "本次分析尚未生成报告。", limited: "你没有执行 AI 分析的权限，请联系管理员开启对话与相关数据权限。", invalidSymbol: "请输入最多 10 个完整标的代码。", connectionError: "分析连接中断，请查看最近记录确认结果后再重试。", count: "条数据", more: "展开更多", less: "收起", true: "是", false: "否", none: "暂无数据", saved: "报告与数据依据自动保存", usingModel: "使用配置页中的 AI 模型", recordDate: "分析时间", input: "本次研究目标", artifactCount: "份数据", toolCount: "步", noSteps: "分析过程中会在这里显示实际执行步骤。",
  },
  en: {
    ai: "AI analysis", manual: "Manual analysis", heading: "Turn a question into research with AI.",
    subtitle: "Gather relevant data, run analysis tools, and explain the findings.", symbol: "Research symbols", symbolHint: "Use full symbols, e.g. AAPL.US, 700.HK, 600519.SH. Separate multiple symbols with commas.",
    objective: "What would you like to focus on?", optional: "Optional", start: "Start AI analysis", stop: "Stop analysis", stopping: "Stopping…", running: "Analyzing", completed: "Completed", failed: "Incomplete", canceled: "Stopped",
    history: "Recent analyses", noHistory: "Your analyses will appear here for future reference.", historyError: "Could not load analyses", refresh: "Refresh history", steps: "Activity", report: "Research report", artifacts: "Data & calculations", warnings: "Data notes", empty: "Ready for your next research question", emptyHint: "AI will gather data, run calculations, and save the report with its supporting evidence.",
    preparing: "Preparing analysis…", collecting: "Gather data", reasoning: "Analyze & calculate", writing: "Write report", source: "Source", copied: "Copied", copy: "Copy report", export: "Export Markdown", noReport: "This analysis has not produced a report yet.", limited: "AI analysis requires chat and relevant data permissions. Contact an administrator.", invalidSymbol: "Enter up to 10 full security symbols.", connectionError: "Analysis connection interrupted. Check recent runs before trying again.", count: "records", more: "Show more", less: "Show less", true: "Yes", false: "No", none: "No data", saved: "Reports and evidence are saved automatically", usingModel: "Uses the AI model in your settings", recordDate: "Analyzed", input: "Research objective", artifactCount: "datasets", toolCount: "steps", noSteps: "Actual analysis steps will appear here as they run.",
  },
} as const;

export const labAiPrompts: Record<AppLanguage, Record<LabAIKind, { title: string; description: string; objective: string; focuses: string[] }>> = {
  zh: {
    portfolio: { title: "自动体检你的投资组合", description: "直接读取当前持仓，分析集中度、风险来源与压力情景。", objective: "对我的当前持仓做全面体检，分析集中度、收益风险和压力情景，列出需要关注的问题与后续研究方向。区分事实、计算结果与假设。", focuses: ["全面体检", "关注集中度与风险暴露", "分析回撤与压力情景"] },
    valuation: { title: "让 AI 完成公司估值研究", description: "选择公司，AI 自动收集财报与行情，选择适合的估值方法并解释假设。", objective: "分析这些公司的财务与估值，自动收集数据并选择适合的方法完成计算。展示关键假设、敏感性和数据来源；数据不足时明确缺口。", focuses: ["综合估值研究", "现金流与 DCF 估值", "市场价格隐含了什么预期", "同业估值对比"] },
    greater_china: { title: "串联大中华市场的研究线索", description: "围绕 A 股、港股与中概股，梳理公司基本面、上市结构及跨市场差异。", objective: "研究这些公司的基本面与大中华市场背景，核对上市结构、披露、币种与跨市场风险，给出有数据依据的研究结论和待验证事项。", focuses: ["综合公司研究", "上市结构与双重上市", "政策、汇率与治理风险"] },
  },
  en: {
    portfolio: { title: "An automatic checkup for your portfolio", description: "Read current holdings and examine concentration, risk exposures, and stress scenarios.", objective: "Review my current holdings, concentration, return and risk, and stress scenarios. Identify issues and further research priorities. Separate facts, calculations, and assumptions.", focuses: ["Full portfolio review", "Concentration and risk exposures", "Drawdown and stress scenarios"] },
    valuation: { title: "Let AI research company valuations", description: "Select a company. AI gathers financials and quotes, chooses valuation methods, and explains assumptions.", objective: "Research these companies' financials and valuation. Gather data, select suitable methods, and run calculations. Show assumptions, sensitivity, and sources; identify any missing inputs.", focuses: ["Complete valuation study", "Cash flow and DCF valuation", "Expectations implied by market prices", "Peer valuation comparison"] },
    greater_china: { title: "Connect the Greater China research picture", description: "Examine A shares, Hong Kong listings, and Chinese ADRs across fundamentals and listing structures.", objective: "Research these companies' fundamentals and Greater China context. Check listing structures, disclosures, currencies, and cross-market risks. Provide evidence-based findings and open questions.", focuses: ["Complete company research", "Listing structure and dual listings", "Policy, currency, and governance risks"] },
  },
};

const dataLabels: Record<string, string> = {
  result: "计算结果", data: "数据", symbol: "标的", symbols: "标的", name: "名称", market: "市场", currency: "币种", source: "来源", source_note: "来源说明", fetched_at: "获取时间", as_of: "数据时间", created_at: "生成时间", assumptions: "模型假设", evidence: "依据", warnings: "数据说明", limitations: "局限", methodology: "计算方法", method: "方法", metrics: "指标", total_value: "总资产", equity_value: "股权价值", cash_value: "现金", base_currency: "基准币种", enterprise_value: "企业价值", value_per_share: "每股估值", terminal_value_share: "终值占比", sensitivity: "敏感性分析", forecast: "预测", year: "年份", revenue: "收入", fcf: "自由现金流", present_value: "现值", wacc: "折现率", terminal_growth: "永续增长率", contribution: "收益贡献", weight: "权重", period_return: "区间收益率", return_contribution: "收益贡献", data_available: "数据可用", exposures: "风险暴露", scenario: "压力情景", estimated_return: "情景收益率", holding_impacts: "持仓影响", coverage: "数据覆盖", holdings: "持仓数", valued_holdings: "可估值持仓", history_available: "可用历史", history_weight: "历史覆盖权重", excluded_fx_holdings: "缺少汇率的持仓", benchmark_symbol: "基准标的", lookback_days: "回看天数", rebalance: "再平衡测算", fx_rates_used: "采用汇率", thesis_links: "研究关联", rows: "明细", medians: "同业中位数", errors: "数据缺口", available: "可用", model_type: "模型方法", model: "模型", title: "标题", version: "版本", reason: "说明", peer_symbols: "同业标的", peer_median: "同业中位数", target_metric: "公司指标", metric: "指标", implied_equity_value: "隐含股权价值", formula: "公式", shares_outstanding: "总股本", cash: "现金", debt: "负债", fcf_margin: "自由现金流率", revenue_growth: "收入增速", years: "预测年数", target_price: "市场价格", implied_growth: "隐含增长率", research_checklist: "研究清单", risk_dimensions: "风险维度", paired_comparison: "跨市场对比", disclosure_languages: "披露语言", timezone: "时区", static_info: "公司资料", insights: "研究数据", reports: "财务报表", statement: "报表", period: "期间", value: "数值", price: "价格", last_done: "最新价", pe_ttm_ratio: "市盈率 TTM", pb_ratio: "市净率", total_market_value: "总市值", annualized_volatility: "年化波动率", max_drawdown: "最大回撤", beta: "贝塔", sharpe_ratio: "夏普比率", portfolio_return: "组合收益率", benchmark_return: "基准收益率", country_listing: "上市地", thesis_risk: "研究风险", calculation: "计算", input: "输入", saved_model: "已保存模型",
};

export function labDataLabel(key: string, language: AppLanguage): string {
  return language === "zh" && dataLabels[key] ? dataLabels[key] : key.replace(/_/g, " ").replace(/^./, (value) => value.toUpperCase());
}
