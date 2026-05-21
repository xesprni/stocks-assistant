"""API 路由聚合

将所有子模块路由统一注册到 /api/v1 前缀下：
- /agent    - Agent 对话（同步/SSE 流式）
- /memory   - 记忆系统（搜索/添加/同步/状态）
- /knowledge - 知识库（目录树/内容/图谱）
- /skills   - 技能系统（列表/切换/刷新）
- /tools    - 工具系统（列表/执行）
- /scheduler - 调度系统（任务 CRUD）
- /config   - 应用配置管理
- /watchlist - 本地自选股列表
- /portfolio - 本地持仓列表
- /market   - 行情监控（指数/个股报价、配置）
- /fundamentals - 基本面财报数据
- /tracing - Agent 调用链追踪
"""

from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.agent import router as agent_router
from app.api.memory import router as memory_router
from app.api.knowledge import router as knowledge_router
from app.api.skills import router as skills_router
from app.api.tools import router as tools_router
from app.api.scheduler import router as scheduler_router
from app.api.config import router as config_router
from app.api.watchlist import router as watchlist_router
from app.api.portfolio import router as portfolio_router
from app.api.market import router as market_router
from app.api.fundamentals import router as fundamentals_router
from app.api.mcp import router as mcp_router
from app.api.tracing import router as tracing_router
from app.api.users import router as users_router
from app.api.roles import router as roles_router

router = APIRouter(prefix="/api/v1")

router.include_router(auth_router, prefix="/auth", tags=["auth"])
router.include_router(agent_router, prefix="/agent", tags=["agent"])
router.include_router(memory_router, prefix="/memory", tags=["memory"])
router.include_router(knowledge_router, prefix="/knowledge", tags=["knowledge"])
router.include_router(skills_router, prefix="/skills", tags=["skills"])
router.include_router(tools_router, prefix="/tools", tags=["tools"])
router.include_router(scheduler_router, prefix="/scheduler", tags=["scheduler"])
router.include_router(config_router, prefix="/config", tags=["config"])
router.include_router(watchlist_router, prefix="/watchlist", tags=["watchlist"])
router.include_router(portfolio_router, prefix="/portfolio", tags=["portfolio"])
router.include_router(market_router, prefix="/market", tags=["market"])
router.include_router(fundamentals_router, prefix="/fundamentals", tags=["fundamentals"])
router.include_router(mcp_router, prefix="/mcp", tags=["mcp"])
router.include_router(tracing_router, prefix="/tracing", tags=["tracing"])
router.include_router(users_router, prefix="/users", tags=["users"])
router.include_router(roles_router, prefix="/roles", tags=["roles"])
