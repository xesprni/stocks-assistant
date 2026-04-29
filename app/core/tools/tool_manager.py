"""工具管理器

负责工具的注册、实例化和列表管理。
内置工具直接加载，自定义工具可从指定目录动态加载。
"""

import importlib
import importlib.util
import os
from pathlib import Path
from typing import Dict, List, Optional

import logging

from app.core.tools.base_tool import BaseTool

logger = logging.getLogger("stocks-assistant.tools")


class ToolManager:
    """工具管理器

    管理所有已注册的工具类，支持内置工具加载和自定义目录扫描。
    """

    def __init__(self, workspace_dir: Optional[str] = None):
        self.tool_classes: Dict[str, type] = {}  # 工具名称 -> 工具类映射
        self.tool_configs: Dict[str, dict] = {}  # 工具名称 -> 工具配置映射
        self.workspace_dir = workspace_dir

    def load_builtin_tools(self, memory_manager=None):
        """加载所有内置工具

        内置工具包括：bash、web_search、web_fetch、read_file、write_file、
        memory_search、memory_get、scheduler。
        """
        from app.core.tools.bash import BashTool
        from app.core.tools.web_search import WebSearchTool
        from app.core.tools.web_fetch import WebFetchTool
        from app.core.tools.read_file import ReadFileTool
        from app.core.tools.write_file import WriteFileTool
        from app.core.tools.memory_search import MemorySearchTool
        from app.core.tools.memory_get import MemoryGetTool
        from app.core.tools.scheduler.tool import SchedulerTool

        builtin = [BashTool, WebSearchTool, WebFetchTool, ReadFileTool, WriteFileTool]

        if memory_manager:
            builtin.append(MemorySearchTool)
            builtin.append(MemoryGetTool)

        for cls in builtin:
            try:
                inst = cls()
                self.tool_classes[inst.name] = cls
                logger.debug(f"Loaded tool: {inst.name}")
            except Exception as e:
                logger.warning(f"Failed to load tool {cls.__name__}: {e}")

        try:
            inst = SchedulerTool()
            self.tool_classes[inst.name] = SchedulerTool
        except Exception as e:
            logger.warning(f"Failed to load SchedulerTool: {e}")

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
                            inst = cls()
                            self.tool_classes[inst.name] = cls
                        except Exception as e:
                            logger.warning(f"Failed to load tool from {py_file}: {e}")

    def get_all_tools(self) -> List[BaseTool]:
        """获取所有已注册工具的实例列表"""
        tools = []
        for name, cls in self.tool_classes.items():
            try:
                inst = cls()
                if name in self.tool_configs:
                    inst.config = self.tool_configs[name]
                tools.append(inst)
            except Exception:
                pass
        return tools

    def create_tool(self, name: str) -> Optional[BaseTool]:
        tool_class = self.tool_classes.get(name)
        if tool_class:
            inst = tool_class()
            if name in self.tool_configs:
                inst.config = self.tool_configs[name]
            return inst
        return None

    def get_tool(self, name: str) -> Optional[BaseTool]:
        return self.create_tool(name)

    def list_tools(self) -> dict:
        result = {}
        for name, tool_class in self.tool_classes.items():
            inst = tool_class()
            result[name] = {"description": inst.description, "parameters": inst.get_json_schema()}
        return result

    def get_tool_schemas_for_llm(self) -> list:
        schemas = []
        for name in self.tool_classes:
            inst = self.tool_classes[name]()
            schemas.append({
                "type": "function",
                "function": {
                    "name": inst.name,
                    "description": inst.description,
                    "parameters": inst.params,
                },
            })
        return schemas
