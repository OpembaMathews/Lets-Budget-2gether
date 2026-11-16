"""Projects and savings goals.

Funded  = money already in before tracking (opening amount)
        + the actual of every plan line linked to the goal, in every month
        + its share of each month's extra savings (see below)
        + one-off entries (a bonus, money from outside the plan).

Extra savings (the percentage each payment saves) are shared each month to open
goals in priority order. A goal with a monthly amount gets up to that amount,
less what plan lines linked to it already planned that month, and never more
than it still needs. What is left over stays as savings not given to a goal.
Spent   = the actual cost of the project's breakdown items.
Needed  = target - funded.

Amounts are shown in the goal's own currency; a linked line in the other
currency is converted at that month's planning rate.
"""
import math
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .actuals import line_actuals
from .auth import get_db
from .models import BudgetLine, Currency, Goal, GoalEntry, GoalItem, IncomeArrival, LineGroup, Location, Month
from .services import convert
from .split import jsonify
from .types import to_money

router = APIRouter(prefix="/api")

ZERO = Decimal("0.00")
MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
OPEN = ("planning", "active", "on_hold")

Kind = Literal["project", "saving_goal"]
Status = Literal["planning", "active", "on_hold", "completed", "cancelled"]
Importance = Literal["high", "medium", "low"]


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Kind = "project"
    category: str | None = Field(default=None, max_length=60)
    currency_code: str = "KES"
    target: Decimal = Field(default=Decimal("0"), ge=0)
    opening_amount: Decimal = Field(default=Decimal("0"), ge=0)
    monthly_amount: Decimal | None = Field(default=None, ge=0)
    target_date: date | None = None
    importance: Importance = "medium"
    status: Status = "planning"
    funded_from: str | None = Field(default=None, max_length=80)
    note: str | None = None


class GoalPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: Kind | None = None
    category: str | None = Field(default=None, max_length=60)
    currency_code: str | None = None
    target: Decimal | None = Field(default=None, ge=0)
    opening_amount: Decimal | None = Field(default=None, ge=0)
    monthly_amount: Decimal | None = Field(default=None, ge=0)
    target_date: date | None = None
    importance: Importance | None = None
    status: Status | None = None
    funded_from: str | None = Field(default=None, max_length=80)
    note: str | None = None


class MoveIn(BaseModel):
    direction: Literal["up", "down"]


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str | None = Field(default=None, max_length=40)
    estimate: Decimal = Field(default=Decimal("0"), ge=0)
    actual: Decimal | None = Field(default=None, ge=0)
    done: bool = False


class ItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    category: str | None = Field(default=None, max_length=40)
    estimate: Decimal | None = Field(default=None, ge=0)
    actual: Decimal | None = Field(default=None, ge=0)
    done: bool | None = None


class EntryIn(BaseModel):
    entry_date: date
    amount: Decimal = Field(gt=0)
    note: str | None = None


# ---- figures --------------------------------------------------------------------

def _label(m: Month) -> str:
    return f"{MONTHS[m.month]} {m.year}"


