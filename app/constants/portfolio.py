"""持仓领域常量。"""

from typing import Literal

DEFAULT_TRANSACTION_LIMIT = 100
MAX_TRANSACTION_LIMIT = 200


_SUFFIX_MARKETS: dict[str, Literal["US", "A", "H"]] = {"US": "US", "SH": "A", "SZ": "A", "HK": "H"}
