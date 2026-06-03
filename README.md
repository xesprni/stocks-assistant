# Stocks Assistant

面向股票投研、行情跟踪和个人资产管理的 AI Agent 工作台。Stocks Assistant 把聊天式智能体、Longbridge 行情与财报数据、自选股/持仓管理、长期记忆、知识库、技能系统和定时任务整合到一个可本地部署的服务里，让日常投研从“临时问答”升级为“持续沉淀、可追踪、可复用”的研究流程。

它适合希望搭建个人投研中枢的投资者、需要自动化收集信息的研究人员，以及想把 AI Agent 能力接入自有交易/研究工作流的开发者。系统侧重于辅助研究、信息整理和决策复盘，不构成投资建议。

## 业务价值

- **把投研流程搬进一个工作台**：从自选股、实时行情、K 线、分时、新闻、财报到 AI 分析，减少在多个工具之间来回切换
- **让 AI 不只会聊天，还会做事**：Agent 可以搜索网页、读取知识库、查询财报、调用工具、并行委派子 Agent，再把结果汇总成可读结论
- **让研究结论长期沉淀**：长期记忆会保存偏好、历史判断、复盘结论和知识片段，后续分析可以自动带上上下文
- **让监控任务自动发生**：通过定时任务每天/每周自动生成市场摘要、持仓复盘或个股跟踪报告，并可推送到 Telegram
- **让系统可扩展、可私有化**：后端基于 FastAPI，工具可通过 MCP 扩展，数据和记忆保存在本地工作空间，适合二次开发和私有部署

## 功能特性

- **AI 投研对话** — 支持同步响应与 SSE 流式输出，展示思考进度、工具调用、子 Agent 执行过程和最终结论
- **多 Agent 编排** — 主 Agent 可通过 `delegate_agent` 并行委派基本面研究、技术面分析、新闻梳理和风险审查
- **行情监控** — 支持指数报价、自选股报价、K 线、分时、资金流向、市场温度和刷新间隔配置
- **自选股管理** — 支持美股、A 股、港股分类管理，Longbridge 搜索添加、备注、排序和一键发起分析
- **持仓管理** — 支持美股/A 股持仓、成本、数量、总资金配置，自动计算市值、仓位、盈亏比例和现金比例
- **财报与基本面** — 通过 Longbridge SDK 查询标准化利润表、资产负债表、现金流量表，供页面展示和 Agent 分析
- **新闻跟踪** — 查询标的相关新闻，适合从自选股或单个 symbol 快速进入事件驱动分析
- **长期记忆** — 持久化对话记忆，支持向量语义搜索、FTS5 关键词检索、自动摘要和用户级隔离
- **知识库** — 基于 Markdown 文件的知识管理，支持目录树、内容读取、索引同步和知识图谱浏览
- **技能系统** — Markdown + frontmatter 格式定义分析技能，运行时动态加载、切换和刷新
- **工具系统** — 内置 Web 搜索、网页抓取、文件读写、Bash、记忆检索、财报查询等工具，并支持 MCP 协议扩展
- **任务调度** — 支持 Cron、固定间隔和一次性任务，可自动运行 Agent prompt、保存执行记录并发送 Telegram 通知
- **多用户与权限** — 支持首次初始化、登录、刷新令牌、用户管理、角色管理和细粒度权限控制
- **Agent Tracing** — 记录会话中的工具调用链、子 Agent 执行和任务路径，便于复盘与调试

## 业务功能全景

### AI 投研助手

Stocks Assistant 的核心不是普通聊天框，而是一个能调用工具的投研 Agent。你可以直接提出业务问题，例如“分析一下 AAPL.US 的基本面和近期风险”“每天开盘前整理我的自选股新闻”“对比两家公司现金流质量”。Agent 会根据问题自动检索记忆、读取知识库、抓取网页、查询财报或委派子任务，再把多来源信息整理成结论。

复杂问题可以拆给多个子 Agent 并行执行：一个负责资料收集，一个负责财报指标，一个负责风险审查，一个负责最终归纳。前端通过流式事件展示进度，后台通过 tracing 保存调用链，研究过程可追踪、可复盘。

