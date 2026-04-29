"""API 路由聚合

将所有子模块路由统一注册到 /api/v1 前缀下：
- /agent    - Agent 对话（同步/SSE 流式）
- /memory   - 记忆系统（搜索/添加/同步/状态）
- /knowledge - 知识库（目录树/内容/图谱）
- /skills   - 技能系统（列表/切换/刷新）
- /tools    - 工具系统（列表/执行）
- /scheduler - 调度系统（任务 CRUD）
- /config   - 应用配置管理
"""

from fastapi import APIRouter

from app.api.agent import router as agent_router
from app.api.memory import router as memory_router
from app.api.knowledge import router as knowledge_router
from app.api.skills import router as skills_router
from app.api.tools import router as tools_router
from app.api.scheduler import router as scheduler_router
from app.api.config import router as config_router

router = APIRouter(prefix="/api/v1")

router.include_router(agent_router, prefix="/agent", tags=["agent"])
router.include_router(memory_router, prefix="/memory", tags=["memory"])
router.include_router(knowledge_router, prefix="/knowledge", tags=["knowledge"])
router.include_router(skills_router, prefix="/skills", tags=["skills"])
router.include_router(tools_router, prefix="/tools", tags=["tools"])
router.include_router(scheduler_router, prefix="/scheduler", tags=["scheduler"])
router.include_router(config_router, prefix="/config", tags=["config"])
