"""适配 SDK 5.2 的单合约期权链，按行权价配对标准 Call/Put。"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, cast

from pydantic import ValidationError

from app.constants.earnings import RADAR_OPTION_API_NOT_FOUND_CODE, RADAR_OPTION_CHAIN_PATH
from app.core.earnings.calculations import positive_decimal
from app.core.market.errors import LongbridgeUnavailableError, longbridge_error_code
from app.core.market.longbridge_context import create_http_client
from app.schemas.earnings import EarningsOptionChain, EarningsOptionContract

if TYPE_CHECKING:
    from longbridge.openapi import OptionChainContract, QuoteContext

    from app.config import Settings


@dataclass
class OptionStrike:
    price: Decimal
    call_symbol: str = ""
    put_symbol: str = ""


def pair_option_contracts(
    contracts: list["OptionChainContract"], expiry: date
) -> list[OptionStrike]:
    from longbridge.openapi import OptionDirection, OptionStandardAttr

    # SDK stub 将实际枚举实例声明为嵌套类，显式转换其静态类型。
    normal = cast(OptionStandardAttr, OptionStandardAttr.Normal)
    call = cast(OptionDirection, OptionDirection.Call)
    put = cast(OptionDirection, OptionDirection.Put)
    parsed = []
    for contract in contracts:
        price = positive_decimal(contract.strike_price)
        if (
            price is None
            or contract.expiry_date != expiry
            or contract.standard_attr != normal
            or not contract.symbol
            or contract.direction not in (call, put)
        ):
            continue
        parsed.append(
            EarningsOptionContract(
                symbol=contract.symbol,
                expiry_date=contract.expiry_date,
                strike_price=price,
                direction="C" if contract.direction == call else "P",
                standard_attr="",
            )
        )
    return _pair_contracts(parsed, expiry)


def _pair_contracts(
    contracts: Iterable[EarningsOptionContract], expiry: date
) -> list[OptionStrike]:
    strikes: dict[Decimal, OptionStrike] = {}
    for contract in contracts:
        price = positive_decimal(contract.strike_price)
        if (
            price is None
            or contract.expiry_date != expiry
            or contract.standard_attr != ""
            or not contract.symbol
            or contract.direction not in ("C", "P")
        ):
            continue
        strike = strikes.setdefault(price, OptionStrike(price))
        if contract.direction == "C":
            strike.call_symbol = contract.symbol
        else:
            strike.put_symbol = contract.symbol
    # 保留缺边的行权价，调用方选择 ATM 后应顺延到期日，不能悄悄改选远价外合约。
    return list(strikes.values())


def fetch_option_strikes(
    ctx: "QuoteContext", symbol: str, expiry: date, settings: "Settings | None" = None
) -> list[OptionStrike]:
    try:
        contracts = ctx.option_chain_info_by_date(symbol, expiry, standard_only=True)
    except Exception as exc:
        if longbridge_error_code(exc) != RADAR_OPTION_API_NOT_FOUND_CODE:
            raise
        # SDK 5.2 的旧 HTTP 路径可能返回 api not found；仅此时采用官方 MCP 的新路径。
        # 沿用当前用户的认证配置，通过 HTTP 查询，不创建第二条行情长连接。
        response = create_http_client(settings).request(
            "POST",
            RADAR_OPTION_CHAIN_PATH,
            body={
                "symbol": symbol,
                "expiry_date": expiry.strftime("%Y%m%d"),
                "standard_only": True,
            },
        )
        try:
            parsed = EarningsOptionChain.model_validate(response)
        except ValidationError as validation_error:
            raise LongbridgeUnavailableError(
                "Invalid earnings option chain response"
            ) from validation_error
        return _pair_contracts(parsed.contracts, expiry)
    return pair_option_contracts(contracts, expiry)
