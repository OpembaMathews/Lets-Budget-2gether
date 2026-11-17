"""API routes for income sources, expected income, payments and their splits."""
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .auth import get_db
from .models import (
    Allocation, AppSetting, BudgetLine, Currency, ExpectedIncome, IncomeArrival, IncomeSource, Month, SplitRule,
)
from .services import convert
from .split import income_view, line_coverage, plan_fit, resplit_month, split_order, store_slices, suggest_split
from .types import to_money

router = APIRouter(prefix="/api")

Reliability = Literal["regular", "irregular"]
RuleType = Literal["none", "percent_first", "fixed_first", "three_way"]
AllocKind = Literal["core_saving", "savings", "essential", "flexible", "project"]


class SourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    currency_code: str
    usual_day: int | None = Field(default=None, ge=1, le=31)
    reliability: Reliability = "regular"
    active: bool = True
    rule_type: RuleType = "percent_first"
    save_percent: Decimal | None = Field(default=None, ge=0, le=100)
    save_fixed: Decimal | None = Field(default=None, ge=0)
    obligations_percent: Decimal | None = Field(default=None, ge=0, le=100)


class SourcePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    currency_code: str | None = None
    usual_day: int | None = Field(default=None, ge=1, le=31)
    reliability: Reliability | None = None
    active: bool | None = None
    rule_type: RuleType | None = None
    save_percent: Decimal | None = Field(default=None, ge=0, le=100)
    save_fixed: Decimal | None = Field(default=None, ge=0)
    obligations_percent: Decimal | None = Field(default=None, ge=0, le=100)


class ExpectedIn(BaseModel):
    source_id: int
    # Left out, the amount stays as it is and only the day changes.
    amount: Decimal | None = Field(default=None, ge=0)
    expected_day: int | None = Field(default=None, ge=1, le=31)


class ArrivalIn(BaseModel):
    source_id: int
    amount: Decimal = Field(gt=0)
    received_date: date
    note: str | None = None


class SliceIn(BaseModel):
    kind: AllocKind
    budget_line_id: int | None = None
    amount: Decimal = Field(ge=0)


class ActivateIn(BaseModel):
    shortfall_source: str | None = None


# ---- helpers ----------------------------------------------------------------

def load_month(db: Session, month_id: int) -> Month:
    stmt = (
        select(Month)
        .where(Month.id == month_id)
        .options(
            selectinload(Month.lines),
            selectinload(Month.expected).selectinload(ExpectedIncome.source).selectinload(IncomeSource.rule),
            selectinload(Month.arrivals).selectinload(IncomeArrival.allocations),
            selectinload(Month.arrivals).selectinload(IncomeArrival.source).selectinload(IncomeSource.rule),
        )
        .execution_options(populate_existing=True)
    )
    month = db.scalars(stmt).first()
    if month is None:
        raise HTTPException(404, "Month not found")
    return month


def _open(month: Month) -> None:
    if month.status == "closed":
        raise HTTPException(409, "This month is closed and cannot be changed")


def _source(db: Session, source_id: int) -> IncomeSource:
    source = db.get(IncomeSource, source_id)
    if source is None:
        raise HTTPException(404, "Income source not found")
    return source


def _arrival(db: Session, arrival_id: int) -> IncomeArrival:
    arrival = db.get(IncomeArrival, arrival_id)
    if arrival is None:
        raise HTTPException(404, "Payment not found")
    return arrival


def _check_rule(rule_type: str, save_percent, obligations_percent) -> None:
    if rule_type == "three_way" and (save_percent or 0) + (obligations_percent or 0) > 100:
        raise HTTPException(422, "Savings and obligations together cannot be more than 100%")


def _view(db: Session, month_id: int) -> dict:
    return income_view(db, load_month(db, month_id))


# ---- income sources ---------------------------------------------------------

RULE_FIELDS = ("rule_type", "save_percent", "save_fixed", "obligations_percent")


@router.post("/income-sources", status_code=201)
def create_source(body: SourceIn, db: Session = Depends(get_db)):
    if db.get(Currency, body.currency_code) is None:
        raise HTTPException(422, f"Unknown currency {body.currency_code}")
    _check_rule(body.rule_type, body.save_percent, body.obligations_percent)
    order = (db.scalar(select(func.max(IncomeSource.sort_order))) or 0) + 1
    data = body.model_dump()
    rule = SplitRule(**{k: data.pop(k) for k in RULE_FIELDS})
    source = IncomeSource(sort_order=order, rule=rule, **data)
    db.add(source)
    db.commit()
    return {"id": source.id}


