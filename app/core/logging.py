"""日志系统配置

提供统一的日志格式和初始化接口。
所有模块使用 "stocks-assistant" 作为 logger 命名空间。
"""

import logging
import sys


def setup_logging(debug: bool = False) -> logging.Logger:
    """初始化全局日志配置

    Args:
        debug: 是否启用 DEBUG 级别（默认 INFO）

    Returns:
        根 logger 实例
    """
    logger = logging.getLogger("stocks-assistant")
    logger.setLevel(logging.DEBUG if debug else logging.INFO)

    # 避免重复添加 handler（热重载场景）
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        logger.addHandler(handler)

    return logger


def get_logger(name: str = "") -> logging.Logger:
    """获取子模块 logger

    Args:
        name: 子模块名称，如 ".agent" -> "stocks-assistant.agent"
    """
    return logging.getLogger(f"stocks-assistant{name}")
