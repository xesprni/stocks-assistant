# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述

Stocks Assistant 是一个面向股票投研、行情跟踪和个人资产管理的本地 AI Agent 工作台。后端基于 FastAPI，集成长期记忆、知识库、技能系统、工具调用、MCP 扩展、任务调度、自选股、持仓、行情、新闻和 Longbridge 财报数据；前端基于 React 19 + TypeScript + Vite + Tailwind CSS。

系统定位是辅助研究、信息整理和决策复盘，不构成投资建议。涉及行情、财报、新闻、交易日历等实时或准实时信息时，优先通过工具或 Longbridge SDK 获取数据，并在回答中保留数据来源和时间语境。

## 常用命令

### 后端

```bash
# 安装依赖（推荐）
uv sync

# 备用安装方式
pip install -r requirements.txt
pip install -e .

# 启动开发服务器（后端默认端口 8000）
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 前端代理当前指向 8001 时，可临时这样启动后端
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# 运行后端测试
uv run pytest
uv run pytest tests/test_market_service.py
```

### 前端

```bash
cd frontend
npm ci
npm run dev      # 开发服务器 http://localhost:5175
npm run build    # TypeScript build + Vite build，输出 frontend/dist/
npm run preview  # 预览构建产物
```

`frontend/vite.config.ts` 中 `/api` 代理目标是实际开发联调端口的来源；当前配置指向 `http://127.0.0.1:8001`。如果后端跑在 8000，需要同步调整代理或改用 8001 启动后端。

## 架构

### 后端分层

```
app/
├── main.py              # FastAPI 入口、lifespan、认证中间件、健康检查
├── config.py            # Settings 校验与有效配置组装
├── deps.py              # lru_cache 依赖注入单例
├── api/                 # HTTP 路由层，统一注册到 /api/v1
├── core/
│   ├── agent/           # Agent 执行器、流式事件、多 Agent 委派、上下文裁剪
│   ├── app_store.py     # 应用级 SQLite：配置、用户、角色、权限、刷新令牌、审计等
│   ├── fundamentals/    # Longbridge 财报数据服务
│   ├── knowledge/       # 知识库文件目录树、内容读取、图谱
│   ├── llm/             # OpenAI 兼容与 Responses/Codex OAuth Provider
│   ├── market/          # 指数/个股行情、K 线、分时、市场温度
│   ├── memory/          # SQLite + FTS5 + 向量搜索、摘要、自动记忆整理
│   ├── news/            # Longbridge 标的新闻
│   ├── notifications/   # Telegram 等通知
│   ├── portfolio/       # 本地持仓与行情估值
│   ├── session/         # 聊天会话持久化
│   ├── skills/          # Markdown + frontmatter 技能加载与配置
│   ├── tools/           # BaseTool、内置工具、MCP 适配、scheduler 工具
│   ├── tracing/         # Agent 调用链追踪
│   └── watchlist/       # 自选股 SQLite 存储与 Longbridge 搜索/行情
└── schemas/             # Pydantic 请求/响应模型
```

### 核心流程

**认证与权限**：除健康检查、初始化、登录、刷新令牌、退出登录、MCP OAuth callback 外，`/api/*` 默认需要 Bearer JWT。权限通过 `require_permissions(...)` 控制，角色和权限定义在 `app/core/app_store.py`。

**Agent 对话**：用户消息进入 `/api/v1/agent/chat` 或 `/api/v1/agent/stream` 后，每次请求创建新的 `Agent` 实例；会话历史由 `app/core/session` 持久化。`AgentStreamExecutor` 多轮循环调用 LLM、解析 tool calls、执行工具、把工具结果返回 LLM，直到无工具调用或达到 `agent_max_steps`。SSE 会过滤私有推理，只暴露状态、工具、子 Agent 和最终消息等公开事件。

**多 Agent 编排**：`delegate_agent` 可按配置角色并行委派研究、基本面、技术面、风险审查等子任务。默认最大深度为 1，危险工具由 `multi_agent_dangerous_tools` 和角色配置限制。

