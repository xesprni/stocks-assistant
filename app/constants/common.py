"""跨领域的稳定协议值与单位。"""

from enum import StrEnum


class OperationStatus(StrEnum):
    OK = "ok"


DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 200
