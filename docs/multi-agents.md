# 多 Agent 委派与协作

`delegate_agent` 支持独立任务并行、超额任务排队，以及按依赖关系自动执行后续审查/汇总。主 Agent 保持最终答案的责任，子 Agent 返回结论、来源和产物引用。

## 调用示例

旧的 `{"tasks": [{"role": "researcher", "task": "..."}]}` 仍然有效。新增的 `shared_context` 和 `depends_on` 均为可选字段。

```json
{
  "shared_context": "研究目标：评估某公司的经营质量。使用主任务已经获取的同一财报快照和来源，区分事实与推断。将数据时间、单位、来源链接和必要数据放在这里；子任务不自动继承聊天历史。",
  "tasks": [
    {
      "id": "fundamentals",
      "role": "fundamental_analyst",
      "task": "分析收入、利润和现金流质量，列出有来源支持的结论及缺失证据。"
    },
    {
      "id": "events",
      "role": "researcher",
      "task": "核对公司披露与关键事件，给出来源、发生时间和影响范围。"
    },
    {
      "id": "review",
      "role": "risk_critic",
      "depends_on": ["fundamentals", "events"],
      "task": "审查前述结论的证据、冲突、假设和风险；指出哪些结论还不能成立。",
      "max_steps": 4
    }
  ]
}
```

前两个任务可并行执行；两者成功后 `review` 才开始，并收到它所依赖的公开结果、来源和图像产物路径。依赖可以指向本批次中前后任意位置的任务，但不能形成环。

## 运行边界

| 配置 | 默认值 | 范围与含义 |
| --- | --- | --- |
| `multi_agent_max_parallel_agents` | 3 | 1–8；同一次主 Agent 运行中的全部委派批次共享，不能通过多个工具调用叠加突破 |
| `multi_agent_max_tasks_per_batch` | 12 | 1–32；一批最多提交的任务数量，超出并发数会排队 |
| `multi_agent_task_timeout_seconds` | 180 | 10–1800；每个子任务获得运行许可后开始计时，排队不消耗这段执行时间 |
| `multi_agent_default_max_steps` | 8 | 1–100；角色可进一步指定步数，调用参数只能缩小角色步数 |
| `multi_agent_max_depth` | 1 | 0–1；0 禁止委派，子 Agent 始终不能再次调用 `delegate_agent` |

个人配置支持并发数、批次容量和执行超时，设置页和角色编排页均可修改。保存非法数值会返回明确校验错误。主 Agent 提示词只列出当前实际可用且符合角色策略的工具。

整批排队还有一个保护期限：从提交开始，最长为“任务数 × 单任务超时”。到期时尚未开始的任务标为超时；已经开始的任务仍保留其完整执行时限。这样既不缩短已启动任务的预算，也不会在所有许可被占用时永久排队。

## 状态与取消

- `success`：子任务完成。
- `error`：子任务运行失败。
- `timeout`：执行期限或排队期限已到。
- `cancelled`：主任务停止或局部取消。
- `skipped`：某个依赖未成功，任务不再启动。

独立分支继续运行，失败只会跳过依赖它的后续任务。整批结果保留请求顺序与每一个任务状态，附带各状态的 `counts`。全部失败时工具返回错误；部分成功时返回 `partial_error`，由主 Agent 根据可用证据继续汇总。不会自动重试可能已经执行过写操作的任务。

点击停止会将信号传给全部子 Agent，并阻止排队任务启动。超时或取消后，调度器不等待卡住的同步调用；该任务的后续事件被关闭，避免迟到的文本或工具事件污染已结束批次。已经完成的结果优先收集，不会被同时到来的取消覆盖。

取消是协作式的：Python 线程不能安全地被强制终止，已发出的同步模型/外部工具调用仍可能等到底层 I/O 超时。它们恢复后会检查停止信号，不再开始后续模型轮次或工具调用；并发许可直到线程实际退出才释放。不能将 `timeout` 理解为外部操作已经回滚。

## 上下文、权限与结果

子任务不会自动复制父对话和私有推理。通过 `shared_context` 明确提供研究目标、约束、来源、数据时间和同一数据快照，避免重复抓取及混用数据。输入共享上下文上限 24000 字符，单项任务说明上限 16000 字符。

依赖结果在注入下游前也经过有界整理。整批结论共享 18000 字符预算，单任务最多 6000 字符；证据、来源和图像引用聚合去重后最多 16000 个 JSON 字符；整理后的结果与元数据整体不超过 46000 个 JSON 字符，为工具协议外层留出空间。所有任务仍保留，截断通过 `response_truncated`、`references_truncated`、`metadata_truncated` 及数量字段说明，不会静默丢掉尾部任务。

子 Agent 的来源与证据会汇总到主任务，已生成图片会通过产物引用进入主模型上下文和聊天预览。成功任务及失败前已取得的元数据均可保留；即使子任务随后卡住、超时或取消，有效期内已返回成功工具事件的来源与图片引用也会保留，任务仍标为超时或取消。取消不会覆盖已经完成任务的状态或引用。主任务正常完成后的产物沿用会话历史持久化；取消后的 UI 与历史处理仍沿用聊天运行机制。

权限采用父工具集合、角色 allowlist、角色 MCP 策略和危险工具策略共同约束。工具副本保留当前用户 service/settings，复制可变配置并清除单次执行字段，不重复执行构造函数。技能过滤默认继承父范围，显式过滤必须是父范围的子集；`None` 表示不额外限制，`[]` 明确表示不允许任何技能。

## 实现与测试

- `app/core/agent/subagent.py`：依赖队列、并发许可、生命周期、停止与超时。
- `app/core/agent/delegation_runtime.py`：主任务共享容量、组合取消信号。
- `app/core/agent/delegation_graph.py` / `app/schemas/delegation.py`：严格参数和完整依赖图校验。
- `app/core/agent/delegation_results.py`：摘要预算、元数据去重与截断声明。
- `app/core/tracing/recorder.py`：排队节点复用及完整终态记录。

```bash
uv run pytest tests/test_multi_agent.py tests/test_delegation_scheduler.py tests/test_delegation_runtime.py tests/test_delegation_partial_metadata.py tests/test_delegation_results.py tests/test_multi_agent_tracing.py tests/test_multi_agent_config.py
bash scripts/check_backend.sh
cd frontend
npm run build
node --test tests/*.test.mjs
```

测试使用模型/工具替身，覆盖跨批次并发、依赖传递、整批预检、权限收窄、失败分支、超时与迟到事件、取消/完成竞争、完整来源与图像链路、长结果预算和前端状态展示，不会触发真实模型付费调用。
