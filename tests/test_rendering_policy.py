"""制图策略随实际工具权限进入主、子 Agent 请求，且不改变工具执行能力。"""

import json
from copy import deepcopy
from types import SimpleNamespace

import pytest

from app import config, deps
from app.config import Settings
from app.core import app_store
from app.core.agent.agent import Agent
from app.core.agent.factory import create_agent
from app.core.agent.models import LLMRequest
from app.core.agent.subagent import SubAgentRunner
from app.core.tools.base_tool import BaseTool, ToolResult, ToolStage
from app.core.tools.tool_manager import ToolManager


class NamedTool(BaseTool):
    def __init__(self, name, stage=ToolStage.PRE_PROCESS):
        self.name = name
        self.stage = stage
        self.calls = []

    def execute(self, params):
        self.calls.append(params)
        return ToolResult.success("42")


class RecordingModel:
    def __init__(self, tool_call=None):
        self.requests: list[LLMRequest] = []
        self.tool_call = tool_call

    def call(self, request):
        raise AssertionError("This short conversation must not request context summarization")

    def call_stream(self, request):
        self.requests.append(deepcopy(request))
        if len(self.requests) == 1 and self.tool_call:
            name, arguments = self.tool_call
            yield {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "calculation",
                                    "function": {
                                        "name": name,
                                        "arguments": json.dumps(arguments),
                                    },
                                }
                            ]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            }
        else:
            yield {"choices": [{"delta": {"content": "done"}, "finish_reason": "stop"}]}


def rendering_policy(prompt):
    assert prompt.count("<image_rendering_policy>") == 1
    return prompt.split("<image_rendering_policy>", 1)[1].split("</image_rendering_policy>", 1)[0]


def tool_names(request):
    return {tool["name"] for tool in request.tools or []}


@pytest.fixture
def persisted_config(tmp_path, monkeypatch):
    monkeypatch.setenv(app_store.APP_DB_ENV, str(tmp_path / "app.db"))
    monkeypatch.setattr(app_store, "_app_store", None)
    monkeypatch.setattr(config, "_config_instance", None)
    config.clear_effective_settings_cache()
    store = app_store.get_app_store()
    store.migrate_config_json_once(tmp_path / "missing-config.json")
    store.set_config_values(
        {
            "workspace_dir": str(tmp_path / "workspace"),
            "memory_enabled": False,
            "system_prompt": "保留用户已保存的专属研究助手设定。",
            "agent_tool_allowlist": ["bash", "read_file", "render_image", "view_image"],
        }
    )
    yield store
    config.clear_effective_settings_cache()


def test_factory_injects_policy_after_saved_prompt_and_skills_and_respects_allowlist(
    persisted_config, monkeypatch
):
    model = RecordingModel()
    monkeypatch.setattr(deps, "create_llm_provider", lambda settings: model)
    skills_prompt = "<skills>Existing custom skill instructions.</skills>"
    monkeypatch.setattr(
        deps,
        "get_skill_manager",
        lambda: SimpleNamespace(build_skills_prompt=lambda **kwargs: skills_prompt),
    )
    available_names = ["bash", "read_file", "render_image", "view_image"]
    monkeypatch.setattr(
        ToolManager, "get_all_tools", lambda self: [NamedTool(name) for name in available_names]
    )
    saved_prompt = persisted_config.get_config()["system_prompt"]

    agent = create_agent()
    assert agent.run_stream("把这份报告生成图片") == "done"
    request = model.requests[-1]
    policy = rendering_policy(request.system)
    assert request.system.startswith(saved_prompt)
    assert request.system.index(skills_prompt) < request.system.index("<image_rendering_policy>")
    assert {"render_image", "view_image"} <= tool_names(request)
    assert "render_image is available:" in policy
    assert "HTML" in policy and "SVG" in policy
    assert "Matplotlib" in policy and "Pillow" in policy
    assert "explicitly" in policy and "plotting code" in policy
    assert "data processing and calculations" in policy

    # 已保存白名单显式移除渲染工具后，新 Agent 不应因全局默认或旧实例继续宣称可用。
    narrowed = ["bash", "read_file", "view_image"]
    persisted_config.set_config_values({"agent_tool_allowlist": narrowed})
    config.clear_effective_settings_cache()
    next_agent = create_agent()
    assert next_agent.run_stream("继续生成图片") == "done"
    next_request = model.requests[-1]
    assert tool_names(next_request) == set(narrowed)
    next_policy = rendering_policy(next_request.system)
    assert "render_image is not available to this Agent" in next_policy
    assert "Agent tool configuration" in next_policy
    assert "silently switch to bash" in next_policy
    assert persisted_config.get_config()["agent_tool_allowlist"] == narrowed
    assert persisted_config.get_config()["system_prompt"] == saved_prompt


