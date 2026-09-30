"""fundamentals 领域常量的唯一定义。"""

INSIGHTS_CACHE_TTL_SECONDS = 180

INSIGHTS_CACHE_MAX_ENTRIES = 128

INSIGHTS_SECTION_WORKERS = 5

STATEMENT_NAMES = {
    "IS": "利润表",
    "BS": "资产负债表",
    "CF": "现金流量表",
}

STATEMENT_TITLES = {
    "IS": "Income Statement",
    "BS": "Balance Sheet",
    "CF": "Cash Flow Statement",
}

KIND_ALIASES = {
    "ALL": "All",
    "IS": "IncomeStatement",
    "INCOME": "IncomeStatement",
    "INCOME_STATEMENT": "IncomeStatement",
    "INCOMESTATEMENT": "IncomeStatement",
    "BS": "BalanceSheet",
    "BALANCE": "BalanceSheet",
    "BALANCE_SHEET": "BalanceSheet",
    "BALANCESHEET": "BalanceSheet",
    "CF": "CashFlow",
    "CASH": "CashFlow",
    "CASH_FLOW": "CashFlow",
    "CASHFLOW": "CashFlow",
}

PERIOD_ALIASES = {
    "AF": "Annual",
    "ANNUAL": "Annual",
    "YEAR": "Annual",
    "FY": "Annual",
    "SAF": "SemiAnnual",
    "SEMI": "SemiAnnual",
    "SEMI_ANNUAL": "SemiAnnual",
    "SEMIANNUAL": "SemiAnnual",
    "Q1": "Q1",
    "Q2": "Q2",
    "Q3": "Q3",
    "3Q": "ThreeQ",
    "THREE_Q": "ThreeQ",
    "THREEQ": "ThreeQ",
    "QF": "QuarterlyFull",
    "QUARTER": "QuarterlyFull",
    "QUARTERLY": "QuarterlyFull",
    "QUARTERLY_FULL": "QuarterlyFull",
    "QUARTERLYFULL": "QuarterlyFull",
}