@router.patch("/income-sources/{source_id}")
def update_source(source_id: int, body: SourcePatch, db: Session = Depends(get_db)):
    source = _source(db, source_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("currency_code") is not None and db.get(Currency, data["currency_code"]) is None:
        raise HTTPException(422, f"Unknown currency {data['currency_code']}")
    if source.rule is None:
        source.rule = SplitRule(rule_type="none")
    for key, value in data.items():
        target = source.rule if key in RULE_FIELDS else source
        # these may be cleared; the others cannot be null
        if value is None and key not in ("usual_day", "save_percent", "save_fixed", "obligations_percent"):
            continue
        setattr(target, key, value)
    _check_rule(source.rule.rule_type, source.rule.save_percent, source.rule.obligations_percent)
    db.commit()
    return {"id": source.id}


@router.delete("/income-sources/{source_id}", status_code=204)
def delete_source(source_id: int, db: Session = Depends(get_db)):
    source = _source(db, source_id)
    used = db.scalar(select(func.count()).select_from(IncomeArrival).where(IncomeArrival.source_id == source_id))
    if used:
        raise HTTPException(409, "This source has payments recorded. Mark it as not in use instead.")
    db.delete(source)
    db.commit()


# ---- the month's income picture ---------------------------------------------

@router.get("/months/{month_id}/income")
def get_income(month_id: int, db: Session = Depends(get_db)):
    return _view(db, month_id)


@router.put("/months/{month_id}/expected")
def set_expected(month_id: int, body: ExpectedIn, db: Session = Depends(get_db)):
    month = load_month(db, month_id)
    _open(month)
    _source(db, body.source_id)
    row = next((e for e in month.expected if e.source_id == body.source_id), None)
    if row is None:
        row = ExpectedIncome(month_id=month.id, source_id=body.source_id, amount=Decimal("0"))
        db.add(row)
    if body.amount is not None:
        row.amount = body.amount
    if "expected_day" in body.model_fields_set:
        row.expected_day = body.expected_day
    db.commit()
    return _view(db, month_id)


@router.post("/months/{month_id}/activate")
def activate_month(month_id: int, body: ActivateIn, db: Session = Depends(get_db)):
    """Start the month. Blocked while the plan is larger than reliable income."""
    month = load_month(db, month_id)
    _open(month)
    fit = plan_fit(month)
    if fit["needs_review"]:
        raise HTTPException(409, f"Confirm the {fit['needs_review']} carried-over amount(s) on the plan first")
    source = (body.shortfall_source or "").strip()
    if not fit["fits"] and not source:
        raise HTTPException(
            409,
            f"The plan is KES {fit['gap_kes']:,.2f} larger than your reliable income. "
            "Reduce flexible lines, or say where the shortfall will come from.",
        )
    month.status = "active"
    month.shortfall_amount = fit["gap_kes"] if not fit["fits"] else None
    month.shortfall_source = source if not fit["fits"] else None
    db.commit()
    return _view(db, month_id)


@router.post("/months/{month_id}/back-to-planning")
def back_to_planning(month_id: int, db: Session = Depends(get_db)):
    month = load_month(db, month_id)
    _open(month)
    month.status = "planning"
    db.commit()
    return _view(db, month_id)


# ---- payments ---------------------------------------------------------------

@router.post("/months/{month_id}/arrivals", status_code=201)
def record_arrival(month_id: int, body: ArrivalIn, db: Session = Depends(get_db)):
    month = load_month(db, month_id)
    _open(month)
    # Money can always be recorded in an open month. The plan check still shows on
    # screen; it no longer stops a payment being added.
    source = _source(db, body.source_id)
    # Saved straight away with the suggested split, so the next payment can be
    # recorded at once. The split can still be adjusted afterwards.
    arrival = IncomeArrival(
        month_id=month.id, source_id=source.id, amount=body.amount, currency_code=source.currency_code,
        received_date=body.received_date, note=body.note, confirmed=True,
    )
    arrival.source = source
    month.arrivals.append(arrival)
    resplit_month(month)
    if month.status == "planning":
        fit = plan_fit(month)
        if fit["fits"] and not fit["needs_review"]:
            month.status = "active"  # the first payment starts a month whose plan fits
    db.commit()
    return _view(db, month_id)


@router.post("/arrivals/{arrival_id}/resuggest")
def resuggest(arrival_id: int, db: Session = Depends(get_db)):
    arrival = _arrival(db, arrival_id)
    month = load_month(db, arrival.month_id)
    _open(month)
    arrival = next(a for a in month.arrivals if a.id == arrival_id)
    arrival.adjusted = False
    resplit_month(month)
    db.commit()
    return _view(db, month.id)


@router.put("/arrivals/{arrival_id}/allocations")
def set_allocations(arrival_id: int, body: list[SliceIn], db: Session = Depends(get_db)):
    """Replace a payment's split. Whatever is not assigned becomes free to spend."""
    arrival = _arrival(db, arrival_id)
    month = load_month(db, arrival.month_id)
    _open(month)
    arrival = next(a for a in month.arrivals if a.id == arrival_id)
    lines = {l.id: l for l in month.lines}
    rate = month.fx_rate_ntd_kes
    covered = line_coverage(month, exclude_arrival_id=arrival_id)  # every other payment

    slices, total = [], Decimal("0")
    for item in body:
        amount = to_money(item.amount)
        if amount <= 0:
            continue
        line_amount = None
        if item.budget_line_id is not None:
            line = lines.get(item.budget_line_id)
            if line is None:
                raise HTTPException(422, "A slice points at a line that is not in this month")
            line_amount = convert(amount, arrival.currency_code, line.currency_code, rate)
            # A slice that exactly funds what the line still needs keeps the exact
            # figure, so converting there and back does not add or lose a cent.
            outstanding = line.planned - covered.get(line.id, Decimal("0"))
            if outstanding > 0 and amount == convert(outstanding, line.currency_code, arrival.currency_code, rate):
                line_amount = outstanding
        elif item.kind != "savings":
            raise HTTPException(422, "Only savings can be set aside without a budget line")
        slices.append({"kind": item.kind, "amount": amount,
                       "budget_line_id": item.budget_line_id, "line_amount": line_amount})
        total += amount

    if total > arrival.amount:
        over = total - arrival.amount
        raise HTTPException(422, f"The split is {arrival.currency_code} {over:,.2f} more than the payment")
    if arrival.amount - total > 0:
        slices.append({"kind": "free", "amount": arrival.amount - total,
                       "budget_line_id": None, "line_amount": None})
    store_slices(arrival, slices)
    arrival.adjusted = True
    db.flush()
    resplit_month(month)  # later payments follow the new split
    db.commit()
    return _view(db, month.id)


@router.post("/arrivals/{arrival_id}/confirm")
def confirm_arrival(arrival_id: int, db: Session = Depends(get_db)):
    arrival = _arrival(db, arrival_id)
    _open(db.get(Month, arrival.month_id))
    arrival.confirmed = True
    db.commit()
    return _view(db, arrival.month_id)


@router.delete("/arrivals/{arrival_id}")
def delete_arrival(arrival_id: int, db: Session = Depends(get_db)):
    arrival = _arrival(db, arrival_id)
    month_id = arrival.month_id
    _open(db.get(Month, month_id))
    db.delete(arrival)
    db.flush()
    # What this payment funded is free again, so the others are split again.
    resplit_month(load_month(db, month_id))
    db.commit()
    return _view(db, month_id)


@router.get("/income-sources")
def list_sources(db: Session = Depends(get_db)):
    """Income sources with their rules, for the settings screen."""
    from .split import jsonify

    rows = db.scalars(select(IncomeSource).order_by(IncomeSource.sort_order, IncomeSource.id)).all()
    return jsonify([
        {
            "id": s.id, "name": s.name, "currency_code": s.currency_code, "usual_day": s.usual_day,
            "reliability": s.reliability, "active": s.active,
            "rule_type": s.rule.rule_type if s.rule else "none",
            "save_percent": s.rule.save_percent if s.rule else None,
            "save_fixed": s.rule.save_fixed if s.rule else None,
            "obligations_percent": s.rule.obligations_percent if s.rule else None,
        }
        for s in rows
    ])



class SplitOrderIn(BaseModel):
    order: Literal["bills_first", "savings_first"]


@router.get("/settings/split-order")
def get_split_order(db: Session = Depends(get_db)):
    return {"order": split_order(db)}


@router.put("/settings/split-order")
def set_split_order(body: SplitOrderIn, db: Session = Depends(get_db)):
    """Change the order, then share out every open month's payments again."""
    setting = db.get(AppSetting, "split_order")
    if setting is None:
        db.add(AppSetting(key="split_order", value=body.order))
    else:
        setting.value = body.order
    db.flush()
    for month_id in db.scalars(select(Month.id).where(Month.status != "closed")):
        month = load_month(db, month_id)
        if month.arrivals:
            resplit_month(month)
    db.commit()
    return {"order": body.order}


class SetupIn(BaseModel):
    pending: bool


@router.get("/settings/setup")
def get_setup(db: Session = Depends(get_db)):
    """Whether this budget is still waiting for its first-time set-up."""
    return {"pending": db.get(AppSetting, "setup_pending") is not None}


@router.put("/settings/setup")
def set_setup(body: SetupIn, db: Session = Depends(get_db)):
    """Finish the set-up guide, or open it again."""
    setting = db.get(AppSetting, "setup_pending")
    if body.pending and setting is None:
        db.add(AppSetting(key="setup_pending", value="1"))
    elif not body.pending and setting is not None:
        db.delete(setting)
    db.commit()
    return {"pending": body.pending}