**记忆系统**：`MemoryManager` 提供向量 + FTS5 的混合检索，并带时间衰减。对话结束后可由 `MemoryCurator` 异步筛选长期记忆。用户级记忆索引位于 `workspace_dir/users/{user_id}/memory/...`。

**工具系统**：所有工具继承 `BaseTool`，实现 `execute(params) -> ToolResult`，参数使用 JSON Schema。默认工具经 `ToolManager.load_builtin_tools()` 注册，再由 `agent_tool_allowlist` 和 MCP 规则过滤后注入 Agent。

**MCP 扩展**：MCP 服务器配置存储在应用配置中，支持 `streamable_http`、旧版 `sse` 和 `stdio`。MCP 工具名格式为 `mcp_{server_name}_{tool_name}`；用户级 MCP manager 会使用用户有效配置和用户工作空间。

**任务调度**：Scheduler 使用 SQLite task/run store，支持 Cron、interval 和 once 任务。任务可运行 Agent prompt，也可发送消息；Telegram 通知通过用户有效配置创建 sender。

## 配置与运行数据

当前配置模型以应用级 SQLite 为准，不再直接按 `.env`、`APP_*` 或 `config.json` 读取业务配置。

- 应用数据库默认路径：`~/stocks-assistant/stocks-assistant.db`
- 可用启动级环境变量：`STOCKS_ASSISTANT_DB_PATH`
- 首次加载时，如果数据库还没有配置，会把仓库根目录下旧版 `config.json` 作为一次性迁移来源，并记录 `migration.config_json`
- 系统配置、用户个人配置、Longbridge/LLM/Telegram/MCP 凭据等通过配置 API 和前端配置页持久化
- 敏感配置由 `app_store` 加密存储，响应中仅返回 masked 字段
- `get_effective_settings(user_id)` 会把系统配置和用户个人配置合并；处理用户请求时不要只用全局 `get_settings()`

工作空间由 `workspace_dir` 指定。系统会创建 `memory/`、`knowledge/`、`skills/` 和 `MEMORY.md`；登录用户的文件型工作区通过 `user_workspace_dir(workspace_dir, user_id)` 隔离到 `workspace_dir/users/{user_id}`。

## API 路由

| 前缀 | 说明 |
|------|------|
| `GET /api/v1/health` | 健康检查 |
| `/api/v1/auth` | 首次初始化、登录、刷新令牌、退出登录、当前用户、修改密码 |
| `/api/v1/agent` | Agent 对话、SSE 流式响应、聊天会话管理 |
| `/api/v1/memory` | 记忆搜索、添加、同步、文件/索引管理 |
| `/api/v1/knowledge` | 知识库目录树、内容读写、知识图谱 |
| `/api/v1/skills` | 技能列表、详情、安装/删除、刷新 |
| `/api/v1/tools` | 工具列表、直接执行工具 |
| `/api/v1/scheduler` | 调度任务 CRUD、立即运行、记录查询 |
| `/api/v1/config` | 应用/个人配置读写、Telegram 测试 |
| `/api/v1/watchlist` | 自选股列表、Longbridge 标的搜索、排序和删除 |
| `/api/v1/portfolio` | 持仓、资产配置、实时估值、仓位和盈亏 |
| `/api/v1/market` | 指数/个股报价、K 线、分时、市场温度和行情配置 |
| `/api/v1/fundamentals` | Longbridge 标准化财务报表 |
| `/api/v1/news` | Longbridge 标的相关新闻 |
| `/api/v1/mcp` | MCP 状态、配置、重连、OAuth callback 和工具列表 |
| `/api/v1/tracing` | Agent 调用链追踪 |
| `/api/v1/users` | 用户管理 |
| `/api/v1/roles` | 角色、权限和页面权限管理 |

## 后端开发约定

