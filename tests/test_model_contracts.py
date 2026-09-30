"""固定返回结构和常量边界的回归约束；不允许新增匿名业务协议。"""

import ast
import inspect
from pathlib import Path
from types import UnionType
from typing import get_args, get_origin, get_type_hints

import pytest
from fastapi.routing import APIRoute
from pydantic import BaseModel
from starlette.responses import Response

from app.core.market.service import MarketService
from app.core.portfolio.service import PortfolioService
from app.core.tools.portfolio import PortfolioTool
from app.core.tools.portfolio_positions import GetPortfolioPositionsTool
from app.core.tools.watchlist import WatchlistTool
from app.core.watchlist.service import WatchlistService
from app.main import app
from app.schemas.portfolio import PortfolioItem, PortfolioItemCreate, PortfolioListResponse
from app.schemas.watchlist import WatchlistItem, WatchlistItemCreate

APP_ROOT = Path(__file__).resolve().parents[1] / "app"


def _is_model_result(annotation):
    origin = get_origin(annotation)
    if origin in (list, UnionType):
        return all(_is_model_result(arg) for arg in get_args(annotation))
    return inspect.isclass(annotation) and issubclass(annotation, (BaseModel, Response))


def test_every_http_endpoint_declares_a_model_or_transport_response():
    failures = []
    endpoints = [route for route in app.routes if isinstance(route, APIRoute)]
    assert endpoints
    for route in endpoints:
        if not isinstance(route, APIRoute):
            continue
        annotation = get_type_hints(route.endpoint).get("return")
        if not _is_model_result(annotation):
            failures.append(f"{route.path}: {annotation}")
    assert failures == []


def test_fixed_business_results_cannot_return_dict_literals():
    paths = set(APP_ROOT.glob("api/*.py"))
    paths.update(APP_ROOT.glob("core/**/*service.py"))
    paths.update(
        APP_ROOT / path
        for path in (
            "core/session/store.py",
            "core/tracing/store.py",
            "core/memory/manager.py",
            "core/tools/portfolio_output.py",
            "core/tools/portfolio.py",
            "core/tools/watchlist.py",
            "core/tools/scheduler/tool.py",
            "core/tools/scheduler/helpers.py",
            "core/tools/evidence.py",
            "core/rendering/worker.py",
            "core/agent/subagent.py",
        )
    )
    # LLM 的 JSON 消息是外部协议序列化边界，不是应用业务返回模型。
    protocol_serializers = {("api/agent.py", "_agent_message")}
    failures = []
    for path in sorted(paths):
        tree = ast.parse(path.read_text())
        for function in ast.walk(tree):
            if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            identity = (path.relative_to(APP_ROOT).as_posix(), function.name)
            if identity in protocol_serializers:
                continue
            for node in ast.walk(function):
                if (
                    isinstance(node, ast.Return)
                    and isinstance(node.value, ast.Dict)
                    and any(isinstance(key, ast.Constant) for key in node.value.keys)
                ):
                    failures.append(f"{identity[0]}:{node.lineno} {function.name}")
    assert failures == []


def test_service_public_results_do_not_use_untyped_record_dictionaries():
    failures = []
    for path in APP_ROOT.glob("core/**/*service.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if node.name.startswith("_") or node.returns is None:
                continue
            annotation = ast.unparse(node.returns)
            if annotation in {"dict", "dict[str, Any]", "list[dict]", "list[dict[str, Any]]"}:
                # Channel drain/finish 暴露的是 Agent 消息协议，并非 Service 查询结果。
                if path.name == "input_service.py" and node.name in {
                    "public_input",
                    "drain",
                    "finish",
                }:
                    continue
                # wait_result 返回最后一个终止 SSE 事件的可扩展 data 载荷。
                if path.name == "run_service.py" and node.name == "wait_result":
                    continue
                failures.append(f"{path.relative_to(APP_ROOT)}:{node.lineno} {annotation}")
    assert failures == []


def test_permissions_and_http_codes_use_named_constants():
    failures = []
    for path in APP_ROOT.rglob("*.py"):
        if "constants" in path.parts:
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Call):
                if (
                    isinstance(node.func, ast.Name)
                    and node.func.id == "require_permissions"
                    and any(isinstance(arg, ast.Constant) for arg in node.args)
                ):
                    failures.append(f"{path}:{node.lineno}: literal permission")
                if any(
                    kw.arg == "status_code" and isinstance(kw.value, ast.Constant)
                    for kw in node.keywords
                ):
                    failures.append(f"{path}:{node.lineno}: literal HTTP status")
    assert failures == []


