"""会话恢复时重新装配 Agent，工作区提示和磁盘文件仍保持一致。"""

import json
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import config, deps
from app.api import agent as agent_api
from app.config import Settings
from app.core.agent import factory
from app.core.agent.agent import Agent
from app.core.agent.models import LLMRequest
from app.core.agent.run_service import ChatRunManager
from app.core.security import CurrentUser, get_current_user
from app.core.session import ChatSessionStore
from app.core.tools import tool_manager
from app.core.tools.base_tool import BaseTool, ToolStage


class FileExchangeModel:
    """每个请求先执行一个真实文件工具，再返回固定回复。"""

    def __init__(self, name, arguments):
        self.name = name
        self.arguments = arguments
        self.requests: list[LLMRequest] = []

    def call(self, request):
        raise AssertionError("This short conversation must not need context summarization")

    def call_stream(self, request):
        self.requests.append(deepcopy(request))
        if len(self.requests) == 1:
            yield {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": self.name,
                                    "function": {
                                        "name": self.name,
                                        "arguments": json.dumps(self.arguments),
                                    },
                                }
                            ]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            }
        else:
            yield {"choices": [{"delta": {"content": "已核验文件。"}, "finish_reason": "stop"}]}


def workspace_context(prompt):
    assert prompt.count("<workspace_context>") == 1
    return prompt.split("<workspace_context>", 1)[1].split("</workspace_context>", 1)[0]


@pytest.fixture
def workspace_settings(tmp_path, monkeypatch):
    # 相对路径和空格会经过用户隔离，再由运行时提示转换为可复用的绝对路径。
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        workspace_dir="research workspace",
        memory_enabled=False,
        tracing_enabled=False,
        mcp_servers={},
        system_prompt="保留已保存的研究助手设定。",
        agent_tool_allowlist=["bash", "write_file", "read_file"],
    )
    monkeypatch.setattr(factory, "get_effective_settings", lambda user_id: settings)
    monkeypatch.setattr(config, "get_effective_settings", lambda user_id: settings)
    monkeypatch.setattr(deps, "get_skill_manager", lambda: None)
    builtin_factories = tool_manager.builtin_factories
    # 保留真实内置工具构造及权限过滤，只排除本回归不使用的外部服务。
    monkeypatch.setattr(
        tool_manager,
        "builtin_factories",
        lambda manager: {
            cls: build
            for cls, build in builtin_factories(manager).items()
            if cls.name in settings.agent_tool_allowlist
        },
    )
    return settings


@pytest.mark.parametrize("endpoint", ["chat", "stream"])
def test_api_resume_recreates_agent_and_reads_persisted_user_file(
    workspace_settings, tmp_path, monkeypatch, endpoint
):
    relative_file = "reports/continuity.txt"
    file_content = "跨请求保留的研究数据 2026-09-09"
    models = [
        FileExchangeModel("write_file", {"path": relative_file, "content": file_content}),
        FileExchangeModel("read_file", {"path": relative_file}),
    ]
    pending_models = iter(models)
    monkeypatch.setattr(deps, "create_llm_provider", lambda settings: next(pending_models))
    agents = []
    create_agent = factory.create_agent

    def recording_factory(user_id=None, settings=None):
        agent = create_agent(user_id, settings=settings)
        agents.append(agent)
        return agent

    monkeypatch.setattr(factory, "create_agent", recording_factory)
    store = ChatSessionStore(workspace_settings.workspace_dir)
    monkeypatch.setattr(agent_api, "get_session_store", lambda: store)
    manager = ChatRunManager()
    monkeypatch.setattr(agent_api, "chat_runs", manager)
    user = CurrentUser(
        id="alice",
        username="alice",
        display_name="Alice",
        roles=("user",),
        permissions=frozenset({"chat:read", "chat:write"}),
        is_active=True,
    )
    app = FastAPI()
    app.include_router(agent_api.router, prefix="/agent")
    app.dependency_overrides[get_current_user] = lambda: user

    def post_exchange(client, message, session_id=None):
        payload = {"message": message, "user_id": "bob"}
        if session_id:
            payload["session_id"] = session_id
        response = client.post(f"/agent/{endpoint}", json=payload)
        assert response.status_code == 200, response.text
        if endpoint == "chat":
            assert response.json()["response"] == "已核验文件。"
            return response.json()["session_id"]
        events = [
            json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
        ]
        assert not any(event["type"] == "error" for event in events), response.text
        terminal = [event for event in events if event["type"] == "agent_end"]
        assert len(terminal) == 1
        assert terminal[0]["data"]["final_response"] == "已核验文件。"
        return terminal[0]["data"]["session_id"]

    try:
        with TestClient(app) as client:
            session_id = post_exchange(client, "保存研究数据到 reports/continuity.txt")
            expected_workspace = (tmp_path / "research workspace/users/alice").resolve()
            assert (expected_workspace / relative_file).read_text() == file_content
            # 从 SQLite 重新加载会话，不能靠第一个 Agent 的消息或 Python 对象保留文件。
            store = ChatSessionStore(workspace_settings.workspace_dir)
            assert post_exchange(client, "继续读取刚才的文件", session_id) == session_id
    finally:
        manager.close()

    assert len(agents) == 2 and agents[0] is not agents[1]
    for agent, model in zip(agents, models, strict=True):
        assert Path(agent.workspace_dir).resolve() == expected_workspace
        assert len(model.requests) == 2
        for request in model.requests:
            context = workspace_context(request.system)
            assert json.dumps(str(expected_workspace), ensure_ascii=False) in context
            assert "read_file" in context and "bash" in context
            assert request.system.startswith(workspace_settings.system_prompt)
            assert {tool["name"] for tool in request.tools} == {
                "bash",
                "write_file",
                "read_file",
            }
        for tool in agent.tools:
            tool_workspace = tool.cwd if tool.name == "bash" else tool.workspace_dir
            assert Path(tool_workspace).resolve() == expected_workspace

    recovered_history = models[1].requests[0].messages[:2]
    assert [message["role"] for message in recovered_history] == ["user", "assistant"]
    assert recovered_history[1]["content"][0]["text"] == "已核验文件。"
    tool_results = models[1].requests[1].messages[-1]["content"]
    assert tool_results[0]["type"] == "tool_result"
    assert file_content in tool_results[0]["content"]
    assert store.get_session(session_id)["user_id"] == "alice"
    assert len(store.get_messages(session_id)) == 4
    assert not (tmp_path / "research workspace/users/bob" / relative_file).exists()


