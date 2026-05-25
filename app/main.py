"""FastAPI 应用入口

服务启动时通过 lifespan 初始化工作空间目录和日志系统。
所有 API 路由通过 app.api.router 统一注册。
"""

from contextlib import asynccontextmanager
import logging
from pathlib import Path
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.core.app_store import get_app_store
from app.core.security import AuthError, bearer_from_header, decode_access_token
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
    setup_logging(debug=settings.debug)

    # 确保工作空间子目录存在
    workspace = Path(settings.workspace_dir).expanduser()
    (workspace / "memory").mkdir(parents=True, exist_ok=True)  # 记忆文件目录
    (workspace / "knowledge").mkdir(parents=True, exist_ok=True)  # 知识库目录
    (workspace / "skills").mkdir(parents=True, exist_ok=True)  # 技能文件目录

    # 确保主记忆文件存在
    memory_file = workspace / "MEMORY.md"
    if not memory_file.exists():
        memory_file.write_text("")

    # 启动定时任务调度器
    scheduler_service = None
    if settings.scheduler_enabled:
        from app.deps import get_scheduler_service

        scheduler_service = get_scheduler_service()
        await scheduler_service.start()

    # 初始化 MCP 服务器连接（只调度后台任务，不阻塞服务启动）
    mcp_manager = None
    if settings.mcp_servers:
        import logging
        from app.deps import get_mcp_manager

        mcp_logger = logging.getLogger("stocks-assistant.mcp")
        mcp_manager = get_mcp_manager()
        # 更新 manager 的配置（可能在运行时被 config API 更新）
        mcp_manager.server_configs = settings.mcp_servers
        try:
            mcp_manager.connect_all_background()
            mcp_logger.info(f"Scheduled MCP background connection for {len(settings.mcp_servers)} server(s)")
        except Exception as exc:
            mcp_logger.warning(f"MCP background initialization failed: {exc}")

    try:
        yield
    finally:
        if scheduler_service is not None:
            await scheduler_service.stop()
        if mcp_manager is not None:
            mcp_manager.close_sync()


app = FastAPI(
    title="Stocks Assistant",
    description="基于 FastAPI 的 AI Agent 服务，支持长期记忆、知识库、技能系统和工具调用",
    version="0.1.0",
    lifespan=lifespan,
)

# 注册所有 API 路由
app.include_router(router)


PUBLIC_API_PATHS = {
    "/api/v1/health",
    "/api/v1/auth/setup/status",
    "/api/v1/auth/setup",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
}


def _is_public_api_path(path: str) -> bool:
    if path in PUBLIC_API_PATHS:
        return True
    return path.startswith("/api/v1/mcp/oauth/callback/")


@app.middleware("http")
async def enforce_api_auth(request: Request, call_next):
    """Require JWT auth for all API routes except explicit public endpoints."""
    path = request.url.path
    if request.method == "OPTIONS" or not path.startswith("/api/") or _is_public_api_path(path):
        return await call_next(request)

    store = get_app_store()
    if not store.has_users():
        return JSONResponse(
            {"detail": "Setup required", "setup_required": True},
            status_code=503,
        )

    token = bearer_from_header(request.headers.get("authorization"))
    if not token:
        return JSONResponse(
            {"detail": "Authentication required"},
            status_code=401,
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        request.state.current_user = decode_access_token(token)
    except AuthError as exc:
        return JSONResponse(
            {"detail": str(exc) or "Invalid token"},
            status_code=401,
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await call_next(request)


@app.middleware("http")
async def log_api_requests(request: Request, call_next):
    """Log API request completion with status and latency."""
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)

    start = time.perf_counter()
    logger = logging.getLogger("stocks-assistant.http")
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.exception("HTTP %s %s failed after %.1fms", request.method, path, elapsed_ms)
        raise

    if path != "/api/v1/health":
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info("HTTP %s %s -> %s %.1fms", request.method, path, response.status_code, elapsed_ms)
    return response


@app.get("/api/v1/health")
async def health():
    """健康检查接口"""
    return {"status": "ok"}
