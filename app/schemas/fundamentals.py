"""Fundamental data API schemas."""

from pydantic import BaseModel, Field


class FinancialReportColumn(BaseModel):
    """A reporting period column in a statement table."""

    key: str
    label: str
    year: int | None = None
    fp_end: str | None = None


class FinancialReportCell(BaseModel):
    """A statement cell aligned to one reporting period."""

    period: str
    value: str | None = None
    ratio: str | None = None
    yoy: str | None = None
    year: int | None = None
    fp_end: str | None = None


class FinancialReportRow(BaseModel):
    """A financial statement line item."""

    field: str
    name: str = ""
    percent: bool = False
    tip: str = ""
    cells: list[FinancialReportCell] = Field(default_factory=list)


class FinancialStatementTable(BaseModel):
    """A normalized financial statement table."""

    code: str
    name: str
    title: str = ""
    short_title: str = ""
    currency: str = ""
    has_yoy: bool = False
    columns: list[FinancialReportColumn] = Field(default_factory=list)
    rows: list[FinancialReportRow] = Field(default_factory=list)


class FinancialReportsResponse(BaseModel):
    """Normalized financial reports response."""

    symbol: str
    kind: str
    period: str | None = None
    statements: list[FinancialStatementTable] = Field(default_factory=list)
