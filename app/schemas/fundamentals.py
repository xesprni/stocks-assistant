"""Fundamental data API schemas."""

from typing import List, Optional

from pydantic import BaseModel, Field


class FinancialReportColumn(BaseModel):
    """A reporting period column in a statement table."""

    key: str
    label: str
    year: Optional[int] = None
    fp_end: Optional[str] = None


class FinancialReportCell(BaseModel):
    """A statement cell aligned to one reporting period."""

    period: str
    value: Optional[str] = None
    ratio: Optional[str] = None
    yoy: Optional[str] = None
    year: Optional[int] = None
    fp_end: Optional[str] = None


class FinancialReportRow(BaseModel):
    """A financial statement line item."""

    field: str
    name: str = ""
    percent: bool = False
    tip: str = ""
    cells: List[FinancialReportCell] = Field(default_factory=list)


class FinancialStatementTable(BaseModel):
    """A normalized financial statement table."""

    code: str
    name: str
    title: str = ""
    short_title: str = ""
    currency: str = ""
    has_yoy: bool = False
    columns: List[FinancialReportColumn] = Field(default_factory=list)
    rows: List[FinancialReportRow] = Field(default_factory=list)


class FinancialReportsResponse(BaseModel):
    """Normalized financial reports response."""

    symbol: str
    kind: str
    period: Optional[str] = None
    statements: List[FinancialStatementTable] = Field(default_factory=list)