- API 路由保持薄层：校验请求、取当前用户/权限、调用 service、转换错误；业务逻辑放到 `app/core/*/service.py`。
- 新增请求/响应结构放在 `app/schemas/`，不要在路由里散落复杂 dict 协议。
- 用户请求内需要配置时优先使用 `get_effective_settings(current_user.id)`；涉及用户文件、知识库、记忆和工具 cwd 时使用 `user_workspace_dir(...)`。
- 新增依赖单例放到 `app/deps.py`，如果配置变更会影响它，需要在 `app/api/config.py` 的缓存清理逻辑里同步处理。
- 新增后端代码时，需要在核心流程、复杂分支、关键安全边界、数据迁移和外部服务调用处补充简洁中文注释，帮助后续维护者快速理解意图；不要给一眼可见的赋值或普通 CRUD 写流水账注释。
- 日志使用 Python logging，logger 名称统一以 `stocks-assistant.*` 开头。
- 直接文件读写工具必须限制在工作空间内；`read_file`、`write_file` 已做路径约束，新增类似能力时保持同等约束。
- 交易、下单、凭据、文件写入、shell 执行等高风险能力需要明确权限、参数校验和可审计错误。
- 金融分析回答要区分事实、数据、推断和观点，避免承诺收益或给出绝对买卖指令。

## 工具开发约定

内置工具位于 `app/core/tools/`。当前重点工具包括：

- `bash`：在工作空间 cwd 执行 shell 命令
- `web_fetch`：抓取网页内容
- `read_file` / `write_file`：工作空间内文件读写
- `read_skill`：读取技能内容
- `get_financial_reports`：通过 Longbridge SDK 查询利润表、资产负债表、现金流量表
- `delegate_agent`：批量委派子 Agent
- `memory_search` / `memory_get`：在启用记忆时注册
- `scheduler`：创建/管理调度任务
- MCP 工具：按 `mcp_{server}_{tool}` 动态注入

新增工具时通常需要同步：

- 实现 `BaseTool` 子类，设置 `name`、`description`、`params` 和 `execute`
- 在 `ToolManager.load_builtin_tools()` 注册，或明确走动态/MCP 加载
- 必要时在 `ToolManager._instantiate_tool()` 注入 workspace、user_id、settings 或 service
- 更新 `DEFAULT_AGENT_TOOL_ALLOWLIST`、多 Agent 角色 allowlist 和前端/文档说明
- 为权限、路径约束、错误分支和主要成功路径补测试

`app/core/tools/web_search.py` 存在工具类，但是否注入 Agent 取决于 `ToolManager.load_builtin_tools()` 和 allowlist，请改动时同时核对这两处，避免出现“配置允许但实际未注册”的状态。

## 前端开发约定

- 前端入口在 `frontend/src/`，API 封装集中在 `frontend/src/lib/api.ts`，国际化文案在 `frontend/src/lib/i18n.ts`。
- UI 使用 React 19、Radix UI、Tailwind CSS、lucide-react 和项目内 `components/ui/` 组件风格。
- 业务页面应复用现有 API client、认证状态和错误处理模式，不要在组件里散落裸 `fetch`。
- 涉及行情、持仓、K 线和分时图时优先沿用现有数据结构和 `lightweight-charts` 集成。
- 修改前端后至少运行 `npm run build`；联调时确认 Vite proxy 与后端端口一致。

## Longbridge SDK / OpenAPI

涉及长桥 SDK、行情、财报、新闻、交易或自选股联动时，先阅读 `docs/longbridge.md`，以其中的本地文档索引和限制说明为准。

Longbridge OpenAPI 提供程序化行情和交易接口，用于构建投研、行情跟踪和策略分析工具。接入方式包括底层 HTTP / WebSocket 接口，以及上层 SDK（如 Python SDK）。本项目后端使用 Longbridge SDK 处理行情、自选股搜索、新闻和财报等能力。

