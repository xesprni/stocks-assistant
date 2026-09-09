"""Shared, parameterized scope predicates for memory search backends."""

from collections.abc import Sequence


def scope_filter(
    user_id: str | None,
    scopes: Sequence[str] | None,
    *,
    qualified: bool = False,
) -> tuple[str, list[str]]:
    selected = list(scopes) if scopes is not None else ["shared"] + (["user"] if user_id else [])
    if not selected:
        return "0", []
    # 列名前缀只能由调用方式选择；scope 和 user_id 均绑定参数，避免拼接外部值。
    prefix = "chunks." if qualified else ""
    placeholders = ",".join("?" for _ in selected)
    predicate = f"{prefix}scope IN ({placeholders})"
    if user_id:
        predicate += f" AND ({prefix}scope='shared' OR {prefix}user_id=?)"
        selected.append(user_id)
    return predicate, selected
