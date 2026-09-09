"""工具结果元数据的唯一规范化边界；不携带私有图片字节。"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any

METADATA_GROUPS = ("evidence", "sources", "rendered_images")
ARTIFACT_FIELDS = ("artifact_id", "width", "height", "files")


def unique_metadata_items(values: Iterable[Mapping[str, Any]], group: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for value in values:
        raw = value.get(group)
        if not isinstance(raw, list):
            continue
        for item in raw:
            if not isinstance(item, dict):
                continue
            identifier = item.get("artifact_id" if group == "rendered_images" else "id")
            if group == "rendered_images" and not isinstance(identifier, str):
                continue
            item_id = str(identifier or "")
            if not item_id or item_id in seen:
                continue
            seen.add(item_id)
            if group == "rendered_images":
                # 图像只跨越执行边界传引用，HTML、数据快照与二进制留在工具内部。
                item = {key: item[key] for key in ARTIFACT_FIELDS if key in item}
            items.append(deepcopy(item))
    return items


@dataclass
class ToolResultMetadata:
    evidence: list[dict[str, Any]] = field(default_factory=list)
    sources: list[dict[str, Any]] = field(default_factory=list)
    rendered_images: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def merge(cls, *values: Mapping[str, Any]) -> ToolResultMetadata:
        return cls(**{group: unique_metadata_items(values, group) for group in METADATA_GROUPS})

    def as_dict(self) -> dict[str, list[dict[str, Any]]]:
        return {group: deepcopy(getattr(self, group)) for group in METADATA_GROUPS}


def normalize_tool_metadata(
    *, status: str, result: Any, metadata: Any, tool_name: str = ""
) -> dict[str, list[dict[str, Any]]]:
    value = dict(metadata) if isinstance(metadata, Mapping) else {}
    partial = value.get("preserve_partial") is True
    # 旧第三方/已保存测试工具协议集中适配；新工具直接返回元数据，不再影响执行器。
    partial = partial or tool_name == "delegate_agent"
    if status == "success" and tool_name == "render_image" and isinstance(result, dict):
        images = value.get("rendered_images")
        value["rendered_images"] = [*(images if isinstance(images, list) else []), result]
    if status != "success" and not partial:
        value["rendered_images"] = []
    return ToolResultMetadata.merge(value).as_dict()