def test_constant_modules_do_not_depend_on_application_layers():
    for path in (APP_ROOT / "constants").glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith("app."), path
            if isinstance(node, ast.Import):
                assert all(not alias.name.startswith("app.") for alias in node.names), path


def test_real_domain_models_reach_tools_as_json_without_private_fields(tmp_path, monkeypatch):
    portfolio = PortfolioService(str(tmp_path))
    item = portfolio.add_item(
        PortfolioItemCreate(market="US", symbol="AAPL.US", shares="2", cost_price="10"),
        user_id="alice",
    )
    assert isinstance(item, PortfolioItem)
    assert item.symbol == "AAPL.US"
    with pytest.raises(TypeError):
        item["symbol"]
    monkeypatch.setattr(portfolio, "_fetch_live_data", lambda *args, **kwargs: ({}, {}))
    response = portfolio.list_items("US", user_id="alice")
    assert isinstance(response, PortfolioListResponse)
    assert isinstance(response.items[0], PortfolioItem)
    assert response.total_assets == "20.00"
    assert response.valuation_complete is False
    for tool, params in (
        (GetPortfolioPositionsTool(portfolio_service=portfolio, user_id="alice"), {"market": "US"}),
        (
            PortfolioTool(portfolio_service=portfolio, user_id="alice"),
            {"action": "list", "market": "US"},
        ),
    ):
        result = tool.execute_tool(params)
        assert result.status == "success", result.result
        assert result.result["markets"][0]["items"][0]["symbol"] == "AAPL.US"
        assert "user_id" not in result.result["markets"][0]["items"][0]

    watchlist = WatchlistService(str(tmp_path))
    watched = watchlist.add_item(WatchlistItemCreate(category="US", symbol="MSFT"), "alice")
    assert isinstance(watched, WatchlistItem)
    result = WatchlistTool(watchlist_service=watchlist, user_id="alice").execute_tool(
        {"action": "list"}
    )
    assert result.status == "success", result.result
    assert result.result["items"][0]["symbol"] == "MSFT.US"
    assert "user_id" not in result.result["items"][0]


def test_market_default_models_are_independent(tmp_path):
    service = MarketService(str(tmp_path))
    first, second = service.get_config(), service.get_config()
    first.indices[0].name = "changed"
    assert second.indices[0].name != "changed"
    assert service.get_config().indices[0].name != "changed"


def test_request_limits_use_named_constants():
    failures = []
    for path in [*APP_ROOT.glob("api/*.py"), *APP_ROOT.glob("schemas/*.py")]:
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            if node.func.id not in {"Query", "Field", "StringConstraints"}:
                continue
            values = [*node.args, *(kw.value for kw in node.keywords)]
            if any(
                isinstance(value, ast.Constant)
                and type(value.value) in (int, float)
                and value.value not in (0, 1)
                for value in values
            ):
                failures.append(f"{path.relative_to(APP_ROOT)}:{node.lineno}")
    assert failures == []


def test_static_module_constants_live_in_domain_constant_files():
    failures = []
    # OAuth 待完成用户映射是运行时状态，由回调消费，不能搬到常量模块。
    runtime_state = {("api/mcp.py", "_PENDING_OAUTH_USERS")}
    literals = (ast.Constant, ast.Dict, ast.List, ast.Set, ast.Tuple, ast.BinOp, ast.UnaryOp)
    for path in APP_ROOT.rglob("*.py"):
        if "constants" in path.parts:
            continue
        for node in ast.parse(path.read_text()).body:
            target = (
                node.targets[0]
                if isinstance(node, ast.Assign) and len(node.targets) == 1
                else node.target
                if isinstance(node, ast.AnnAssign)
                else None
            )
            if not isinstance(target, ast.Name) or not target.id.isupper():
                continue
            identity = (path.relative_to(APP_ROOT).as_posix(), target.id)
            if isinstance(node.value, literals) and identity not in runtime_state:
                failures.append(f"{identity[0]}:{node.lineno}: {target.id}")
    assert failures == []
