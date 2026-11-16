"""Debts: loans, items on credit and overdrafts such as Fuliza.

Balance = starting balance + money borrowed since - repayments.
Repayments are the actuals of plan lines linked to the debt (in every month)
plus repayments recorded by hand. A linked repayment line is a bill, so the
payment split pays it with the other bills.
"""
import math
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .actuals import line_actuals
from .auth import get_db
from .models import BudgetLine, Currency, Debt, DebtEntry, LineGroup, Location, Month
from .services import convert
from .split import jsonify

router = APIRouter(prefix="/api")
ZERO = Decimal("0.00")
MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class DebtIn(BaseModel):
    lender: str = Field(min_length=1, max_length=80)
    currency_code: str = "KES"
    starting_balance: Decimal = Field(default=Decimal("0"), ge=0)
    monthly_repayment: Decimal | None = Field(default=None, ge=0)
    started_on: date | None = None
    note: str | None = None


class DebtPatch(BaseModel):
    lender: str | None = Field(default=None, min_length=1, max_length=80)
    currency_code: str | None = None
    starting_balance: Decimal | None = Field(default=None, ge=0)
    monthly_repayment: Decimal | None = Field(default=None, ge=0)
    started_on: date | None = None
    status: Literal["open", "cleared"] | None = None
    note: str | None = None


class DebtEntryIn(BaseModel):
    entry_date: date
    kind: Literal["borrowed", "repaid"]
    amount: Decimal = Field(gt=0)
    note: str | None = None


