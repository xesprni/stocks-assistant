# 架构边界与扩展约定

本次重构保持 HTTP、SSE、数据库结构、金额精度和既有页面语义。内部扩展以明确的调用契约、事务边界和纯计算为主。

## 应用装配与生命周期

- `app/deps.py` 保留历史 `get_*` 门面，负责依赖装配；调度执行、时间上下文和通知由 `core/tools/scheduler/execution.py` 承担。
- 配置服务通过 `AppStore.apply_config_update` 将个人配置、系统配置及审计记录一次提交。提交后才刷新缓存，失败不会留下部分生效的配置。
- 有效配置缓存使用系统代次与用户代次。数据库读取期间发生失效时重新读取，迟到结果不能重新发布为当前配置；个人更新不会淘汰其他用户的配置。
- 新增配置依赖需要在 `configuration.runtime.runtime_bindings` 注册配置键和失效回调。失效表示后续获取使用新实例，不能直接关闭在途任务持有的资源。
- MCP 在获取与租借的同一临界区内登记使用者。父 Agent 和仍在收尾的子任务各自保留运行资源租约，最后一个租约释放时关闭退休实例。MemoryManager 的 SQLite 存储在最后一个对象引用释放时关闭。
- HTTP 连接池对每次调用或流式读取登记借用，退出应用时退休连接，在途读取结束后释放。Scheduler 与聊天运行管理器先发出取消信号，再有限等待任务收尾；运行期间才启用的 Scheduler 同样纳入退出清理。

## Agent 与工具扩展

调用链为 `execute_tool(params, context=None) → invoke(params, context) → execute(params)`。参数校验和错误封装仍在统一入口，历史工具只实现 `execute` 也可继续工作。

- 新工具优先实现 `invoke`，通过不可变 `ToolCallContext` 获取调用 ID、取消、事件及必要能力。长期 service 依赖放构造函数，单次调用状态放 context。兼容属性注入只留在旧工具适配边界。
- 工具并发策略按调用参数判断。明确安全的连续只读调用并行；写入、未知调用和委派调用是顺序屏障。混合读写工具需要声明哪些 action 是只读；新增工具默认顺序执行。
- 本地 Bash 使用可取消的进程组。取消后不启动排队操作，已经发生的外部效果不会被解释为已撤销。
- 工具返回结果通过统一 metadata 规范化与聚合器传递来源、证据、产物和允许保留的部分结果。新增图片工具不需要修改 Executor 的工具名称分支；图片字节保持在公开历史和追踪载荷之外。
- Provider Adapter 负责将 HTTP/code 转换为明确错误类别。Executor 只按类别选择恢复策略；上下文超限的额外裁剪重试只修改请求副本，保留工具配对，其他错误不清空原执行历史。
- Chat Completions 在请求含图片且上游明确返回 `messages.content.type` 仅允许 `text` 的 400 时，用文本副本重试一次；保留工具结果，明确告知模型图片未被查看。它不推断模型名称对应的视觉能力，也不把图片损坏、尺寸超限或其他 400 当作相同问题。

## 领域事务与查询

| 扩展点 | 约定 |
| --- | --- |
| 持仓命令 | `PortfolioRepository.sale` 在 `BEGIN IMMEDIATE` 后读取持仓和现金。校验、Decimal 计算、仓位、现金、流水属于同一工作单元，不能传入事务外计算的余额。 |
| 持仓查询 | 调用 `PortfolioService.get_local_snapshot` 获取本地数据；Dashboard 等调用方不直接访问持仓仓储。批量报价在调用方统一获取后交给估值计算器。 |
| 估值回退 | `CostBasisValuation` 保留持仓页的成本回退；`HistoricalDisplayValuation` 保留 Dashboard 历史展示值回退。只有相同策略的相同输入才要求同一结果，不能在去重时改变产品口径。 |
| 行情配置 | `MarketConfigRepository` 明确区分个人 SQLite 与无用户 legacy 文件。不存在使用默认值，存储失败返回错误，不能跨作用域降级写入。 |

## 前端状态和副作用

- `api.ts` 继续作为调用门面，`AuthSessionManager` 独占凭据与身份代次。正常续期保留身份代次；账户切换使旧请求失效。JSON、blob 和聊天流式请求共享认证边界。
- `chatRunReducer` 负责将服务端事件投影为可展示状态；`useChatRunController` 负责订阅、恢复、取消和队列接续。应用入口保留页面导航与布局。
- 自选股、分组和公司持仓查询使用领域控制器，资源键与请求代次决定回包是否仍然有效，AbortController 用于取消过时读请求。
- reducer 和 React 状态 updater 保持纯计算。写操作由命令处理器发起：删除只回滚对应实体，排序串行提交并合并最新意图，失败不能恢复整张旧快照覆盖后续成功变更。

## 验证入口

- 后端：`bash scripts/check_backend.sh`；纯辅助模块加入 `pyproject.toml` 的严格 mypy 清单。
- 前端：`cd frontend && npm test && npm run build`。Node 测试入口通过 esbuild loader 同时执行 `.mjs` 和 TypeScript 测试。
- 协议：对比完整 OpenAPI，并运行聊天同步/SSE、断线回放、追踪、部分产物与取消相关回归。
- 外部边界：测试使用临时 SQLite、模拟 LLM/MCP/行情依赖；浏览器验证使用隔离夹具，不依赖真实账户或实时服务。

## 业务模型与序列化边界

固定结构结果由具名模型承担：查询和命令的调用方通过属性访问字段；API 只做权限、错误转换和公开模型投影。共享 `AppModel` 支持按属性投影，允许用较窄的 HTTP 模型过滤领域模型；不要给模型加入字典访问兼容层。金额、百分比和时间字符串的外部表示保持不变。

- 行情、自选、持仓、Dashboard、财报、新闻、知识库、记忆、会话、追踪、制图和调度结果使用 `schemas/` 中的模型。知识库模型按现行 `tree/stats/root_files` 与 `nodes/links` 协议定义，不能直接套用不同形状的历史 Schema。
- ORM 仓储的行字典、供应商数据、LLM/SSE 消息和可扩展元数据属于适配协议；SDK 结果进入业务服务时解析，数据库和外部协议输出时序列化。symbol/ID 索引、指标序列、配置补丁和工具白名单投影可以保留字典，固定结果的外层结构仍须具名。
- `ToolResult.success` 统一将模型和嵌套模型转换为 JSON 数据，保证工具结果、证据和产物不会被打印成模型描述。缓存中的模型深拷贝后再修改，权限过滤不得修改共享实例。
- `constants/` 是默认值、权限、限额、超时、缓存策略和别名等策略值的定义位置，不依赖业务模块。历史模块的同名导出保留导入兼容；新增代码优先从常量模块导入。
- `tests/test_model_contracts.py` 对上述边界做自动约束，并用真实领域服务验证工具序列化、私有字段过滤和默认值隔离。`schemas/` 和 `constants/` 由严格 mypy 全量检查。
