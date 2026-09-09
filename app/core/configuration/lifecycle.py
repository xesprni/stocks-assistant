"""应用退出的资源编排，覆盖运行期间才启用的依赖。"""

import asyncio


async def shutdown_runtime() -> None:
    from app import deps
    from app.core.agent.run_service import chat_runs
    from app.core.llm.provider import close_llm_client_pool

    try:
        await asyncio.to_thread(chat_runs.close)
    finally:
        try:
            if deps.get_scheduler_service.cache_info().currsize:
                await deps.get_scheduler_service().stop()
        finally:
            try:
                await asyncio.to_thread(deps.close_mcp_managers)
            finally:
                # 一个依赖关闭失败也不能跳过其余资源；连接池等待在途租约释放。
                await asyncio.to_thread(close_llm_client_pool)
                deps.clear_llm_provider_cache()
                deps.get_llm_provider.cache_clear()
                deps.get_memory_llm_provider.cache_clear()
                deps.get_memory_manager.cache_clear()
                deps.get_memory_manager_for_user.cache_clear()
                deps.get_scheduler_service.cache_clear()
