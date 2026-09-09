"""Explicit built-in tool factories with lazy runtime dependency injection."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from app.core.tools.base_tool import BaseTool

if TYPE_CHECKING:
    from app.core.tools.tool_manager import ToolManager


def builtin_factories(manager: ToolManager) -> dict[type[BaseTool], Callable[[], BaseTool]]:
    from app.core.tools.bash import BashTool
    from app.core.tools.delegate_agent import DelegateAgentTool
    from app.core.tools.financial_reports import GetFinancialReportsTool
    from app.core.tools.investment_labs import GetInvestmentLabsTool
    from app.core.tools.knowledge_get import KnowledgeGetTool
    from app.core.tools.knowledge_search import KnowledgeSearchTool
    from app.core.tools.market_data import (
        GetLongbridgeCandlesticksTool,
        GetLongbridgeCapitalFlowTool,
        GetLongbridgeDepthTool,
        GetLongbridgeHistoryCandlesticksTool,
        GetLongbridgeIntradayTool,
        GetLongbridgeMarketStatusTool,
        GetLongbridgeQuoteIndicatorsTool,
        GetLongbridgeRealtimeQuotesTool,
        GetLongbridgeTechnicalIndicatorsTool,
        GetLongbridgeTradesTool,
        GetLongbridgeTradingDaysTool,
    )
    from app.core.tools.memory_get import MemoryGetTool
    from app.core.tools.memory_search import MemorySearchTool
    from app.core.tools.portfolio import PortfolioTool
    from app.core.tools.portfolio_positions import GetPortfolioPositionsTool
    from app.core.tools.read_file import ReadFileTool
    from app.core.tools.read_skill import ReadSkillTool
    from app.core.tools.render_image import RenderImageTool
    from app.core.tools.research_context import GetResearchContextTool
    from app.core.tools.research_data import GetSecurityInsightsTool, GetSecurityNewsTool
    from app.core.tools.scheduler.tool import SchedulerTool
    from app.core.tools.view_image import ViewImageTool
    from app.core.tools.watchlist import WatchlistTool
    from app.core.tools.web_fetch import WebFetchTool
    from app.core.tools.web_search import WebSearchTool
    from app.core.tools.write_file import WriteFileTool

    def with_settings(cls: Callable[..., BaseTool]) -> Callable[[], BaseTool]:
        return lambda: cls(settings=manager.settings)

    def with_user_settings(cls: Callable[..., BaseTool]) -> Callable[[], BaseTool]:
        return lambda: cls(user_id=manager.user_id, settings=manager.settings)

    def with_memory(cls: Callable[..., BaseTool]) -> Callable[[], BaseTool]:
        return lambda: cls(memory_manager=manager.memory_manager, user_id=manager.user_id)

    def scheduler() -> BaseTool:
        from app.deps import get_scheduler_service

        return SchedulerTool(scheduler_service=get_scheduler_service(), user_id=manager.user_id)

    # 按原顺序注册；工厂真正调用时才读取用户依赖，列出 schema 不初始化运行服务。
    factories: dict[type[BaseTool], Callable[[], BaseTool]] = {
        BashTool: lambda: BashTool(
            config={"cwd": manager.workspace_dir} if manager.workspace_dir else {}
        ),
        WebSearchTool: lambda: WebSearchTool(
            config={
                "api_url": getattr(manager.settings, "search_api_url", ""),
                "api_key": getattr(manager.settings, "search_api_key", ""),
            }
        ),
        WebFetchTool: WebFetchTool,
        ReadFileTool: lambda: ReadFileTool(workspace_dir=manager.workspace_dir or "."),
        ReadSkillTool: ReadSkillTool,
        WriteFileTool: lambda: WriteFileTool(workspace_dir=manager.workspace_dir or "."),
        RenderImageTool: lambda: RenderImageTool(workspace_dir=manager.workspace_dir or "."),
        ViewImageTool: lambda: ViewImageTool(workspace_dir=manager.workspace_dir or "."),
        GetFinancialReportsTool: with_settings(GetFinancialReportsTool),
        GetSecurityNewsTool: with_settings(GetSecurityNewsTool),
        GetSecurityInsightsTool: with_settings(GetSecurityInsightsTool),
        GetResearchContextTool: lambda: GetResearchContextTool(user_id=manager.user_id),
        GetInvestmentLabsTool: with_user_settings(GetInvestmentLabsTool),
        GetLongbridgeRealtimeQuotesTool: with_user_settings(GetLongbridgeRealtimeQuotesTool),
        GetLongbridgeHistoryCandlesticksTool: with_user_settings(
            GetLongbridgeHistoryCandlesticksTool
        ),
        GetLongbridgeCandlesticksTool: with_user_settings(GetLongbridgeCandlesticksTool),
        GetLongbridgeIntradayTool: with_user_settings(GetLongbridgeIntradayTool),
        GetLongbridgeCapitalFlowTool: with_user_settings(GetLongbridgeCapitalFlowTool),
        GetLongbridgeTradesTool: with_user_settings(GetLongbridgeTradesTool),
        GetLongbridgeDepthTool: with_user_settings(GetLongbridgeDepthTool),
        GetLongbridgeMarketStatusTool: with_user_settings(GetLongbridgeMarketStatusTool),
        GetLongbridgeTradingDaysTool: with_user_settings(GetLongbridgeTradingDaysTool),
        GetLongbridgeQuoteIndicatorsTool: with_user_settings(GetLongbridgeQuoteIndicatorsTool),
        GetLongbridgeTechnicalIndicatorsTool: with_user_settings(
            GetLongbridgeTechnicalIndicatorsTool
        ),
        GetPortfolioPositionsTool: with_user_settings(GetPortfolioPositionsTool),
        PortfolioTool: with_user_settings(PortfolioTool),
        WatchlistTool: with_user_settings(WatchlistTool),
        DelegateAgentTool: DelegateAgentTool,
    }
    if manager.memory_manager:
        for cls in (MemorySearchTool, MemoryGetTool, KnowledgeSearchTool, KnowledgeGetTool):
            factories[cls] = with_memory(cls)
    factories[SchedulerTool] = scheduler
    return factories
