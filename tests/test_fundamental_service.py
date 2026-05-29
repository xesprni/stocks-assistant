from app.core.fundamentals.service import FundamentalService, _plain
from app.schemas.dashboard import DashboardSymbolInsightsResponse


class SdkLikeMetrics:
    __slots__ = ("pb", "pe")

    def __init__(self, pe="12.3", pb="4.5"):
        self.pe = pe
        self.pb = pb


class SdkLikeObject:
    __slots__ = ("items", "metrics", "name")

    def __init__(self):
        self.name = "Example Inc."
        self.metrics = SdkLikeMetrics()
        self.items = [{"event": "Dividend"}]


class FakeQuoteContext:
    def filings(self, symbol):
        payload = SdkLikeObject()
        payload.items = [{"symbol": symbol, "title": "Annual filing"}]
        return payload


class FakeFundamentalContext:
    def company(self, symbol):
        payload = SdkLikeObject()
        payload.name = symbol
        return payload

    def valuation(self, symbol):
        return SdkLikeObject()

    def dividend(self, symbol):
        payload = SdkLikeObject()
        payload.items = [{"symbol": symbol, "desc": "Cash dividend"}]
        return payload

    def institution_rating(self, symbol):
        return SdkLikeObject()

    def corp_action(self, symbol):
        payload = SdkLikeObject()
        payload.items = [{"symbol": symbol, "type": "split"}]
        return payload


class FakeFundamentalService(FundamentalService):
    def __init__(self):
        self.financial_report_calls = 0

    def _quote_context(self, settings=None):
        return FakeQuoteContext()

    def _fundamental_context(self, settings=None):
        return FakeFundamentalContext()

    def get_financial_reports(self, *args, **kwargs):
        self.financial_report_calls += 1
        return super().get_financial_reports(*args, **kwargs)


def test_plain_serializes_descriptor_backed_sdk_objects():
    plain = _plain(SdkLikeObject())

    assert plain == {
        "items": [{"event": "Dividend"}],
        "metrics": {"pb": "4.5", "pe": "12.3"},
        "name": "Example Inc.",
    }


def test_section_from_raw_extracts_items_and_preserves_statement_data():
    section = FundamentalService._section_from_raw(
        {"statements": [{"code": "IS"}, {"code": "BS"}], "symbol": "AAPL.US"},
        collection_keys=("statements",),
    )

    assert section["available"] is True
    assert section["total"] == 2
    assert section["items"] == [{"code": "IS"}, {"code": "BS"}]
    assert section["data"]["statements"] == [{"code": "IS"}, {"code": "BS"}]


def test_section_from_raw_extracts_list_items_from_sdk_payload():
    section = FundamentalService._section_from_raw(
        {"list": [{"desc": "Dividend"}], "symbol": "AAPL.US"},
        collection_keys=("list",),
    )

    assert section["available"] is True
    assert section["total"] == 1
    assert section["items"] == [{"desc": "Dividend"}]
    assert "list" not in section["data"]


def test_security_insights_skip_financial_reports_and_parse_descriptor_sections():
    service = FakeFundamentalService()

    payload = service.get_security_insights("aapl.us")

    assert service.financial_report_calls == 0
    assert "financial_reports" not in payload
    assert payload["company"]["data"]["name"] == "AAPL.US"
    assert payload["valuation"]["data"]["metrics"] == {"pb": "4.5", "pe": "12.3"}
    assert payload["dividends"]["items"] == [{"symbol": "AAPL.US", "desc": "Cash dividend"}]
    assert payload["corporate_actions"]["items"] == [{"symbol": "AAPL.US", "type": "split"}]

    response_payload = DashboardSymbolInsightsResponse(**payload).model_dump()
    assert "financial_reports" not in response_payload