### 行情监控中心

行情模块围绕“盘面概览 + 自选股跟踪”设计。系统可以配置关注指数，拉取指数报价；也可以基于自选股列表拉取个股报价，展示最新价、涨跌额、涨跌幅、开高低收、成交量和成交额等字段。对于单个标的，还支持日/周/月 K 线、当日分时、当日资金净流入时序以及市场温度数据，帮助快速判断市场环境和标的状态。

### 自选股与持仓管理

自选股支持美股、A 股、港股分类，使用 Longbridge 搜索添加标的，保留交易所、币种、最新报价、涨跌信息和个人备注。列表支持排序，适合把“重点跟踪”“观察中”“待复盘”的标的沉淀到一个稳定入口。

持仓模块面向资产跟踪，支持美股和 A 股市场，记录 symbol、名称、持股数量、成本价、备注和市场总资金。系统会结合实时行情计算当前价格、市值、仓位比例、盈亏比例、总资产和现金比例，让 AI 分析不仅停留在观点层面，也能结合你的实际仓位。

### 财报、新闻与基本面研究

基本面模块通过 Longbridge SDK 获取标准化财务报表，覆盖利润表、资产负债表和现金流量表。你可以在页面查看财报，也可以让 Agent 结合财报数据回答“收入增长质量如何”“现金流是否支撑利润”“资产负债表有哪些风险”等问题。

新闻模块支持按标的拉取新闻列表，包含标题、摘要、链接、发布时间和互动数据。结合定时任务后，可以把“每日跟踪自选股重大新闻并生成摘要”变成自动化流程。

### 记忆、知识库与技能沉淀

长期记忆用于保存对话中值得复用的信息，例如你的投资偏好、关注行业、历史判断、复盘结论和常用分析框架。系统使用 SQLite + FTS5 + 向量检索做混合搜索，并支持按时间衰减权重，让近期且相关的信息更容易被 Agent 找到。

知识库面向结构化资料沉淀，可以把行业研究、公司资料、交易规则、个人方法论放入工作空间的 Markdown 文件中。技能系统则适合把固定分析方法封装成可切换的 Markdown 技能，例如“成长股分析”“财报质量检查”“风险清单审查”，让 Agent 以更稳定的方式执行你的研究套路。

### 自动化监控与通知

调度系统可以把投研动作变成后台任务：每天早上生成市场观察，每周复盘持仓，每隔一段时间检查自选股新闻，或在指定时间运行一次研究 prompt。任务支持 Cron、间隔和一次性执行，并保存运行记录、状态、耗时、错误和输出预览。配置 Telegram 后，任务结果可以自动推送到 Telegram 对话。

## 典型使用场景

- **盘前准备**：自动汇总主要指数、市场温度、自选股新闻和隔夜重要事件，生成开盘前简报
- **个股深度研究**：并行分析财报、新闻、行业资料和风险点，输出结构化投资备忘录
- **持仓复盘**：结合实际仓位、成本和当前行情，检查盈亏、仓位暴露和需要关注的风险
- **长期跟踪**：把每次研究结论写入记忆，后续再问同一家公司时自动带上历史判断
- **知识库问答**：把研报、规则、策略文档沉淀为 Markdown，让 Agent 基于自己的资料库回答问题
- **自动提醒**：定时运行 Agent 任务，将市场摘要、标的新闻或复盘报告推送到 Telegram

## 内置工具

| 工具 | 说明 |
|------|------|
| `web_search` | 网络搜索 |
| `web_fetch` | 网页内容抓取 |
| `read_file` | 读取文件 |
| `write_file` | 写入文件 |
| `bash` | 执行 Shell 命令 |
| `memory_search` | 语义搜索记忆 |
| `memory_get` | 获取记忆内容 |
| `get_financial_reports` | 通过 Longbridge SDK 查询利润表、资产负债表、现金流量表 |
| `get_longbridge_capital_flow` | 通过 Longbridge SDK 查询标的当日资金净流入时序 |
| `delegate_agent` | 批量委派智能体执行独立研究/分析任务 |

