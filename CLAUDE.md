# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

基于 FastAPI 的 AI Agent 服务，集成长期记忆、知识库、技能系统、工具调用、任务调度和自选股管理。后端 Python (FastAPI)，前端 React 19 + TypeScript + Vite + Tailwind CSS。

## 常用命令

### 后端

```bash
# 安装依赖
uv sync
# 或
pip install -e .

# 启动开发服务器
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 配置（复制模板后填写 API 密钥）
cp config.example.json config.json
```

### 前端

```bash
cd frontend
npm install
npm run dev    # 开发服务器 http://localhost:5175，代理 /api 到后端 :8000
npm run build  # 构建到 frontend/dist/
```

## 架构

### 后端分层

```
app/
├── main.py          # FastAPI 入口，lifespan 初始化工作空间目录
├── config.py        # pydantic-settings 配置（config.json < .env < APP_* 环境变量）
├── deps.py          # lru_cache 依赖注入单例（LLM、记忆、技能、工具、调度、自选股）
├── api/             # 路由层，统一注册到 /api/v1 前缀
├── core/
│   ├── agent/       # Agent 核心：对话管理、多轮工具调用执行器、上下文裁剪
│   ├── llm/         # OpenAI 兼容 LLM Provider（httpx 实现，支持流式 + function calling）
│   ├── memory/      # 记忆系统：SQLite + FTS5 + 向量搜索（混合检索 + 时序衰减）
│   ├── knowledge/   # 知识库：文件目录树浏览和内容索引
│   ├── skills/      # 技能：Markdown + frontmatter 格式定义，运行时动态加载
│   ├── tools/       # 工具：BaseTool 基类 + 内置工具 + MCP 协议适配
│   └── watchlist/   # 自选股：SQLite 存储 + Longbridge SDK 行情查询
└── schemas/         # Pydantic 请求/响应模型
```

### 核心流程

**Agent 对话流程**（`app/core/agent/`）：用户消息 -> Agent.run_stream() -> AgentStreamExecutor 多轮循环：LLM 生成回复 -> 解析 tool_calls -> 执行工具 -> 结果返回 LLM -> 重复直到无工具调用或达到 max_steps。支持 SSE 流式事件输出。

**记忆系统**（`app/core/memory/`）：MemoryManager 提供混合搜索（向量 + FTS5 关键词加权融合），带指数时序衰减。基于文件哈希的增量同步，上下文裁剪时异步摘要写入每日记忆文件。

**工具系统**（`app/core/tools/`）：所有工具继承 `BaseTool`，实现 `execute(params) -> ToolResult`。分 PRE_PROCESS（LLM 可主动调用）和 POST_PROCESS 两个阶段。ToolManager 统一注册，支持从目录动态加载。

**依赖注入**（`app/deps.py`）：所有核心组件通过 `@lru_cache` 实现单例，组件间依赖关系在此文件中统一管理。

### 前端

React 19 + Vite，UI 组件基于 Radix UI + shapnick/ui 风格（`frontend/src/components/ui/`），API 调用封装在 `frontend/src/lib/api.ts`。开发时 Vite 将 `/api` 请求代理到后端 `http://127.0.0.1:8000`。

### 配置优先级

环境变量（`APP_` 前缀，如 `APP_LLM_API_KEY`）> `.env` 文件 > `config.json` > 默认值。

## API 路由

| 前缀 | 说明 |
|------|------|
| `/api/v1/agent` | Agent 对话（同步 / SSE 流式） |
| `/api/v1/memory` | 记忆搜索/添加/同步 |
| `/api/v1/knowledge` | 知识库目录树/内容 |
| `/api/v1/skills` | 技能列表/切换/刷新 |
| `/api/v1/tools` | 工具列表/执行 |
| `/api/v1/scheduler` | Cron 定时任务 CRUD |
| `/api/v1/watchlist` | 自选股管理（SQLite + Longbridge 行情） |
| `/api/v1/config` | 应用配置读写 |

## 关键约定

- 工作空间目录由 `workspace_dir` 配置，运行时存放记忆文件、知识库、技能定义、调度任务、自选股数据库
- Agent API 是无状态的——每次请求创建新的 Agent 实例
- 内置工具：bash、web_search、web_fetch、read_file、write_file、memory_search、memory_get、scheduler
- MCP 服务器在 `config.json` 的 `mcp_servers` 中配置，用于扩展外部工具
- Longbridge 行情凭据通过 `config.json` 或 `LONGBRIDGE_*` 环境变量配置
- 日志使用 Python logging，logger 名称统一为 `stocks-assistant.*`
- 前端端口 5175，后端端口 8000