def test_new_bash_process_keeps_disk_files_and_shares_file_tool_workspace(
    workspace_settings, tmp_path, monkeypatch
):
    monkeypatch.setattr(deps, "create_llm_provider", lambda settings: FileExchangeModel("", {}))
    first_agent = factory.create_agent("alice")
    first_tools = {tool.name: tool for tool in first_agent.tools}
    written = first_tools["write_file"].execute({"path": "from_tool.txt", "content": "tool data"})
    assert written.status == "success"
    first = first_tools["bash"].execute(
        {
            "command": (
                "set -e\n"
                "export WORKSPACE_CONTINUITY_ONLY=first\n"
                "mkdir nested\n"
                "cd nested\n"
                "printf 'bash data' > from_bash.txt\n"
                "cat ../from_tool.txt"
            )
        }
    )
    assert first.status == "success" and first.result["output"] == "tool data"

    second_agent = factory.create_agent("alice")
    second_tools = {tool.name: tool for tool in second_agent.tools}
    second = second_tools["bash"].execute(
        {
            "command": (
                'set -e\ntest -z "${WORKSPACE_CONTINUITY_ONLY-}"\npwd\ncat nested/from_bash.txt'
            )
        }
    )
    assert second.status == "success"
    expected_workspace = (tmp_path / "research workspace/users/alice").resolve()
    assert second.result["output"].splitlines() == [str(expected_workspace), "bash data"]
    read_back = second_tools["read_file"].execute({"path": "nested/from_bash.txt"})
    assert read_back.status == "success" and "bash data" in read_back.result


def test_agent_without_workspace_does_not_invent_workspace_context():
    agent = Agent(system_prompt="custom")
    assert "<workspace_context>" not in agent.get_full_system_prompt()


@pytest.mark.parametrize("tool_stage", [None, ToolStage.POST_PROCESS])
def test_workspace_prompt_does_not_claim_unavailable_inspection_tools(tmp_path, tool_stage):
    tools = []
    if tool_stage is not None:
        for name in ("bash", "read_file", "view_image"):
            tool = BaseTool()
            tool.name = name
            tool.stage = tool_stage
            tools.append(tool)
    agent = Agent(system_prompt="custom", workspace_dir=str(tmp_path), tools=tools)
    context = workspace_context(agent.get_full_system_prompt())
    assert "file existence cannot currently be verified" in " ".join(context.split())
    assert all(
        f"{name} is available" not in context for name in ("bash", "read_file", "view_image")
    )


def test_workspace_prompt_expands_home_and_quotes_path():
    workspace = '~/research/../研究 "files"'
    expected_workspace = Path(workspace).expanduser().resolve()
    agent = Agent(system_prompt="custom", workspace_dir=workspace)
    context = workspace_context(agent.get_full_system_prompt())
    assert json.dumps(str(expected_workspace), ensure_ascii=False) in context
