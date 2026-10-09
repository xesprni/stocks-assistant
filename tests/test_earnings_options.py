"""验证 SDK 路径缺失时的期权链 HTTP 兼容入口，不连接真实行情服务。"""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from longbridge.openapi import OptionDirection, OptionStandardAttr

from app.config import Settings
from app.core.earnings.options import OptionStrike, fetch_option_strikes
from app.core.market.errors import LongbridgeUnavailableError

EXPIRY = date(2026, 10, 16)


class ApiError(Exception):
    def __init__(self, code):
        self.code = code


def raw_contract(symbol, price, direction, **changes):
    return {
        "symbol": symbol,
        "strike_price": price,
        "direction": direction,
        "standard_attr": "",
        "expiry_date": "20261016",
        **changes,
    }


def test_sdk_success_does_not_create_http_client():
    ctx = Mock()
    ctx.option_chain_info_by_date.return_value = [
        SimpleNamespace(
            symbol=symbol,
            strike_price=Decimal("460"),
            direction=direction,
            standard_attr=OptionStandardAttr.Normal,
            expiry_date=EXPIRY,
        )
        for symbol, direction in [
            ("TSM261016C460000.US", OptionDirection.Call),
            ("TSM261016P460000.US", OptionDirection.Put),
        ]
    ]
    with patch("app.core.earnings.options.create_http_client") as factory:
        assert fetch_option_strikes(ctx, "TSM.US", EXPIRY) == [
            OptionStrike(Decimal("460"), "TSM261016C460000.US", "TSM261016P460000.US")
        ]
    factory.assert_not_called()
    ctx.option_chain_info_by_date.assert_called_once_with("TSM.US", EXPIRY, standard_only=True)


def test_missing_sdk_route_uses_user_settings_and_pairs_only_matching_standard_contracts():
    ctx = Mock()
    ctx.option_chain_info_by_date.side_effect = ApiError(404000)
    http = Mock()
    http.request.return_value = {
        "list": [
            raw_contract("TSM261016C460000.US", "460", "C"),
            raw_contract("TSM261016P460000.US", "460.0", "P"),
            # 只含 Call 的近 ATM 行必须保留，不能让后续流程改选更远的完整配对。
            raw_contract("TSM261016C457500.US", "457.5", "C"),
            raw_contract("OLD.US", "457.5", "P", standard_attr="old"),
            raw_contract("UNKNOWN.US", "457.5", "P", standard_attr="unknown"),
            raw_contract("TSM261023P457500.US", "457.5", "P", expiry_date="20261023"),
            raw_contract("BAD_DIRECTION.US", "457.5", "other"),
            raw_contract("", "450", "C"),
            raw_contract("ZERO.US", "0", "P"),
        ]
    }
    settings = Settings(app_language="en")
    with patch("app.core.earnings.options.create_http_client", return_value=http) as factory:
        strikes = fetch_option_strikes(ctx, "TSM.US", EXPIRY, settings)
    assert strikes == [
        OptionStrike(Decimal("460"), "TSM261016C460000.US", "TSM261016P460000.US"),
        OptionStrike(Decimal("457.5"), "TSM261016C457500.US", ""),
    ]
    factory.assert_called_once_with(settings)
    http.request.assert_called_once_with(
        "POST",
        "/quote/options/strikes",
        body={"symbol": "TSM.US", "expiry_date": "20261016", "standard_only": True},
    )


@pytest.mark.parametrize("error", [ApiError(401003), ApiError(301604), RuntimeError("failure")])
def test_other_errors_propagate_without_fallback(error):
    ctx = Mock()
    ctx.option_chain_info_by_date.side_effect = error
    with (
        patch("app.core.earnings.options.create_http_client") as factory,
        pytest.raises(type(error)) as caught,
    ):
        fetch_option_strikes(ctx, "TSM.US", EXPIRY)
    assert caught.value is error
    factory.assert_not_called()


def test_http_error_is_not_swallowed():
    ctx = Mock()
    ctx.option_chain_info_by_date.side_effect = ApiError(404000)
    http = Mock()
    error = ApiError(401003)
    http.request.side_effect = error
    with (
        patch("app.core.earnings.options.create_http_client", return_value=http),
        pytest.raises(ApiError) as caught,
    ):
        fetch_option_strikes(ctx, "TSM.US", EXPIRY)
    assert caught.value is error


@pytest.mark.parametrize(
    "response",
    [
        {},
        {"list": None},
        {"list": [raw_contract("CALL.US", "460", "C", expiry_date=20261016)]},
        {"list": [raw_contract("CALL.US", "460", "C", expiry_date="1792108800")]},
        {"list": [raw_contract("CALL.US", "460", "C", expiry_date="20260230")]},
        {"list": [raw_contract("CALL.US", "NaN", "C")]},
        {"list": [raw_contract("CALL.US", "bad", "C")]},
        {"list": [raw_contract("CALL.US", "460", "C", standard_attr=None)]},
    ],
)
def test_invalid_http_data_raises_clear_error(response):
    ctx = Mock()
    ctx.option_chain_info_by_date.side_effect = ApiError(404000)
    http = Mock()
    http.request.return_value = response
    with (
        patch("app.core.earnings.options.create_http_client", return_value=http),
        pytest.raises(LongbridgeUnavailableError, match="Invalid earnings option chain response"),
    ):
        fetch_option_strikes(ctx, "TSM.US", EXPIRY)


def test_empty_http_chain_remains_empty():
    ctx = Mock()
    ctx.option_chain_info_by_date.side_effect = ApiError(404000)
    http = Mock()
    http.request.return_value = {"list": []}
    with patch("app.core.earnings.options.create_http_client", return_value=http):
        assert fetch_option_strikes(ctx, "TSM.US", EXPIRY) == []