def debts_view(db: Session, month_id: int | None) -> dict:
    months = db.scalars(select(Month).options(selectinload(Month.lines)).order_by(Month.year, Month.month)).all()
    chosen = next((m for m in months if m.id == month_id), months[-1] if months else None)
    debts = db.scalars(select(Debt).options(selectinload(Debt.entries)).order_by(Debt.id)).all()
    by_id = {d.id: d for d in debts}
    groups = {g.id: g for g in db.scalars(select(LineGroup))}
    locations = {l.id: l for l in db.scalars(select(Location))}

    repaid_lines = {d.id: ZERO for d in debts}
    history = {d.id: [] for d in debts}
    this_month = {d.id: [] for d in debts}
    for m in months:
        linked = [l for l in m.lines if l.debt_id in by_id]
        if not linked:
            continue
        actuals = line_actuals(db, m)
        for line in linked:
            debt = by_id[line.debt_id]
            paid = convert(Decimal(actuals[line.id]["actual"]), line.currency_code, debt.currency_code, m.fx_rate_ntd_kes)
            if paid > 0:
                repaid_lines[debt.id] += paid
                history[debt.id].append({"when": f"{MONTHS[m.month]} {m.year}", "sort": (m.year, m.month, 0),
                                         "what": f"Repaid: {line.name}", "amount": -paid})
            if chosen is not None and m.id == chosen.id:
                group = groups.get(line.group_id)
                this_month[debt.id].append({
                    "line_id": line.id, "name": line.name, "currency_code": line.currency_code,
                    "planned": line.planned, "actual": Decimal(actuals[line.id]["actual"]),
                    "where": f"{locations[group.location_id].name} / {group.name}" if group else None,
                    "planned_in_debt_currency": convert(line.planned, line.currency_code, debt.currency_code,
                                                        m.fx_rate_ntd_kes),
                })

    linkable = []
    if chosen is not None:
        for line in sorted(chosen.lines, key=lambda l: (l.sort_order, l.id)):
            if line.debt_id is None and line.goal_id is None and not line.is_core:
                group = groups.get(line.group_id)
                linkable.append({"line_id": line.id, "name": line.name, "currency_code": line.currency_code,
                                 "planned": line.planned, "kind": line.kind,
                                 "where": f"{locations[group.location_id].name} / {group.name}" if group else None})

    rows, totals = [], {}
    rate = chosen.fx_rate_ntd_kes if chosen else Decimal("1")
    for d in debts:
        borrowed = sum((e.amount for e in d.entries if e.kind == "borrowed"), ZERO)
        repaid_by_hand = sum((e.amount for e in d.entries if e.kind == "repaid"), ZERO)
        repaid = repaid_lines[d.id] + repaid_by_hand
        balance = d.starting_balance + borrowed - repaid
        planned = sum((l["planned_in_debt_currency"] for l in this_month[d.id]), ZERO)
        pace = planned if planned > 0 else (d.monthly_repayment or ZERO)
        months_left, clear_by = None, None
        if balance <= 0:
            months_left = 0
        elif pace > 0 and chosen is not None:
            months_left = math.ceil(balance / pace)
            index = chosen.year * 12 + (chosen.month - 1) + months_left - 1
            clear_by = date(index // 12, index % 12 + 1, 1)
        entries = [{"when": e.entry_date.isoformat(), "sort": (e.entry_date.year, e.entry_date.month, e.entry_date.day),
                    "what": (e.note or ("Borrowed" if e.kind == "borrowed" else "Repaid")),
                    "amount": e.amount if e.kind == "borrowed" else -e.amount, "entry_id": e.id} for e in d.entries]
        start = [{"when": d.started_on.isoformat() if d.started_on else "Start", "sort": (0, 0, 0),
                  "what": "Owed at the start", "amount": d.starting_balance}] if d.starting_balance > 0 else []
        hist = start + history[d.id] + entries
        hist.sort(key=lambda h: h.pop("sort"))
        rows.append({
            "id": d.id, "lender": d.lender, "currency_code": d.currency_code, "starting_balance": d.starting_balance,
            "monthly_repayment": d.monthly_repayment, "started_on": d.started_on, "status": d.status, "note": d.note,
            "borrowed": borrowed, "repaid": repaid, "balance": balance, "this_month": planned,
            "months_left": months_left, "clear_by": clear_by, "lines": this_month[d.id], "history": hist,
        })
        if d.status == "open" and balance > 0:
            t = totals.setdefault(d.currency_code, ZERO)
            totals[d.currency_code] = t + balance

    total_kes = sum((convert(v, code, "KES", rate) for code, v in totals.items()), ZERO)
    return jsonify({
        "month": {"id": chosen.id, "label": f"{MONTHS[chosen.month]} {chosen.year}"} if chosen else None,
        "debts": rows, "totals": totals, "total_kes": total_kes, "linkable_lines": linkable,
    })


def _debt(db: Session, debt_id: int) -> Debt:
    debt = db.get(Debt, debt_id)
    if debt is None:
        raise HTTPException(404, "Debt not found")
    return debt


@router.get("/debts")
def get_debts(month_id: int | None = None, db: Session = Depends(get_db)):
    return debts_view(db, month_id)


@router.post("/debts", status_code=201)
def create_debt(body: DebtIn, month_id: int | None = None, db: Session = Depends(get_db)):
    if db.get(Currency, body.currency_code) is None:
        raise HTTPException(422, f"Unknown currency {body.currency_code}")
    db.add(Debt(**body.model_dump()))
    db.commit()
    return debts_view(db, month_id)


@router.patch("/debts/{debt_id}")
def update_debt(debt_id: int, body: DebtPatch, month_id: int | None = None, db: Session = Depends(get_db)):
    debt = _debt(db, debt_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("currency_code") is not None and db.get(Currency, data["currency_code"]) is None:
        raise HTTPException(422, f"Unknown currency {data['currency_code']}")
    for key, value in data.items():
        if value is not None or key in ("monthly_repayment", "started_on", "note"):
            setattr(debt, key, value)
    db.commit()
    return debts_view(db, month_id)


@router.delete("/debts/{debt_id}")
def delete_debt(debt_id: int, month_id: int | None = None, db: Session = Depends(get_db)):
    debt = _debt(db, debt_id)
    for line in db.scalars(select(BudgetLine).where(BudgetLine.debt_id == debt_id)):
        line.debt_id = None  # repayment lines stay in the plan
    db.delete(debt)
    db.commit()
    return debts_view(db, month_id)


@router.post("/debts/{debt_id}/entries", status_code=201)
def add_debt_entry(debt_id: int, body: DebtEntryIn, month_id: int | None = None, db: Session = Depends(get_db)):
    debt = _debt(db, debt_id)
    debt.entries.append(DebtEntry(**body.model_dump()))
    if body.kind == "borrowed" and debt.status == "cleared":
        debt.status = "open"
    db.commit()
    return debts_view(db, month_id)


@router.delete("/debt-entries/{entry_id}")
def delete_debt_entry(entry_id: int, month_id: int | None = None, db: Session = Depends(get_db)):
    entry = db.get(DebtEntry, entry_id)
    if entry is None:
        raise HTTPException(404, "Entry not found")
    db.delete(entry)
    db.commit()
    return debts_view(db, month_id)
