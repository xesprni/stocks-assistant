"""遍历长桥财报日历分页，避免把全市场首批事件当作完整日期窗口。"""

from collections.abc import Callable, Iterator
from datetime import date
from typing import Protocol
from urllib.parse import urlencode

from app.constants.earnings import (
    RADAR_CALENDAR_MAX_PAGES,
    RADAR_CALENDAR_PAGE_SIZE,
    RADAR_CALENDAR_PATH,
    RADAR_CALENDAR_SYMBOL_BATCH_SIZE,
)
from app.core.market.errors import LongbridgeUnavailableError, raise_if_token_expired
from app.schemas.earnings import EarningsCalendarPage


class CalendarHttpClient(Protocol):
    def request(self, method: str, path: str, *, headers: dict[str, str]) -> object: ...


class EarningsCalendarClient:
    def __init__(
        self,
        client_factory: Callable[[], CalendarHttpClient],
        language: str,
        symbols: list[str] | None = None,
    ) -> None:
        self._client_factory = client_factory
        self._language = "en" if language == "en" else "zh-CN"
        self._symbols = list(dict.fromkeys(symbols or []))

    def pages(self, start: date, end: date) -> Iterator[EarningsCalendarPage]:
        # SDK 未暴露 symbols 参数，底层接口与官方 CLI 均支持，最多十个一批。
        # 在服务端过滤，避免为了少量自选遍历三年全市场日历。
        batches = [
            self._symbols[offset : offset + RADAR_CALENDAR_SYMBOL_BATCH_SIZE]
            for offset in range(0, len(self._symbols), RADAR_CALENDAR_SYMBOL_BATCH_SIZE)
        ]
        failure: Exception | None = None
        for symbols in batches or [[]]:
            try:
                yield from self._pages(start, end, symbols)
            except Exception as exc:
                raise_if_token_expired(exc)
                # 一批失败不能阻止剩余标的查询；先交付可用数据，再报告本段缺口。
                if failure is None:
                    failure = exc
        if failure is not None:
            raise failure

    def _pages(self, start: date, end: date, symbols: list[str]) -> Iterator[EarningsCalendarPage]:
        requests = 0

        def read(cursor: date, until: date, offset: int) -> EarningsCalendarPage:
            nonlocal requests
            if requests >= RADAR_CALENDAR_MAX_PAGES:
                raise LongbridgeUnavailableError("Earnings calendar pagination limit reached")
            requests += 1
            query = urlencode(
                {
                    "date": cursor.isoformat(),
                    "date_end": until.isoformat(),
                    "types[]": ["report", "financial"],
                    "symbols[]": symbols,
                    "markets[]": "US",
                    "next": "later",
                    "count": RADAR_CALENDAR_PAGE_SIZE,
                    "offset": offset,
                },
                doseq=True,
            )
            # 5.2 的 Python 响应类型仍遗漏 next_date；用 SDK HTTP 客户端保留游标。
            # 每页新建 HTTP 客户端，规避上游关闭连接后的复用失败。
            raw = self._client_factory().request(
                "GET",
                f"{RADAR_CALENDAR_PATH}?{query}",
                headers={"Accept-Language": self._language},
            )
            return EarningsCalendarPage.model_validate(raw)

        cursor, offset = start, 0
        seen_events: set[tuple[str, str, str, str]] = set()
        while cursor <= end:
            page = read(cursor, end, offset)
            identities = {
                (info.id, info.symbol, group.date, info.content)
                for group in page.groups
                for info in group.infos
            }
            if identities and identities <= seen_events and page.next_date == cursor.isoformat():
                raise LongbridgeUnavailableError("Earnings calendar pagination did not advance")
            seen_events.update(identities)
            # 边读边交付，日内续页或后续日期失败也保留已经取得的财报。
            yield page

            for group in page.groups:
                try:
                    day = date.fromisoformat(group.date)
                except ValueError as exc:
                    raise LongbridgeUnavailableError(
                        "Invalid earnings calendar group date"
                    ) from exc
                if not start <= day <= end or (day == cursor and page.next_date == group.date):
                    continue
                # next_date 即使在当日超过 100 条时也会跳到翌日，需独立补取日内分页。
                # count 是过滤/合并前的数量，不能要求它等于 infos 的去重数量。
                day_offset = (offset if day == cursor else 0) + RADAR_CALENDAR_PAGE_SIZE
                total = group.count
                while day_offset < total:
                    extra = read(day, day, day_offset)
                    groups = [item for item in extra.groups if item.date == group.date]
                    # 上游按原始行 offset 分页、合并后返回事件，合法续页可完全重复。
                    # 以递增 offset / count 和总请求上限约束终止，由 service 去重事件。
                    for item in groups:
                        total = max(total, item.count)
                    # date_end 并非服务端的严格过滤条件，只交付所请求日期的续页。
                    yield EarningsCalendarPage(groups=groups)
                    day_offset += RADAR_CALENDAR_PAGE_SIZE

            if not page.next_date:
                return
            try:
                next_date = date.fromisoformat(page.next_date)
            except ValueError as exc:
                raise LongbridgeUnavailableError("Invalid earnings calendar cursor") from exc
            if next_date > end:
                return
            if next_date < cursor:
                raise LongbridgeUnavailableError("Earnings calendar cursor moved backwards")
            if next_date == cursor:
                if not identities:
                    raise LongbridgeUnavailableError("Earnings calendar pagination is empty")
                # offset 按请求行数推进；infos 在上游合并后可能少于实际消耗的行数。
                offset += RADAR_CALENDAR_PAGE_SIZE
            else:
                cursor, offset = next_date, 0
