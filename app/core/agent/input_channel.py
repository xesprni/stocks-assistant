"""主会话在模型调用边界接收补充输入的最小协议。"""

from typing import Any, Protocol


class AgentInputChannel(Protocol):
    def drain(self, close: bool = False) -> list[dict[str, Any]]:
        """原子取出待应用输入；达到执行上限时同时关闭接收。"""
        ...

    def finish(self) -> list[dict[str, Any]]:
        """取出结束前到达的输入；仅当没有待处理输入时原子关闭接收。"""
        ...
