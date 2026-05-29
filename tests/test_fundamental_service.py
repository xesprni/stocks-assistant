from app.core.fundamentals.service import FundamentalService


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
