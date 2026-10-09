"""适配 SDK 5.2 的单合约期权链，按行权价配对标准 Call/Put。"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, cast

from app.core.earnings.calculations import positive_decimal

if TYPE_CHECKING:
    from longbridge.openapi import OptionChainContract


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
    strikes: dict[Decimal, OptionStrike] = {}
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
        strike = strikes.setdefault(price, OptionStrike(price))
        if contract.direction == call:
            strike.call_symbol = contract.symbol
        elif contract.direction == put:
            strike.put_symbol = contract.symbol
    # 保留缺边的行权价，调用方选择 ATM 后应顺延到期日，不能悄悄改选远价外合约。
    return list(strikes.values())
