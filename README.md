# Stocks Assistant

基于 FastAPI 的 AI Agent 服务，支持长期记忆、知识库、技能系统、工具调用和任务调度。

## 功能特性

- **Agent 对话** — 支持同步响应与 SSE 流式输出，Agent 可自主调用工具完成复杂任务
- **记忆系统** — 持久化对话记忆，支持向量语义搜索与自动摘要
- **知识库** — 基于文件的知识管理，支持目录树浏览和内容索引
- **技能系统** — Markdown 格式技能文件，运行时动态加载与切换
- **工具系统** — 内置多种工具（Web 搜索、文件读写、Bash、记忆检索等），支持 MCP 协议扩展
- **任务调度** — 基于 Cron 表达式的定时任务管理

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

## 快速开始

### 环境要求

- Python >= 3.10

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

### 配置

复制配置文件并填写 API 密钥：

```bash
cp config.example.json config.json
```

编辑 `config.json`：

```json
{
  "llm_api_key": "your-api-key",
  "llm_api_base": "https://api.openai.com/v1",
  "llm_model": "gpt-4o",
  "embedding_api_key": "",
  "embedding_api_base": "https://api.openai.com/v1",
  "embedding_model": "text-embedding-3-small",
  "workspace_dir": "~/stocks-assistant"
}
```

也可通过环境变量覆盖任意配置项（前缀 `APP_`），例如：

```bash
export APP_LLM_API_KEY=your-api-key
export APP_LLM_MODEL=gpt-4o
```

### 启动服务

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

启动后访问 [http://localhost:8000/docs](http://localhost:8000/docs) 查看 API 文档。

## API 路由

| 前缀 | 说明 |
|------|------|
| `GET /api/v1/health` | 健康检查 |
| `/api/v1/agent` | Agent 对话（同步 / SSE 流式） |
| `/api/v1/memory` | 记忆管理（搜索 / 添加 / 同步） |
| `/api/v1/knowledge` | 知识库（目录树 / 内容 / 图谱） |
| `/api/v1/skills` | 技能管理（列表 / 切换 / 刷新） |
| `/api/v1/tools` | 工具管理（列表 / 执行） |
| `/api/v1/scheduler` | 调度任务 CRUD |

## 项目结构

```
app/
├── main.py              # FastAPI 应用入口
├── config.py            # 配置管理（pydantic-settings）
├── deps.py              # 依赖注入
├── api/                 # HTTP 路由层
│   ├── agent.py
│   ├── memory.py
│   ├── knowledge.py
│   ├── skills.py
│   ├── tools.py
│   └── scheduler.py
├── core/                # 业务逻辑层
│   ├── agent/           # Agent 执行引擎
│   ├── memory/          # 记忆系统（向量存储 / 摘要 / 分块）
│   ├── knowledge/       # 知识库服务
│   ├── skills/          # 技能加载器
│   ├── tools/           # 工具基类与内置工具
│   │   ├── mcp/         # MCP 协议工具适配
│   │   └── scheduler/   # 调度服务
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
    "my-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

## License

MIT
