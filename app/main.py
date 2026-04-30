"""FastAPI 应用入口

服务启动时通过 lifespan 初始化工作空间目录和日志系统。
所有 API 路由通过 app.api.router 统一注册。
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.config import get_settings
from app.core.logging import setup_logging
from app.api import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理

    启动时：
    - 初始化日志系统
    - 创建工作空间子目录（memory/knowledge/skills）
    - 确保 MEMORY.md 文件存在
    """
    settings = get_settings()
    setup_logging()

    # 确保工作空间子目录存在
    workspace = Path(settings.workspace_dir).expanduser()
    (workspace / "memory").mkdir(parents=True, exist_ok=True)  # 记忆文件目录
    (workspace / "knowledge").mkdir(parents=True, exist_ok=True)  # 知识库目录
    (workspace / "skills").mkdir(parents=True, exist_ok=True)  # 技能文件目录

    # 确保主记忆文件存在
    memory_file = workspace / "MEMORY.md"
    if not memory_file.exists():
        memory_file.write_text("")

    # 初始化 MCP 服务器连接（后台异步执行，不阻塞启动）
    if settings.mcp_servers:
        import asyncio
        import logging
        from app.deps import get_mcp_manager

        mcp_logger = logging.getLogger("stocks-assistant.mcp")
        manager = get_mcp_manager()
        # 更新 manager 的配置（可能在运行时被 config API 更新）
        manager.server_configs = settings.mcp_servers
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(manager.connect_all())
            mcp_logger.info(f"Scheduled MCP connection for {len(settings.mcp_servers)} server(s)")
        except RuntimeError:
            mcp_logger.warning("No event loop available for MCP initialization")

    yield


app = FastAPI(
    title="Stocks Assistant",
    description="基于 FastAPI 的 AI Agent 服务，支持长期记忆、知识库、技能系统和工具调用",
    version="0.1.0",
    lifespan=lifespan,
)

# 注册所有 API 路由
app.include_router(router)


@app.get("/api/v1/health")
async def health():
    """健康检查接口"""
    return {"status": "ok"}