启用 OpenAPI 需要先在 Longbridge App 完成开户，再进入 Longbridge 开发者平台完成开发者验证并获取 token。项目凭据优先通过配置页/API 写入应用 SQLite 中的系统或个人配置，也可让 Longbridge SDK 回退读取 `LONGBRIDGE_APP_KEY`、`LONGBRIDGE_APP_SECRET`、`LONGBRIDGE_ACCESS_TOKEN` 环境变量；`longbridge_http_url`、`longbridge_quote_ws_url` 留空时使用 SDK 默认地址。

长桥能力范围按 `docs/longbridge.md` 归纳如下：

- Trading：创建、修改、撤销订单，查询当日/历史订单和成交明细等。
- Quotes：实时行情、历史行情、K 线、盘中、逐笔、盘口、市场状态、交易日等。
- Portfolio / Account：资产、持仓、资金、现金流、保证金比例等。
- Real-time subscription：实时行情订阅和订单状态推送。
- Content / Fundamentals / Research：新闻、公告/披露、社区话题、公司信息、财报、估值、分红、机构评级、公司行动等。

行情覆盖包括港股证券（股票、ETF、窝轮、牛熊证）和恒生指数、美股证券（股票、ETF）、Nasdaq 指数、OPRA 期权，以及 A 股证券（股票、ETF）和指数。交易能力覆盖港股股票/ETF/窝轮/牛熊证，以及美股股票/ETF/窝轮/牛熊证/期权。

限流约定：

- Quote API：单账户只能创建一个长连接，同时最多订阅 500 个标的；请求不超过每秒 10 次，并发请求不超过 5 个。SDK 的 `QuoteContext` 会按服务端限制主动控频，请求过快时会自动延迟，通常不需要额外实现细粒度限流。
- Trade API：不超过每 30 秒 30 次，两次调用间隔不少于 0.02 秒。SDK 的 `TradeContext` 不做交易限流，涉及交易下单/改单/撤单时必须在业务层自行处理限流、幂等和风险控制。

开发约定：

- 行情、新闻、财报和自选股查询优先复用现有 Longbridge service/client，不要在 API 路由或工具里重复创建 SDK 访问逻辑。
- 新增 Longbridge 能力时，优先把 SDK 调用封装在 `app/core/*/service.py` 或对应领域 service 中，再由 API 路由和 Agent 工具复用。
- 缺少 SDK 或凭据时，抛出/转换为 `LongbridgeUnavailableError` 这类明确错误，前端展示可操作的配置提示。
- 批量行情查询前先规范化和去重 symbol，减少 Longbridge 请求量并稳定返回 key。
- 涉及交易接口时默认只做只读查询；下单、改单、撤单等写操作需要显式用户意图、清晰参数校验和额外风险提示。

## 测试与验证

- 后端改动优先跑相关 pytest；涉及共享配置、权限、Agent、MCP、Longbridge service 或调度时扩大到完整 `uv run pytest`。
- 前端改动跑 `npm run build`，必要时启动后端和 `npm run dev` 做浏览器联调。
- 修改配置持久化、权限或迁移逻辑时，使用临时 `STOCKS_ASSISTANT_DB_PATH` 验证首次初始化和旧 `config.json` 一次性迁移。
- 修改 Agent 流式事件时，同时检查同步 `/chat`、SSE `/stream`、session 持久化、memory curator 和 tracing 是否仍然一致。

## 关键约定

- 工作空间运行时数据不要提交到仓库；仓库内代码、docs、tests 和前端源码才是主要改动对象。
- 可能存在用户未提交改动，编辑前先看相关文件，避免覆盖用户工作。
- 对外部实时数据、行情、新闻、政策、交易日历和 SDK 行为不要凭记忆断言；优先查本地 service、文档或工具结果。
- 保持 API 响应结构向后兼容，前端依赖字段变动时同步更新 `frontend/src/lib/api.ts` 类型和页面处理。
- 修改 README、AGENTS、CLAUDE 等协作文档时，优先纠正会误导开发/运行的旧信息。
