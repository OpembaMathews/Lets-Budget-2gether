"""API routes for settings, months and budget lines."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from . import schemas
from .actuals import line_actuals
from .auth import get_db
from .profile import get_profile
from .models import Account, BudgetLine, Currency, Debt, ExpectedIncome, Goal, LineGroup, Location, Month, Recipient
from .services import (
    copy_forward,
    month_totals,
    previous_month,
    recalculate_weekly_lines,
    weekly_planned,
)

router = APIRouter(prefix="/api")

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
]


# ---- helpers ----------------------------------------------------------------

def _get(db: Session, model, key, what: str):
    obj = db.get(model, key)
    if obj is None:
        raise HTTPException(404, f"{what} not found")
    return obj


def _require_currency(db: Session, code: str) -> None:
    if db.get(Currency, code) is None:
        raise HTTPException(422, f"Unknown currency {code}")


def _groups(db: Session) -> dict[int, LineGroup]:
    return {g.id: g for g in db.scalars(select(LineGroup))}


def _load_month(db: Session, month_id: int) -> Month:
    stmt = select(Month).where(Month.id == month_id).options(selectinload(Month.lines))
    month = db.scalars(stmt).first()
    if month is None:
        raise HTTPException(404, "Month not found")
    return month


def _require_open(month: Month) -> None:
    if month.status == "closed":
        raise HTTPException(409, "This month is closed and cannot be changed")


def _resplit(db: Session, month_id: int) -> None:
    """Work out the month's payment splits again after its plan or rate changed.

    Splits follow the plan: a payment can only fund what a line now budgets,
    so a lowered budget frees money and a raised one can take more. Splits the
    user changed by hand are kept.
    """
    from .income import load_month as load_income_month  # imported here to avoid a cycle
    from .split import resplit_month

    db.flush()
    month = load_income_month(db, month_id)
    if month.arrivals:
        resplit_month(month)


def _note_core_change(month: Month, text: str) -> None:
    entry = f"{date.today().isoformat()}: {text}"
    month.core_note = f"{month.core_note}\n{entry}" if month.core_note else entry


def _month_summary(month: Month, groups: dict[int, LineGroup]) -> dict:
    return {
        "id": month.id,
        "year": month.year,
        "month": month.month,
        "status": month.status,
        "fx_rate_ntd_kes": month.fx_rate_ntd_kes,
        "weeks": month.weeks,
        "opened_at": month.opened_at,
        "closed_at": month.closed_at,
        "totals": month_totals(month, groups),
    }


def _month_detail(db: Session, month: Month, groups: dict[int, LineGroup], copied_from: str | None = None) -> dict:
    out = _month_summary(month, groups)
    out["actuals"] = line_actuals(db, month)
    out["lines"] = sorted(month.lines, key=lambda l: (l.sort_order, l.id))
    out["copied_from"] = copied_from
    return out


# ---- settings ---------------------------------------------------------------

@router.get("/meta", response_model=schemas.MetaOut)
def get_meta(db: Session = Depends(get_db)):
    locations = db.scalars(
        select(Location).options(selectinload(Location.groups)).order_by(Location.sort_order, Location.id)
    ).all()
    return {
        "currencies": db.scalars(select(Currency).order_by(Currency.code)).all(),
        "locations": locations,
        "accounts": db.scalars(select(Account).order_by(Account.id)).all(),
        "profile": get_profile(db),
    }


@router.post("/locations", response_model=schemas.LocationOut, status_code=201)
def create_location(body: schemas.LocationIn, db: Session = Depends(get_db)):
    _require_currency(db, body.default_currency)
    if db.scalars(select(Location).where(Location.name == body.name)).first():
        raise HTTPException(409, "A location with that name already exists")
    order = (db.scalar(select(func.max(Location.sort_order))) or 0) + 1
    location = Location(name=body.name, default_currency=body.default_currency, sort_order=order)
    db.add(location)
    db.commit()
    db.refresh(location)
    return location


@router.patch("/locations/{location_id}", response_model=schemas.LocationOut)
def update_location(location_id: int, body: schemas.LocationPatch, db: Session = Depends(get_db)):
    location = _get(db, Location, location_id, "Location")
    data = body.model_dump(exclude_unset=True)
    if "default_currency" in data:
        _require_currency(db, data["default_currency"])
    for key, value in data.items():
        if value is not None:
            setattr(location, key, value)
    db.commit()
    db.refresh(location)
    return location


@router.delete("/locations/{location_id}", status_code=204)
def delete_location(location_id: int, db: Session = Depends(get_db)):
    location = _get(db, Location, location_id, "Location")
    if location.groups:
        raise HTTPException(409, "Remove this location's sections first")
    db.delete(location)
    db.commit()


@router.post("/groups", response_model=schemas.GroupOut, status_code=201)
def create_group(body: schemas.GroupIn, db: Session = Depends(get_db)):
    _get(db, Location, body.location_id, "Location")
    order = (db.scalar(select(func.max(LineGroup.sort_order))) or 0) + 1
    group = LineGroup(name=body.name, location_id=body.location_id, sort_order=order)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.patch("/groups/{group_id}", response_model=schemas.GroupOut)
def update_group(group_id: int, body: schemas.GroupPatch, db: Session = Depends(get_db)):
    group = _get(db, LineGroup, group_id, "Section")
    data = body.model_dump(exclude_unset=True)
    if data.get("location_id") is not None:
        _get(db, Location, data["location_id"], "Location")
    if data.get("usual_recipient_id") is not None:
        _get(db, Recipient, data["usual_recipient_id"], "Recipient")
    for key, value in data.items():
        # the usual recipient may be cleared; the other fields cannot be null
        if value is not None or key == "usual_recipient_id":
            setattr(group, key, value)
    db.commit()
    db.refresh(group)
    return group


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(group_id: int, db: Session = Depends(get_db)):
    group = _get(db, LineGroup, group_id, "Section")
    used = db.scalar(select(func.count()).select_from(BudgetLine).where(BudgetLine.group_id == group_id))
    if used:
        raise HTTPException(409, f"This section still has {used} line(s) in your months")
    db.delete(group)
    db.commit()


@router.post("/accounts", response_model=schemas.AccountOut, status_code=201)
def create_account(body: schemas.AccountIn, db: Session = Depends(get_db)):
    _require_currency(db, body.currency_code)
    account = Account(**body.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.patch("/accounts/{account_id}", response_model=schemas.AccountOut)
def update_account(account_id: int, body: schemas.AccountPatch, db: Session = Depends(get_db)):
    account = _get(db, Account, account_id, "Account")
    data = body.model_dump(exclude_unset=True)
    if data.get("currency_code") is not None:
        _require_currency(db, data["currency_code"])
    for key, value in data.items():
        if value is not None:
            setattr(account, key, value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, Account, account_id, "Account"))
    db.commit()


# ---- months -----------------------------------------------------------------

@router.get("/months", response_model=list[schemas.MonthSummary])
def list_months(db: Session = Depends(get_db)):
    groups = _groups(db)
    months = db.scalars(
        select(Month).options(selectinload(Month.lines)).order_by(Month.year.desc(), Month.month.desc())
    ).all()
    return [_month_summary(m, groups) for m in months]


@router.post("/months", response_model=schemas.MonthDetail, status_code=201)
def create_month(body: schemas.MonthIn, db: Session = Depends(get_db)):
    exists = db.scalars(select(Month).where(Month.year == body.year, Month.month == body.month)).first()
    if exists:
        raise HTTPException(409, f"{MONTH_NAMES[body.month]} {body.year} already exists")

    source = previous_month(db, body.year, body.month)
    rate = body.fx_rate_ntd_kes or (source.fx_rate_ntd_kes if source else None)
    if rate is None:
        raise HTTPException(422, "Enter the NTD to KES rate for the first month")

    month = Month(
        year=body.year,
        month=body.month,
        status="planning",
        fx_rate_ntd_kes=rate,
        weeks=body.weeks or (source.weeks if source else 4),
    )
    copied_from = None
    if body.copy_previous and source is not None:
        db.refresh(source, ["lines"])
        copy_forward(source, month)
        db.refresh(source, ["expected"])
        for exp in source.expected:  # expected income carries over as well
            month.expected.append(ExpectedIncome(
                source_id=exp.source_id, amount=exp.amount, expected_day=exp.expected_day))
        copied_from = f"{MONTH_NAMES[source.month]} {source.year}"
    db.add(month)
    db.commit()
    return _month_detail(db, _load_month(db, month.id), _groups(db), copied_from)


@router.get("/months/{month_id}", response_model=schemas.MonthDetail)
def get_month(month_id: int, db: Session = Depends(get_db)):
    return _month_detail(db, _load_month(db, month_id), _groups(db))


@router.patch("/months/{month_id}", response_model=schemas.MonthDetail)
def update_month(month_id: int, body: schemas.MonthPatch, db: Session = Depends(get_db)):
    month = _load_month(db, month_id)
    _require_open(month)
    if body.fx_rate_ntd_kes is not None:
        month.fx_rate_ntd_kes = body.fx_rate_ntd_kes
    if body.weeks is not None and body.weeks != month.weeks:
        month.weeks = body.weeks
        recalculate_weekly_lines(month)
    _resplit(db, month_id)
    db.commit()
    return _month_detail(db, _load_month(db, month_id), _groups(db))


@router.delete("/months/{month_id}", status_code=204)
def delete_month(month_id: int, db: Session = Depends(get_db)):
    month = _load_month(db, month_id)
    if month.status != "planning":
        raise HTTPException(409, "Only a month that is still being planned can be deleted")
    db.delete(month)
    db.commit()


# ---- budget lines -----------------------------------------------------------

@router.post("/months/{month_id}/lines", response_model=schemas.LineOut, status_code=201)
def create_line(month_id: int, body: schemas.LineIn, db: Session = Depends(get_db)):
    month = _load_month(db, month_id)
    _require_open(month)
    _get(db, LineGroup, body.group_id, "Section")
    if body.goal_id is not None:
        _get(db, Goal, body.goal_id, "Project")
    if body.debt_id is not None:
        _get(db, Debt, body.debt_id, "Debt")
    _require_currency(db, body.currency_code)

    data = body.model_dump()
    if data["weekly_amount"] is not None:
        data["planned"] = weekly_planned(data["weekly_amount"], month.weeks)
    order = max((l.sort_order for l in month.lines), default=0) + 1
    line = BudgetLine(month_id=month.id, sort_order=order, **data)
    db.add(line)
    _resplit(db, month.id)
    db.commit()
    db.refresh(line)
    return line


@router.patch("/lines/{line_id}", response_model=schemas.LineOut)
def update_line(line_id: int, body: schemas.LinePatch, db: Session = Depends(get_db)):
    line = _get(db, BudgetLine, line_id, "Line")
    month = _get(db, Month, line.month_id, "Month")
    _require_open(month)

    data = body.model_dump(exclude_unset=True)
    if data.get("group_id") is not None:
        _get(db, LineGroup, data["group_id"], "Section")
    if data.get("goal_id") is not None:
        _get(db, Goal, data["goal_id"], "Project")
    if data.get("recipient_id") is not None:
        _get(db, Recipient, data["recipient_id"], "Recipient")
    if data.get("debt_id") is not None:
        _get(db, Debt, data["debt_id"], "Debt")
    if data.get("currency_code") is not None:
        _require_currency(db, data["currency_code"])

    reason = (data.pop("reason", None) or "").strip()
    was_core, old_planned = line.is_core, line.planned
    if data.get("is_core"):
        others = select(BudgetLine).where(BudgetLine.month_id == month.id, BudgetLine.is_core)
        for other in db.scalars(others):
            if other.id != line.id:
                other.is_core = False  # only one core saving per month

    amount_changed = "planned" in data or "weekly_amount" in data
    for key, value in data.items():
        # these may be cleared; the other fields cannot be null
        if value is None and key not in ("weekly_amount", "note", "destination_account_id", "actual", "goal_id",
                                         "recipient_id", "debt_id"):
            continue
        setattr(line, key, value)
    if line.weekly_amount is not None:
        line.planned = weekly_planned(line.weekly_amount, month.weeks)

    # The core saving cannot be reduced or switched off silently.
    if was_core and (line.planned < old_planned or not line.is_core):
        if not reason:
            db.rollback()
            raise HTTPException(409, "The core saving is your fixed monthly saving. Give a reason to reduce it.")
        what = (f"reduced from {old_planned:,.2f} to {line.planned:,.2f}"
                if line.is_core else "no longer marked as the core saving")
        _note_core_change(month, f"Core saving {what}. Reason: {reason}")
    if amount_changed and "needs_review" not in data:
        line.needs_review = False  # editing the amount confirms it

    if set(data) - {"name", "note", "needs_review", "goal_id", "recipient_id", "debt_id"}:  # anything that changes who gets funded
        _resplit(db, month.id)
    db.commit()
    db.refresh(line)
    return line


@router.delete("/lines/{line_id}", status_code=204)
def delete_line(line_id: int, reason: str | None = None, db: Session = Depends(get_db)):
    line = _get(db, BudgetLine, line_id, "Line")
    month = _get(db, Month, line.month_id, "Month")
    _require_open(month)
    if line.is_core:
        if not (reason or "").strip():
            raise HTTPException(409, "The core saving is your fixed monthly saving. Give a reason to remove it.")
        _note_core_change(month, f"Core saving of {line.planned:,.2f} removed. Reason: {reason.strip()}")
    db.delete(line)
    _resplit(db, month.id)
    db.commit()


@router.post("/months/{month_id}/confirm-all", response_model=schemas.MonthDetail)
def confirm_all(month_id: int, db: Session = Depends(get_db)):
    """Accept every carried-over suggestion in one go."""
    month = _load_month(db, month_id)
    _require_open(month)
    for line in month.lines:
        line.needs_review = False
    db.commit()
    return _month_detail(db, _load_month(db, month_id), _groups(db))
