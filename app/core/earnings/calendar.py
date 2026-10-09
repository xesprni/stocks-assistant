"""遍历长桥财报日历分页，避免把全市场首批事件当作完整日期窗口。"""

from collections.abc import Callable, Iterator
from datetime import date
from typing import Protocol
from urllib.parse import urlencode

from app.constants.earnings import (
    RADAR_CALENDAR_MAX_PAGES,
    RADAR_CALENDAR_PAGE_SIZE,
    RADAR_CALENDAR_PATH,
)
from app.core.market.errors import LongbridgeUnavailableError
from app.schemas.earnings import EarningsCalendarPage


class CalendarHttpClient(Protocol):
    def request(self, method: str, path: str, *, headers: dict[str, str]) -> object: ...


class EarningsCalendarClient:
    def __init__(self, client_factory: Callable[[], CalendarHttpClient], language: str) -> None:
        self._client_factory = client_factory
        self._language = "en" if language == "en" else "zh-CN"

    def pages(self, start: date, end: date) -> Iterator[EarningsCalendarPage]:
        cursor = start
        offset = 0
        seen_events: set[tuple[str, str, str, str]] = set()
        expected_counts: dict[str, int] = {}
        seen_by_date: dict[str, set[tuple[str, str, str, str]]] = {}
        for _ in range(RADAR_CALENDAR_MAX_PAGES):
            query = urlencode(
                {
                    "date": cursor.isoformat(),
                    "date_end": end.isoformat(),
                    "types[]": "report",
                    "markets[]": "US",
                    "next": "later",
                    "count": RADAR_CALENDAR_PAGE_SIZE,
                    "offset": offset,
                }
            )
            # 5.2 的 Python 响应类型仍遗漏 next_date；用 SDK HTTP 客户端保留游标。
            # 每页新建 HTTP 客户端，与官方 MCP 一致，规避上游关闭连接后的复用失败。
            raw = self._client_factory().request(
                "GET",
                f"{RADAR_CALENDAR_PATH}?{query}",
                headers={"Accept-Language": self._language},
            )
            page = EarningsCalendarPage.model_validate(raw)
            identities = set()
            for group in page.groups:
                group_ids = {
                    (info.id, info.symbol, group.date, info.content) for info in group.infos
                }
                identities.update(group_ids)
                seen_by_date.setdefault(group.date, set()).update(group_ids)
                expected_counts[group.date] = max(expected_counts.get(group.date, 0), group.count)
            if identities and identities <= seen_events and page.next_date == cursor.isoformat():
                raise LongbridgeUnavailableError("Earnings calendar pagination did not advance")
            seen_events.update(identities)
            # 边读边交付，后续页失败也保留已成功取得的财报。
            yield page
            if not page.next_date:
                break
            try:
                next_date = date.fromisoformat(page.next_date)
            except ValueError as exc:
                raise LongbridgeUnavailableError("Invalid earnings calendar cursor") from exc
            if next_date > end:
                break
            if next_date < cursor:
                raise LongbridgeUnavailableError("Earnings calendar cursor moved backwards")
            if next_date == cursor:
                # 财报集中在同一天时用 offset 续读；重复页会被上面的身份检查截断。
                count = sum(len(group.infos) for group in page.groups)
                if not count:
                    raise LongbridgeUnavailableError("Earnings calendar pagination is empty")
                offset += count
            else:
                cursor, offset = next_date, 0
        else:
            raise LongbridgeUnavailableError("Earnings calendar pagination limit reached")
        # 同日事件可能横跨多页；按累计去重数量检查，避免漏页被解释为没有财报。
        if any(count > len(seen_by_date[day]) for day, count in expected_counts.items()):
            raise LongbridgeUnavailableError("Earnings calendar page is incomplete")
