"""Pure dependency validation, separate from tool permissions and thread scheduling."""

from app.schemas.delegation import DelegatedTask


def validate_task_graph(tasks: list[DelegatedTask]) -> list[str]:
    task_ids = [task.id or f"task_{index + 1}" for index, task in enumerate(tasks)]
    if len(set(task_ids)) != len(task_ids):
        raise ValueError("Task ids must be unique, including generated task_N ids")
    graph = {task_id: set(task.depends_on) for task_id, task in zip(task_ids, tasks, strict=True)}
    for task_id, dependencies in graph.items():
        unknown = dependencies - graph.keys()
        if unknown:
            raise ValueError(
                f"Task {task_id} has unknown dependencies: {', '.join(sorted(unknown))}"
            )
        if task_id in dependencies:
            raise ValueError(f"Task {task_id} cannot depend on itself")
    # 拓扑校验先于启动任何工具，拒绝隐式等待死锁；输入顺序不影响依赖合法性。
    resolved: set[str] = set()
    while len(resolved) < len(graph):
        ready = {
            task_id
            for task_id, dependencies in graph.items()
            if task_id not in resolved and dependencies <= resolved
        }
        if not ready:
            raise ValueError("Task dependencies contain a cycle")
        resolved.update(ready)
    return task_ids
