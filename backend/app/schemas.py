"""Shapes of the data going in and out of the API."""
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

LineType = Literal["fixed", "variable", "one_off"]
LineKind = Literal["expense", "saving", "debt_repayment"]
Priority = Literal["essential", "flexible"]
AccountKind = Literal["bank", "mobile_money", "savings", "chama"]
MonthStatus = Literal["planning", "active", "closed"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- settings ---------------------------------------------------------------

class CurrencyOut(ORM):
    code: str
    name: str


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    currency_code: str
    kind: AccountKind = "bank"
    active: bool = True


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    currency_code: str | None = None
    kind: AccountKind | None = None
    active: bool | None = None


class AccountOut(ORM):
    id: int
    name: str
    currency_code: str
    kind: str
    active: bool


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    location_id: int


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    location_id: int | None = None
    sort_order: int | None = None
    usual_recipient_id: int | None = None


class GroupOut(ORM):
    id: int
    name: str
    location_id: int
    sort_order: int
    usual_recipient_id: int | None = None


class LocationIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    default_currency: str


class LocationPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    default_currency: str | None = None
    sort_order: int | None = None


class LocationOut(ORM):
    id: int
    name: str
    default_currency: str
    sort_order: int
    groups: list[GroupOut]


class MetaOut(BaseModel):
    currencies: list[CurrencyOut]
    locations: list[LocationOut]
    accounts: list[AccountOut]
    # the two countries and what their currencies are really called (see app/profile.py)
    profile: dict = {}


# ---- months and lines -------------------------------------------------------

class LineIn(BaseModel):
    group_id: int
    name: str = Field(min_length=1, max_length=120)
    currency_code: str
    line_type: LineType = "variable"
    kind: LineKind = "expense"
    priority: Priority = "flexible"
    weekly_amount: Decimal | None = Field(default=None, ge=0)
    planned: Decimal = Field(default=Decimal("0"), ge=0)
    note: str | None = None
    goal_id: int | None = None
    debt_id: int | None = None


class LinePatch(BaseModel):
    group_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    currency_code: str | None = None
    line_type: LineType | None = None
    kind: LineKind | None = None
    priority: Priority | None = None
    weekly_amount: Decimal | None = Field(default=None, ge=0)
    planned: Decimal | None = Field(default=None, ge=0)
    needs_review: bool | None = None
    note: str | None = None
    is_core: bool | None = None
    destination_account_id: int | None = None
    goal_id: int | None = None
    recipient_id: int | None = None
    debt_id: int | None = None
    # Typed over the automatic actual. Sending null goes back to the automatic figure.
    actual: Decimal | None = Field(default=None, ge=0)
    # Required when the core saving is reduced.
    reason: str | None = None


class LineOut(ORM):
    id: int
    month_id: int
    group_id: int
    name: str
    currency_code: str
    line_type: str
    kind: str
    priority: str
    weekly_amount: Decimal | None
    planned: Decimal
    actual: Decimal | None
    needs_review: bool
    is_core: bool
    destination_account_id: int | None
    goal_id: int | None = None
    recipient_id: int | None = None
    debt_id: int | None = None
    note: str | None
    sort_order: int


class MonthIn(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    copy_previous: bool = True
    fx_rate_ntd_kes: Decimal | None = Field(default=None, gt=0)
    weeks: int | None = Field(default=None, ge=1, le=6)


class MonthPatch(BaseModel):
    fx_rate_ntd_kes: Decimal | None = Field(default=None, gt=0)
    weeks: int | None = Field(default=None, ge=1, le=6)


class MonthSummary(ORM):
    id: int
    year: int
    month: int
    status: str
    fx_rate_ntd_kes: Decimal
    weeks: int
    opened_at: datetime
    closed_at: datetime | None
    totals: dict


class MonthDetail(MonthSummary):
    lines: list[LineOut]
    copied_from: str | None = None
    # line id -> budget against actual for that line (see app/actuals.py)
    actuals: dict = {}
