import capitalFlow from "./capitalFlow";
import chat from "./chat";
import chatController from "./chatController";
import chatRun from "./chatRun";
import chipCopy from "./chipCopy";
import company from "./company";
import dashboard from "./dashboard";
import financialReports from "./financialReports";
import knowledge from "./knowledge";
import marketConfig from "./marketConfig";
import mcp from "./mcp";
import memory from "./memory";
import passwordCopy from "./passwordCopy";
import portfolio from "./portfolio";
import portfolioCharts from "./portfolioCharts";
import scheduler from "./scheduler";
import securityCopy from "./securityCopy";
import settings from "./settings";
import shell from "./shell";
import technicalAnalysis from "./technicalAnalysis";
import ui_chart from "./ui_chart";
import ui_chat from "./ui_chat";
import ui_chatUi from "./ui_chatUi";
import ui_common from "./ui_common";
import ui_config from "./ui_config";
import ui_groups from "./ui_groups";
import ui_markets from "./ui_markets";
import ui_nav from "./ui_nav";
import ui_newsPage from "./ui_newsPage";
import ui_overview from "./ui_overview";
import ui_shell from "./ui_shell";
import ui_skillsPage from "./ui_skillsPage";
import ui_subagents from "./ui_subagents";
import ui_watchlist from "./ui_watchlist";
import users from "./users";

import type { Messages } from "../../types";
export const en = {
  portfolio,
  shell,
  capitalFlow,
  financialReports,
  marketConfig,
  technicalAnalysis,
  chatController,
  chatRun,
  chipCopy,
  securityCopy,
  passwordCopy,
  chat,
  company,
  settings,
  dashboard,
  knowledge,
  mcp,
  memory,
  scheduler,
  users,
  portfolioCharts,
  ui: {
    nav: ui_nav,
    groups: ui_groups,
    shell: ui_shell,
    common: ui_common,
    markets: ui_markets,
    chatUi: ui_chatUi,
    watchlist: ui_watchlist,
    chart: ui_chart,
    newsPage: ui_newsPage,
    overview: ui_overview,
    chat: ui_chat,
    config: ui_config,
    subagents: ui_subagents,
    skillsPage: ui_skillsPage,
  },
} satisfies Messages;
