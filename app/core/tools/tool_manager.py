"""工具管理器

负责工具的注册、实例化和列表管理。
内置工具直接加载，自定义工具可从指定目录动态加载。
"""

from __future__ import annotations

import importlib.util
import logging
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

from app.core.tools.base_tool import BaseTool
from app.core.tools.builtin_registry import builtin_factories

if TYPE_CHECKING:
    from app.config import Settings

logger = logging.getLogger("stocks-assistant.tools")


class ToolManager:
    """工具管理器

    管理所有已注册的工具类，支持内置工具加载和自定义目录扫描。
    """

    def __init__(self, workspace_dir: str | None = None, user_id: str | None = None):
        self.tool_classes: dict[str, type] = {}  # 工具名称 -> 工具类映射
        self.tool_configs: dict[str, dict] = {}  # 工具名称 -> 工具配置映射
        self.workspace_dir = workspace_dir
        self.user_id = user_id
        self.memory_manager = None
        self.settings: Settings | None = None
        self._tool_factories: dict[type[BaseTool], Callable[[], BaseTool]] = {}

    def load_builtin_tools(
        self,
        memory_manager=None,
        user_id: str | None = None,
        settings: Settings | None = None,
    ) -> None:
        """加载所有内置工具

        内置工具包括：bash、web_search、web_fetch、read_file、write_file、
        financial_reports、market_data、portfolio_positions、portfolio、watchlist、memory_search、memory_get、scheduler。
        """
        if memory_manager:
            self.memory_manager = memory_manager
        if user_id is not None:
            self.user_id = user_id
        if settings is not None:
            # 同一 Agent 的模型和工具必须共享配置快照，不能重新读取并混用新旧配置。
            self.settings = settings
        else:
            try:
                from app.config import get_effective_settings, get_settings

                self.settings = (
                    get_effective_settings(self.user_id)
                    if self.user_id is not None
                    else get_settings()
                )
            except Exception as exc:
                logger.warning("Failed to load tool settings: %s", exc)
                self.settings = None

        self._tool_factories.update(builtin_factories(self))
        for cls in self._tool_factories:
            self.tool_classes[cls.name] = cls
            logger.debug("Loaded tool: %s", cls.name)

    def load_tools_from_directory(self, tools_dir: str):
        """从指定目录动态加载工具（扫描 .py 文件中的 BaseTool 子类）"""
        tools_path = Path(tools_dir)
        for py_file in tools_path.rglob("*.py"):
            if py_file.name in ("__init__.py", "base_tool.py", "tool_manager.py"):
                continue
            spec = importlib.util.spec_from_file_location(py_file.stem, py_file)
            if spec and spec.loader:
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                for attr_name in dir(module):
                    cls = getattr(module, attr_name)
                    if isinstance(cls, type) and issubclass(cls, BaseTool) and cls is not BaseTool:
                        try:
                            inst = self._instantiate_tool(cls)
                            self.tool_classes[inst.name] = cls
                        except Exception as e:
                            logger.warning("Failed to load tool from %s: %s", py_file, e)

    def get_all_tools(self) -> list[BaseTool]:
        """获取所有已注册工具的实例列表"""
        tools = []
        for name in self.tool_classes:
            try:
                inst = self.create_tool(name)
                if inst is not None:
                    tools.append(inst)
            except Exception as exc:
                logger.warning("Failed to create tool %s: %s", name, exc)
        return tools

    def create_tool(self, name: str) -> BaseTool | None:
        tool_class = self.tool_classes.get(name)
        if tool_class:
            inst = self._instantiate_tool(tool_class)
            if name in self.tool_configs:
                inst.config = self.tool_configs[name]
            return inst
        return None

    def get_tool(self, name: str) -> BaseTool | None:
        return self.create_tool(name)

    def _schema_source(self, tool_class: type[BaseTool]) -> type[BaseTool] | BaseTool:
        # 内置元数据为类属性；动态工具仍允许在构造函数中设置实例元数据。
        return (
            tool_class if tool_class in self._tool_factories else self._instantiate_tool(tool_class)
        )

    def list_tools(self) -> dict:
        return {
            name: {"description": tool.description, "parameters": tool.get_json_schema()}
            for name, cls in self.tool_classes.items()
            for tool in [self._schema_source(cls)]
        }

    def get_tool_schemas_for_llm(self) -> list:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.params,
                },
            }
            for cls in self.tool_classes.values()
            for tool in [self._schema_source(cls)]
        ]

    def _instantiate_tool(self, tool_class: type[BaseTool]) -> BaseTool:
        factory = self._tool_factories.get(tool_class)
        return factory() if factory is not None else tool_class()