def goals_view(db: Session, month_id: int | None) -> dict:
    months = db.scalars(
        select(Month).options(selectinload(Month.lines)).order_by(Month.year, Month.month)
    ).all()
    chosen = next((m for m in months if m.id == month_id), months[-1] if months else None)
    groups = {g.id: g for g in db.scalars(select(LineGroup))}
    locations = {l.id: l for l in db.scalars(select(Location))}
    goals = db.scalars(
        select(Goal).options(selectinload(Goal.items), selectinload(Goal.entries)).order_by(Goal.rank, Goal.id)
    ).all()

    # Funding from plan lines, month by month.
    per_goal_history: dict[int, list[dict]] = {g.id: [] for g in goals}
    per_goal_lines: dict[int, Decimal] = {g.id: ZERO for g in goals}
    chosen_lines: dict[int, list[dict]] = {g.id: [] for g in goals}
    by_id = {g.id: g for g in goals}
    for m in months:
        linked = [l for l in m.lines if l.goal_id in by_id]
        if not linked:
            continue
        actuals = line_actuals(db, m)
        for line in linked:
            goal = by_id[line.goal_id]
            a = actuals[line.id]
            got = convert(Decimal(a["actual"]), line.currency_code, goal.currency_code, m.fx_rate_ntd_kes)
            planned = convert(line.planned, line.currency_code, goal.currency_code, m.fx_rate_ntd_kes)
            if got > 0:
                per_goal_lines[goal.id] += got
                per_goal_history[goal.id].append({
                    "when": _label(m), "sort": (m.year, m.month, 0), "source": f"Plan: {line.name}", "amount": got,
                })
            if chosen is not None and m.id == chosen.id:
                group = groups.get(line.group_id)
                chosen_lines[goal.id].append({
                    "line_id": line.id, "name": line.name,
                    "where": f"{locations[group.location_id].name} / {group.name}" if group else None,
                    "currency_code": line.currency_code, "planned": line.planned,
                    "actual": Decimal(a["actual"]), "planned_in_goal_currency": planned,
                    "set_aside_to_send": Decimal(a["set_aside_to_send"]),
                })

    # Extra savings, month by month, shared to open goals in priority order.
    from_savings = {g.id: ZERO for g in goals}
    still_needed = {
        g.id: g.target - g.opening_amount - per_goal_lines[g.id] - sum((e.amount for e in g.entries), ZERO)
        for g in goals
    }
    unshared: dict[str, Decimal] = {}
    shared_this_month = ZERO
    open_goals = [g for g in goals if g.status in OPEN and g.monthly_amount]
    for m in months:
        pool: dict[str, Decimal] = {}
        arrivals = db.scalars(
            select(IncomeArrival)
            .where(IncomeArrival.month_id == m.id, IncomeArrival.confirmed)
            .options(selectinload(IncomeArrival.allocations))
        )
        for arrival in arrivals:
            for alloc in arrival.allocations:
                if alloc.kind == "savings":
                    pool[arrival.currency_code] = pool.get(arrival.currency_code, ZERO) + alloc.amount
        if not pool:
            continue
        planned_lines = {g.id: ZERO for g in goals}
        for line in m.lines:
            if line.goal_id in by_id:
                goal = by_id[line.goal_id]
                planned_lines[goal.id] += convert(line.planned, line.currency_code, goal.currency_code,
                                                  m.fx_rate_ntd_kes)
        for goal in open_goals:
            want = min(goal.monthly_amount - planned_lines[goal.id], still_needed[goal.id])
            for code in list(pool):
                if want <= 0:
                    break
                available = convert(pool[code], code, goal.currency_code, m.fx_rate_ntd_kes)
                give = min(want, available)
                if give <= 0:
                    continue
                pool[code] = max(ZERO, pool[code] - convert(give, goal.currency_code, code, m.fx_rate_ntd_kes))
                want -= give
                from_savings[goal.id] += give
                still_needed[goal.id] -= give
                per_goal_history[goal.id].append({
                    "when": _label(m), "sort": (m.year, m.month, 1), "source": "Extra savings", "amount": give,
                })
                if chosen is not None and m.id == chosen.id:
                    shared_this_month += convert(give, goal.currency_code, "KES", m.fx_rate_ntd_kes)
        if chosen is not None and m.id == chosen.id:
            unshared = {code: amount for code, amount in pool.items() if amount > 0}

    # Saving lines in the chosen month that are not linked yet, for the "link a line" choice.
    linkable = []
    if chosen is not None:
        for line in sorted(chosen.lines, key=lambda l: (l.sort_order, l.id)):
            if line.goal_id is None and not line.is_core:
                group = groups.get(line.group_id)
                linkable.append({
                    "line_id": line.id, "name": line.name, "kind": line.kind,
                    "where": f"{locations[group.location_id].name} / {group.name}" if group else None,
                    "currency_code": line.currency_code, "planned": line.planned,
                })

    rows, totals = [], {}
    rate = chosen.fx_rate_ntd_kes if chosen else Decimal("1")
    for g in goals:
        entries = sum((e.amount for e in g.entries), ZERO)
        funded = g.opening_amount + per_goal_lines[g.id] + from_savings[g.id] + entries
        needed = max(ZERO, g.target - funded)
        spent = sum((i.actual or ZERO for i in g.items), ZERO)
        estimate = sum((i.estimate for i in g.items), ZERO)
        this_month = sum((l["planned_in_goal_currency"] for l in chosen_lines[g.id]), ZERO)
        pace = this_month if this_month > 0 else (g.monthly_amount or ZERO)

        finish = None
        months_left = None
        if needed == 0:
            months_left = 0
        elif pace > 0 and chosen is not None:
            months_left = math.ceil(needed / pace)
            index = chosen.year * 12 + (chosen.month - 1) + months_left - 1
            finish = date(index // 12, index % 12 + 1, 1)
        on_time = None
        if g.target_date and needed > 0:
            on_time = finish is not None and finish <= g.target_date

        history = [{"when": "Before tracking", "sort": (0, 0, 0), "source": "Already in", "amount": g.opening_amount}] \
            if g.opening_amount > 0 else []
        history += per_goal_history[g.id]
        history += [{
            "when": e.entry_date.isoformat(), "sort": (e.entry_date.year, e.entry_date.month, e.entry_date.day),
            "source": e.note or "One-off", "amount": e.amount, "entry_id": e.id,
        } for e in g.entries]
        history.sort(key=lambda h: h.pop("sort"))

        rows.append({
            "id": g.id, "name": g.name, "kind": g.kind, "category": g.category, "currency_code": g.currency_code,
            "target": g.target, "opening_amount": g.opening_amount, "monthly_amount": g.monthly_amount,
            "target_date": g.target_date, "importance": g.importance, "status": g.status, "rank": g.rank,
            "funded_from": g.funded_from, "note": g.note,
            "funded": funded, "from_lines": per_goal_lines[g.id], "from_savings": from_savings[g.id],
            "from_entries": entries,
            "needed": needed, "percent": round(float(funded / g.target * 100), 1) if g.target > 0 else None,
            "spent": spent, "estimate": estimate,
            "this_month": this_month, "pace": pace, "months_left": months_left,
            "finish": finish, "on_time": on_time,
            "lines": chosen_lines[g.id], "history": history,
            "items": [{
                "id": i.id, "name": i.name, "category": i.category, "estimate": i.estimate,
                "actual": i.actual, "done": i.done,
            } for i in g.items],
        })
        if g.status in OPEN:
            t = totals.setdefault(g.currency_code, {"target": ZERO, "funded": ZERO, "needed": ZERO, "this_month": ZERO})
            t["target"] += g.target
            t["funded"] += funded
            t["needed"] += needed
            t["this_month"] += this_month

    needed_kes = sum((convert(t["needed"], code, "KES", rate) for code, t in totals.items()), ZERO)
    this_month_kes = sum((convert(t["this_month"], code, "KES", rate) for code, t in totals.items()), ZERO)
    return jsonify({
        "month": {"id": chosen.id, "label": _label(chosen), "rate": str(chosen.fx_rate_ntd_kes)} if chosen else None,
        "goals": rows,
        "totals": totals,
        "needed_kes": needed_kes,
        "this_month_kes": this_month_kes,
        "open_count": sum(1 for g in goals if g.status in OPEN),
        "savings_shared_kes": shared_this_month,
        "savings_unshared": unshared,
        "linkable_lines": linkable,
    })


# ---- helpers --------------------------------------------------------------------

def _goal(db: Session, goal_id: int) -> Goal:
    goal = db.get(Goal, goal_id)
    if goal is None:
        raise HTTPException(404, "Project not found")
    return goal


def _currency(db: Session, code: str) -> None:
    if db.get(Currency, code) is None:
        raise HTTPException(422, f"Unknown currency {code}")


def _renumber(db: Session) -> list[Goal]:
    """Keep ranks 1, 2, 3… with open goals first, then completed and cancelled ones."""
    goals = db.scalars(select(Goal).order_by(Goal.rank, Goal.id)).all()
    ordered = [g for g in goals if g.status in OPEN] + [g for g in goals if g.status not in OPEN]
    for i, g in enumerate(ordered, start=1):
        g.rank = i
    return ordered


# ---- routes ---------------------------------------------------------------------

@router.get("/goals")
def get_goals(month_id: int | None = None, db: Session = Depends(get_db)):
    return goals_view(db, month_id)


@router.post("/goals", status_code=201)
def create_goal(body: GoalIn, month_id: int | None = None, db: Session = Depends(get_db)):
    _currency(db, body.currency_code)
    goal = Goal(rank=(db.scalar(select(func.max(Goal.rank))) or 0) + 1, **body.model_dump())
    db.add(goal)
    db.flush()
    _renumber(db)
    db.commit()
    return goals_view(db, month_id)


@router.patch("/goals/{goal_id}")
def update_goal(goal_id: int, body: GoalPatch, month_id: int | None = None, db: Session = Depends(get_db)):
    goal = _goal(db, goal_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("currency_code") is not None:
        _currency(db, data["currency_code"])
    clearable = {"category", "monthly_amount", "target_date", "funded_from", "note"}
    for key, value in data.items():
        if value is not None or key in clearable:
            setattr(goal, key, value)
    if "status" in data:
        _renumber(db)
    db.commit()
    return goals_view(db, month_id)


@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: int, month_id: int | None = None, db: Session = Depends(get_db)):
    goal = _goal(db, goal_id)
    for line in db.scalars(select(BudgetLine).where(BudgetLine.goal_id == goal_id)):
        line.goal_id = None  # the plan lines stay; they just stop counting toward it
    db.delete(goal)
    db.flush()
    _renumber(db)
    db.commit()
    return goals_view(db, month_id)


@router.post("/goals/{goal_id}/move")
def move_goal(goal_id: int, body: MoveIn, month_id: int | None = None, db: Session = Depends(get_db)):
    _goal(db, goal_id)
    ordered = _renumber(db)
    i = next(n for n, g in enumerate(ordered) if g.id == goal_id)
    j = i - 1 if body.direction == "up" else i + 1
    if 0 <= j < len(ordered):
        ordered[i].rank, ordered[j].rank = ordered[j].rank, ordered[i].rank
    db.commit()
    return goals_view(db, month_id)


@router.post("/goals/{goal_id}/items", status_code=201)
def add_item(goal_id: int, body: ItemIn, month_id: int | None = None, db: Session = Depends(get_db)):
    goal = _goal(db, goal_id)
    order = max((i.sort_order for i in goal.items), default=0) + 1
    goal.items.append(GoalItem(sort_order=order, **body.model_dump()))
    db.commit()
    return goals_view(db, month_id)


@router.patch("/goal-items/{item_id}")
def update_item(item_id: int, body: ItemPatch, month_id: int | None = None, db: Session = Depends(get_db)):
    item = db.get(GoalItem, item_id)
    if item is None:
        raise HTTPException(404, "Item not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is not None or key in ("category", "actual"):
            setattr(item, key, value)
    db.commit()
    return goals_view(db, month_id)


@router.delete("/goal-items/{item_id}")
def delete_item(item_id: int, month_id: int | None = None, db: Session = Depends(get_db)):
    item = db.get(GoalItem, item_id)
    if item is None:
        raise HTTPException(404, "Item not found")
    db.delete(item)
    db.commit()
    return goals_view(db, month_id)


@router.post("/goals/{goal_id}/entries", status_code=201)
def add_entry(goal_id: int, body: EntryIn, month_id: int | None = None, db: Session = Depends(get_db)):
    goal = _goal(db, goal_id)
    goal.entries.append(GoalEntry(entry_date=body.entry_date, amount=to_money(body.amount), note=body.note))
    db.commit()
    return goals_view(db, month_id)


@router.delete("/goal-entries/{entry_id}")
def delete_entry(entry_id: int, month_id: int | None = None, db: Session = Depends(get_db)):
    entry = db.get(GoalEntry, entry_id)
    if entry is None:
        raise HTTPException(404, "Entry not found")
    db.delete(entry)
    db.commit()
    return goals_view(db, month_id)


class OrderIn(BaseModel):
    ids: list[int]


@router.put("/goals/order")
def set_goal_order(body: OrderIn, month_id: int | None = None, db: Session = Depends(get_db)):
    """Save the order the user dragged projects into. 1 gets money first."""
    goals = {g.id: g for g in db.scalars(select(Goal).order_by(Goal.rank, Goal.id))}
    unknown = [i for i in body.ids if i not in goals]
    if unknown:
        raise HTTPException(404, f"Project {unknown[0]} not found")
    ordered = [goals[i] for i in dict.fromkeys(body.ids)]
    ordered += [g for g in goals.values() if g.id not in body.ids]  # any left out keep their place at the end
    for rank, goal in enumerate(ordered, start=1):
        goal.rank = rank
    db.flush()  # the session does not write changes on its own before the next query
    _renumber(db)  # open ones stay ahead of completed and cancelled ones
    db.flush()
    # project lines are funded in this order, so share out open months' payments again
    from .income import load_month
    from .split import resplit_month
    for mid in db.scalars(select(Month.id).where(Month.status != "closed")):
        month = load_month(db, mid)
        if month.arrivals:
            resplit_month(month)
    db.commit()
    return goals_view(db, month_id)