## 快速开始

### 环境要求

- Python >= 3.10
- Node.js >= 20 与 npm（用于前端工作台）

### 安装

```bash
# 克隆项目
git clone https://github.com/xesprni/stocks-assistant.git
cd stocks-assistant

# 安装依赖（推荐使用 uv）
pip install -e .
# 或
uv sync
```

前端依赖：

```bash
cd frontend
npm install
```

### 配置

复制配置文件并填写 API 密钥：

```bash
cp config.example.json config.json
```

编辑 `config.json`：

```json
{
  "llm_api_key": "your-api-key",
  "llm_provider": "openai_compatible",
  "llm_auth_mode": "api_key",
  "llm_api_base": "https://api.openai.com/v1",
  "llm_model": "gpt-4o",
  "llm_codex_auth_file": "",
  "llm_codex_api_base": "https://chatgpt.com/backend-api/codex",
  "llm_codex_model": "gpt-5.5",
  "embedding_auth_mode": "api_key",
  "embedding_api_key": "",
  "embedding_api_base": "https://api.openai.com/v1",
  "embedding_model": "text-embedding-3-small",
  "embedding_codex_auth_file": "",
  "embedding_codex_api_base": "https://chatgpt.com/backend-api/codex",
  "embedding_codex_model": "text-embedding-3-small",
  "workspace_dir": "~/stocks-assistant"
}
```

也可通过环境变量覆盖任意配置项（前缀 `APP_`），例如：

```bash
export APP_LLM_API_KEY=your-api-key
export APP_LLM_MODEL=gpt-4o
```

如需启用行情、自选股搜索、财报和新闻能力，请在配置页或 `config.json` 中补充 `longbridge_app_key`、`longbridge_app_secret`、`longbridge_access_token`。如需调度任务完成后推送消息，请启用 `telegram_enabled` 并配置 `telegram_bot_token` 与 `telegram_chat_id`。

如需使用 Codex 的 ChatGPT OAuth 登录态，先在本机执行 `codex login`，再设置：

```json
{
  "llm_provider": "openai_responses",
  "llm_auth_mode": "codex",
  "llm_codex_api_base": "https://chatgpt.com/backend-api/codex",
  "llm_codex_model": "gpt-5.2-codex"
}
```

### 多 Agent 编排

默认启用 `delegate_agent` 工具。主 Agent 会在复杂任务中把可分离的工作流委派给配置好的智能体角色，例如基本面、技术面和风险审查并行分析后再汇总：

```json
{
  "multi_agent_enabled": true,
  "multi_agent_max_parallel_agents": 3,
  "multi_agent_default_max_steps": 8,
  "multi_agent_max_depth": 1,
  "multi_agent_dangerous_tools": ["bash", "write_file", "scheduler"],
  "multi_agent_roles": {
    "researcher": {
      "description": "Gather facts and source context.",
      "system_prompt": "You are a focused research sub-agent. Return a concise evidence-grounded brief.",
      "tool_allowlist": ["web_fetch", "read_file", "read_skill", "memory_search", "memory_get", "get_financial_reports"],
      "max_steps": 8,
      "allow_dangerous_tools": false
    }
  }
}
```

示例提问：

```text
请并行委派基本面、技术面、风险审查三个子任务分析 AAPL.US，然后给我一个综合观点。
```

智能体的过程会通过 SSE `subagent_*` 事件显示在聊天进度和 Agent Tracing 中；主聊天正文只保留主 Agent 的最终汇总。

### 启动服务

后端服务：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