@pytest.mark.parametrize("view_stage", [None, ToolStage.POST_PROCESS])
def test_unavailable_viewer_does_not_claim_visual_verification(view_stage):
    tools = [NamedTool("render_image")]
    if view_stage is not None:
        tools.append(NamedTool("view_image", stage=view_stage))
    agent = Agent(system_prompt="custom", tools=tools)
    policy = rendering_policy(agent.get_full_system_prompt())
    with_viewer = Agent(
        system_prompt="custom", tools=[NamedTool("render_image"), NamedTool("view_image")]
    )
    visual_policy = rendering_policy(with_viewer.get_full_system_prompt())
    assert "view_image is not available" in policy
    assert "visual inspection is incomplete" in policy
    assert "use view_image on the final PNG" not in policy
    assert "use view_image on the final PNG" in visual_policy
    assert "review" in visual_policy.lower()
    assert "mobile" in visual_policy.lower()


@pytest.mark.parametrize(
    "tools",
    [
        [],
        [NamedTool("read_file"), NamedTool("web_fetch")],
        [NamedTool("render_image", stage=ToolStage.POST_PROCESS)],
    ],
)
def test_nonvisual_agents_do_not_receive_rendering_instructions(tools):
    agent = Agent(system_prompt="custom", tools=tools, settings=Settings())
    assert "<image_rendering_policy>" not in agent.get_full_system_prompt()


@pytest.mark.parametrize("fallback_tool", ["bash", "write_file", "view_image"])
def test_missing_renderer_does_not_silently_fall_back_to_other_tools(fallback_tool):
    agent = Agent(
        system_prompt="custom",
        tools=[NamedTool(fallback_tool), NamedTool("render_image", ToolStage.POST_PROCESS)],
    )
    policy = rendering_policy(agent.get_full_system_prompt())
    assert "render_image is not available to this Agent" in policy
    assert "silently switch to bash" in policy
    assert "Agent tool configuration" in policy
    assert "including an MCP tool" in policy
    assert "declared capabilities" in policy


def test_subagent_policy_uses_filtered_child_tools_and_returns_work_to_parent():
    model = RecordingModel()
    settings = Settings(
        multi_agent_enabled=True,
        multi_agent_roles={
            "reviewer": {
                "system_prompt": "Review the report.",
                "tool_allowlist": ["read_file", "view_image"],
                "max_steps": 3,
            }
        },
    )
    parent = Agent(
        system_prompt="Parent",
        model=model,
        tools=[NamedTool(name) for name in ("read_file", "render_image", "view_image")],
        settings=settings,
    )
    result = SubAgentRunner(parent).run_batch(
        [{"role": "reviewer", "task": "Review the data and prepare an image layout"}]
    )
    assert result["results"][0]["status"] == "success"
    assert len(model.requests) == 1
    request = model.requests[0]
    assert tool_names(request) == {"read_file", "view_image"}
    policy = rendering_policy(request.system)
    assert "render_image is not available to this Agent" in policy
    assert "return the data snapshot, sources and layout requirements to the parent Agent" in policy
    assert "Agent tool configuration" not in policy
    assert "render_image is available:" in rendering_policy(parent.get_full_system_prompt())
    assert {tool.name for tool in parent.tools} == {"read_file", "render_image", "view_image"}


def test_rendering_policy_keeps_bash_available_for_data_calculations():
    parameters = {"command": "calculate fixture data"}
    model = RecordingModel(tool_call=("bash", parameters))
    calculator = NamedTool("bash")
    agent = Agent(
        system_prompt="custom",
        model=model,
        tools=[calculator, NamedTool("render_image"), NamedTool("view_image")],
    )

    assert agent.run_stream("先计算数据，再说明结果") == "done"
    assert calculator.calls == [parameters]
    assert len(model.requests) == 2
    assert all("bash" in tool_names(request) for request in model.requests)
    assert all("<image_rendering_policy>" in request.system for request in model.requests)
    tool_results = model.requests[1].messages[-1]["content"]
    assert tool_results[0]["type"] == "tool_result"
    assert tool_results[0]["tool_use_id"] == "calculation"
    assert tool_results[0]["content"] == "42"