启动后访问 [http://localhost:8000/docs](http://localhost:8000/docs) 查看 API 文档。

前端工作台：

```bash
cd frontend
npm run dev
```

Vite 默认启动在 [http://localhost:5175](http://localhost:5175)，`/api` 的代理目标由 `frontend/vite.config.ts` 配置，请确保它与后端服务端口一致。

## API 路由

| 前缀 | 说明 |
|------|------|
| `GET /api/v1/health` | 健康检查 |
| `/api/v1/auth` | 首次初始化、登录、刷新令牌、退出登录、当前用户、修改密码 |
| `/api/v1/agent` | Agent 对话（同步 / SSE 流式） |
| `/api/v1/memory` | 记忆管理（搜索 / 添加 / 同步） |
| `/api/v1/knowledge` | 知识库（目录树 / 内容 / 图谱） |
| `/api/v1/skills` | 技能管理（列表 / 切换 / 刷新） |
| `/api/v1/tools` | 工具管理（列表 / 执行） |
| `/api/v1/scheduler` | 调度任务 CRUD |
| `/api/v1/fundamentals` | Longbridge 基本面财报数据 |
| `/api/v1/watchlist` | 自选股列表、Longbridge 标的搜索、排序和删除 |
| `/api/v1/portfolio` | 持仓列表、资产设置、实时估值、仓位和盈亏计算 |
| `/api/v1/market` | 指数/个股报价、K 线、分时、资金流向、市场温度和行情配置 |
| `/api/v1/news` | 标的相关新闻列表 |
| `/api/v1/mcp` | MCP 服务器配置、连接状态和 OAuth 回调 |
| `/api/v1/tracing` | Agent 调用链和子任务追踪 |
| `/api/v1/users` | 用户管理 |
| `/api/v1/roles` | 角色和权限管理 |

## 项目结构

```
app/
├── main.py              # FastAPI 应用入口
├── config.py            # 配置管理（pydantic-settings）
├── deps.py              # 依赖注入
├── api/                 # HTTP 路由层
│   ├── agent.py
│   ├── auth.py
│   ├── config.py
│   ├── fundamentals.py
│   ├── memory.py
│   ├── market.py
│   ├── mcp.py
│   ├── news.py
│   ├── portfolio.py
│   ├── knowledge.py
│   ├── skills.py
│   ├── tools.py
│   ├── scheduler.py
│   ├── tracing.py
│   ├── users.py
│   └── watchlist.py
├── core/                # 业务逻辑层
│   ├── agent/           # Agent 执行引擎
│   ├── app_store.py     # 应用级 SQLite 存储（用户、角色、调度等）
│   ├── fundamentals/    # Longbridge 财报数据服务
│   ├── market/          # 行情监控服务
│   ├── memory/          # 记忆系统（向量存储 / 摘要 / 分块）
│   ├── news/            # 标的新闻服务
│   ├── portfolio/       # 持仓服务
│   ├── knowledge/       # 知识库服务
│   ├── notifications/   # Telegram 等通知能力
│   ├── session/         # 聊天会话存储
│   ├── skills/          # 技能加载器
│   ├── tracing/         # Agent 调用链追踪
│   ├── tools/           # 工具基类与内置工具
│   │   ├── mcp/         # MCP 协议工具适配
│   │   └── scheduler/   # 调度服务
│   ├── watchlist/       # 自选股服务
│   └── llm/             # LLM 提供商封装
└── schemas/             # Pydantic 数据模型
config.example.json      # 配置文件示例
docs/                    # 文档
workspace/               # 运行时工作空间（记忆 / 知识 / 技能）
```

## MCP 扩展

在 `config.json` 中配置 MCP 服务器以扩展工具能力：

```json
{
  "mcp_servers": {
    "longbridge": {
      "transport": "streamable_http",
      "url": "https://openapi.longbridge.com/mcp"
    },
    "remote-server": {
      "transport": "streamable_http",
      "url": "https://example.com/mcp",
      "auth": {
        "type": "bearer",
        "token": "your-oauth-access-token"
      }
    },
    "oauth-client-credentials-server": {
      "transport": "streamable_http",
      "url": "https://example.com/mcp",
      "auth": {
        "type": "oauth_client_credentials",
        "token_url": "https://example.com/oauth/token",
        "client_id": "your-client-id",
        "client_secret": "your-client-secret",
        "scope": "search"
      }
    },
    "local-server": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

HTTP MCP servers use the standard Streamable HTTP transport. Servers that advertise OAuth through the MCP protected-resource metadata flow can be configured with only `url`; the UI will show `login required` and a Login button. Legacy SSE is still supported with `"transport": "sse"` for older servers.

## License

MIT
