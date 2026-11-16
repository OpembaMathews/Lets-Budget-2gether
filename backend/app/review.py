"""Month-end review, balance check, closing and reopening, history, comparison and Excel export.

Closing a month locks it (nothing in it can change) and saves a copy of the
database in backend/data/backups first. Reopening needs a reason, which is kept.
"""
import io
import shutil
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .actuals import line_actuals
from .db import DATA_DIR, engine, get_db
from .income import load_month
from .models import Account, BalanceCheck, LineGroup, Location, Month, Send
from .sends import sends_view
from .services import Bucket, convert
from .split import income_view, jsonify
from .types import to_money

router = APIRouter(prefix="/api")
ZERO = Decimal("0.00")
MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]


def label(m: Month) -> str:
    return f"{MONTHS[m.month]} {m.year}"


class BalanceIn(BaseModel):
    account_id: int
    actual_balance: Decimal = Field(ge=0)
    note: str | None = None


class CloseIn(BaseModel):
    note: str | None = None


class ReopenIn(BaseModel):
    reason: str = Field(min_length=1)


# ---- figures for one month -------------------------------------------------------

def month_figures(db: Session, month: Month) -> dict:
    """Budget, actual, income, savings, sent and free for a month, all also in KES."""
    rate = month.fx_rate_ntd_kes
    groups = {g.id: g for g in db.scalars(select(LineGroup))}
    locations = {l.id: l for l in db.scalars(select(Location))}
    actuals = line_actuals(db, month)
    budget, actual = Bucket(), Bucket()
    per_location: dict[str, dict] = {}
    for line in month.lines:
        a = Decimal(actuals[line.id]["actual"])
        budget.add(line.currency_code, line.planned)
        actual.add(line.currency_code, a)
        group = groups.get(line.group_id)
        loc = locations[group.location_id].name if group else "Other"
        block = per_location.setdefault(loc, {"budget": Bucket(), "actual": Bucket()})
        block["budget"].add(line.currency_code, line.planned)
        block["actual"].add(line.currency_code, a)
    income = income_view(db, load_month(db, month.id))["summary"]
    sent = db.scalars(select(Send).where(Send.month_id == month.id)).all()
    return {
        "budget": budget.report(rate), "actual": actual.report(rate),
        "locations": {k: {"budget": v["budget"].report(rate), "actual": v["actual"].report(rate)}
                      for k, v in per_location.items()},
        "income": income["arrived"], "saved": income["savings_reserved"], "free": income["free"],
        "sent_kes": sum((s.amount_kes for s in sent), ZERO),
        "actuals": actuals,
    }


def _previous(db: Session, month: Month) -> Month | None:
    return db.scalars(
        select(Month)
        .where((Month.year < month.year) | ((Month.year == month.year) & (Month.month < month.month)))
        .order_by(Month.year.desc(), Month.month.desc()).limit(1)
    ).first()


def balance_view(db: Session, month: Month) -> dict:
    """Real account balances against what this month says should be left.

    Expected (per currency) = last month's checked balances
      + income received in that currency
      - actuals of lines in that currency (money spent or sent from it)
      - for NTD: what Kenya sends cost (their NTD cost, or the KES amount at the month's rate).
    Only shown once a previous month has balances to start from.
    """
    rate = month.fx_rate_ntd_kes
    accounts = db.scalars(select(Account).order_by(Account.id)).all()
    checks = {c.account_id: c for c in db.scalars(select(BalanceCheck).where(BalanceCheck.month_id == month.id))}
    entered: dict[str, Decimal] = {}
    rows = []
    for a in accounts:
        c = checks.get(a.id)
        if not a.active and c is None:
            continue
        rows.append({"account_id": a.id, "name": a.name, "currency_code": a.currency_code, "kind": a.kind,
                     "actual_balance": c.actual_balance if c else None, "note": c.note if c else None})
        if c is not None:
            entered[a.currency_code] = entered.get(a.currency_code, ZERO) + c.actual_balance

    prev = _previous(db, month)
    opening: dict[str, Decimal] = {}
    if prev is not None:
        for c in db.scalars(select(BalanceCheck).where(BalanceCheck.month_id == prev.id)):
            acc = db.get(Account, c.account_id)
            opening[acc.currency_code] = opening.get(acc.currency_code, ZERO) + c.actual_balance

    m = load_month(db, month.id)
    actuals = line_actuals(db, m)
    income: dict[str, Decimal] = {}
    for arr in m.arrivals:
        if arr.confirmed:
            income[arr.currency_code] = income.get(arr.currency_code, ZERO) + arr.amount
    spent: dict[str, Decimal] = {}
    for line in m.lines:
        a = Decimal(actuals[line.id]["actual"])
        # Kenya lines are paid by sends; their cost comes out of NTD below
        if line.currency_code == "NTD":
            spent["NTD"] = spent.get("NTD", ZERO) + a
    sends_cost = ZERO
    for s in db.scalars(select(Send).where(Send.month_id == month.id)):
        sends_cost += s.amount_ntd if s.amount_ntd else convert(s.amount_kes, "KES", "NTD", rate)

    currencies = []
    for code in sorted(set(entered) | set(opening) | set(income)):
        expected = None
        if code in opening:
            expected = opening[code] + income.get(code, ZERO) - spent.get(code, ZERO)
            if code == "NTD":
                expected -= sends_cost
        currencies.append({
            "currency_code": code, "opening": opening.get(code), "income": income.get(code, ZERO),
            "spent": spent.get(code, ZERO), "sends_cost": sends_cost if code == "NTD" else ZERO,
            "expected": to_money(expected) if expected is not None else None,
            "entered": entered.get(code),
            "difference": (entered[code] - to_money(expected)) if expected is not None and code in entered else None,
        })
    return {"accounts": rows, "currencies": currencies, "has_previous": bool(opening),
            "previous_label": label(prev) if prev else None}


def review_view(db: Session, month_id: int) -> dict:
    month = db.scalars(select(Month).where(Month.id == month_id).options(selectinload(Month.lines))).first()
    if month is None:
        raise HTTPException(404, "Month not found")
    figures = month_figures(db, month)
    actuals = figures.pop("actuals")
    groups = {g.id: g for g in db.scalars(select(LineGroup))}
    income = income_view(db, load_month(db, month.id))
    sends = sends_view(db, load_month(db, month.id))

    def where(line):
        g = groups.get(line.group_id)
        return g.name if g else ""

    over, nothing = [], []
    for line in sorted(month.lines, key=lambda l: (l.sort_order, l.id)):
        a = actuals[line.id]
        if a["over"]:
            over.append({"id": line.id, "name": line.name, "section": where(line), "currency_code": line.currency_code,
                         "planned": line.planned, "actual": Decimal(a["actual"])})
        elif Decimal(a["actual"]) == 0 and line.planned > 0 and Decimal(a["set_aside_to_send"]) == 0:
            nothing.append({"id": line.id, "name": line.name, "section": where(line),
                            "currency_code": line.currency_code, "planned": line.planned,
                            "typed": a["manual"]})
    ready = [{"name": l["name"], "section": g["name"], "amount": l["to_send"]}
             for g in sends["groups"] for l in g["lines"] if Decimal(l["to_send"]) > 0]

    checks = {
        "over_budget": over,
        "nothing_given": nothing,
        "ready_to_send": ready,
        "unassigned_sends": sends["totals"]["unassigned"],
        "income_not_arrived": income["summary"]["upcoming"],
        "needs_review": sum(1 for l in month.lines if l.needs_review),
    }
    return jsonify({
        "month_id": month.id, "label": label(month), "status": month.status,
        "closed_at": month.closed_at, "review_note": month.review_note, "close_log": month.close_log,
        "figures": figures, "checks": checks, "balances": balance_view(db, month),
    })


# ---- routes: review, balances, close, reopen -------------------------------------

def _month(db: Session, month_id: int) -> Month:
    month = db.get(Month, month_id)
    if month is None:
        raise HTTPException(404, "Month not found")
    return month


@router.get("/months/{month_id}/review")
def get_review(month_id: int, db: Session = Depends(get_db)):
    return review_view(db, month_id)


@router.put("/months/{month_id}/balances")
def set_balance(month_id: int, body: BalanceIn, db: Session = Depends(get_db)):
    month = _month(db, month_id)
    if month.status == "closed":
        raise HTTPException(409, "This month is closed and cannot be changed")
    if db.get(Account, body.account_id) is None:
        raise HTTPException(404, "Account not found")
    check = db.scalars(select(BalanceCheck).where(
        BalanceCheck.month_id == month_id, BalanceCheck.account_id == body.account_id)).first()
    if check is None:
        check = BalanceCheck(month_id=month_id, account_id=body.account_id, actual_balance=body.actual_balance)
        db.add(check)
    check.actual_balance = body.actual_balance
    check.note = body.note
    db.commit()
    return review_view(db, month_id)


@router.patch("/months/{month_id}/review-note")
def set_review_note(month_id: int, body: CloseIn, db: Session = Depends(get_db)):
    month = _month(db, month_id)
    month.review_note = (body.note or "").strip() or None
    db.commit()
    return review_view(db, month_id)


def _log(month: Month, text: str) -> None:
    entry = f"{datetime.now():%Y-%m-%d %H:%M}: {text}"
    month.close_log = f"{month.close_log}\n{entry}" if month.close_log else entry


def backup_database(tag: str) -> str | None:
    """Copy the database file into data/backups. Returns the file name, or None for an in-memory database."""
    path = engine.url.database
    if not path or path == ":memory:" or not Path(path).exists():
        return None
    folder = DATA_DIR / "backups"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"budget-{tag}-{datetime.now():%Y%m%d-%H%M%S}.db"
    shutil.copy2(path, target)
    return target.name


@router.post("/months/{month_id}/close")
def close_month(month_id: int, body: CloseIn, db: Session = Depends(get_db)):
    month = _month(db, month_id)
    if month.status == "closed":
        raise HTTPException(409, "This month is already closed")
    saved_as = backup_database(f"{month.year}-{month.month:02d}-before-close")
    month.status = "closed"
    month.closed_at = datetime.now()
    if body.note and body.note.strip():
        month.review_note = body.note.strip()
    _log(month, "Closed" + (f" (backup {saved_as})" if saved_as else ""))
    db.commit()
    return review_view(db, month_id)


@router.post("/months/{month_id}/reopen")
def reopen_month(month_id: int, body: ReopenIn, db: Session = Depends(get_db)):
    month = _month(db, month_id)
    if month.status != "closed":
        raise HTTPException(409, "This month is not closed")
    month.status = "active"
    month.closed_at = None
    _log(month, f"Reopened. Reason: {body.reason.strip()}")
    db.commit()
    return review_view(db, month_id)


# ---- routes: history, comparison --------------------------------------------------

@router.get("/history")
def history(db: Session = Depends(get_db)):
    months = db.scalars(select(Month).options(selectinload(Month.lines)).order_by(Month.year, Month.month)).all()
    rows, years = [], {}
    for m in months:
        f = month_figures(db, m)
        row = {
            "id": m.id, "year": m.year, "month": m.month, "label": label(m), "status": m.status,
            "income_kes": f["income"]["KES"], "income": f["income"]["native"],
            "budget_kes": f["budget"]["KES"], "actual_kes": f["actual"]["KES"],
            "saved_kes": f["saved"]["KES"], "free_kes": f["free"]["KES"], "sent_kes": f["sent_kes"],
        }
        rows.append(row)
        y = years.setdefault(m.year, {"year": m.year, "months": 0, "income_kes": ZERO, "budget_kes": ZERO,
                                      "actual_kes": ZERO, "saved_kes": ZERO, "sent_kes": ZERO})
        y["months"] += 1
        for key in ("income_kes", "budget_kes", "actual_kes", "saved_kes", "sent_kes"):
            y[key] += Decimal(row[key])
    return jsonify({"months": rows, "years": list(years.values())})


@router.get("/compare")
def compare(a: int, b: int, db: Session = Depends(get_db)):
    """Two months side by side, line by line (matched by location, section and name)."""
    groups = {g.id: g for g in db.scalars(select(LineGroup))}
    locations = {l.id: l for l in db.scalars(select(Location))}
    result, order = {}, []
    heads = []
    for side, month_id in (("a", a), ("b", b)):
        m = db.scalars(select(Month).where(Month.id == month_id).options(selectinload(Month.lines))).first()
        if m is None:
            raise HTTPException(404, "Month not found")
        heads.append({"id": m.id, "label": label(m), "rate": str(m.fx_rate_ntd_kes)})
        actuals = line_actuals(db, m)
        for line in sorted(m.lines, key=lambda l: (l.sort_order, l.id)):
            g = groups.get(line.group_id)
            key = (locations[g.location_id].name if g else "", g.name if g else "", line.name)
            if key not in result:
                result[key] = {"location": key[0], "section": key[1], "name": line.name,
                               "currency_code": line.currency_code, "a": None, "b": None}
                order.append(key)
            result[key][side] = {"budget": line.planned, "actual": Decimal(actuals[line.id]["actual"])}
    return jsonify({"a": heads[0], "b": heads[1], "lines": [result[k] for k in order]})


# ---- Excel export -------------------------------------------------------------------

def _xlsx(sheets: list[tuple[str, list[str], list[list]]]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()
    wb.remove(wb.active)
    head_fill = PatternFill("solid", fgColor="04472F")
    for title, header, rows in sheets:
        ws = wb.create_sheet(title[:31])
        ws.append(header)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = head_fill
        for row in rows:
            ws.append([float(v) if isinstance(v, Decimal) else v for v in row])
        for col in ws.columns:
            width = max(len(str(c.value)) if c.value is not None else 0 for c in col)
            ws.column_dimensions[col[0].column_letter].width = min(max(10, width + 2), 50)
        ws.freeze_panes = "A2"
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _plan_rows(db: Session, m: Month, with_month: bool) -> list[list]:
    groups = {g.id: g for g in db.scalars(select(LineGroup))}
    locations = {l.id: l for l in db.scalars(select(Location))}
    actuals = line_actuals(db, m)
    rows = []
    for line in sorted(m.lines, key=lambda l: (l.sort_order, l.id)):
        g = groups.get(line.group_id)
        a = Decimal(actuals[line.id]["actual"])
        row = [locations[g.location_id].name if g else "", g.name if g else "", line.name, line.currency_code,
               line.priority, line.line_type, line.planned, a, line.planned - a]
        rows.append(([label(m)] if with_month else []) + row)
    return rows


PLAN_HEADER = ["Location", "Section", "Line", "Currency", "Priority", "Type", "Budget", "Actual", "Left"]


def _download(data: bytes, name: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/export/month/{month_id}")
def export_month(month_id: int, db: Session = Depends(get_db)):
    m = db.scalars(select(Month).where(Month.id == month_id).options(selectinload(Month.lines))).first()
    if m is None:
        raise HTTPException(404, "Month not found")
    full = load_month(db, m.id)
    payments = []
    for arr in sorted(full.arrivals, key=lambda a: (a.received_date, a.id)):
        parts = {}
        for x in arr.allocations:
            parts[x.kind] = parts.get(x.kind, ZERO) + x.amount
        payments.append([arr.received_date.isoformat(), arr.source.name, arr.currency_code, arr.amount,
                         parts.get("essential", ZERO) + parts.get("flexible", ZERO),
                         parts.get("core_saving", ZERO) + parts.get("savings", ZERO), parts.get("project", ZERO),
                         parts.get("free", ZERO)])
    sv = sends_view(db, full)
    sends = [[s["sent_date"], s["recipient_name"], Decimal(s["amount_kes"]),
              Decimal(s["amount_ntd"]) if s["amount_ntd"] else None, s["platform"],
              "; ".join(f'{p["line_name"]} {p["amount_kes"]}' for p in s["purposes"])] for s in sv["sends"]]
    data = _xlsx([
        ("Plan", PLAN_HEADER, _plan_rows(db, m, False)),
        ("Income", ["Date", "Source", "Currency", "Amount", "Bills", "Saved", "Projects", "Free"], payments),
        ("Kenya sends", ["Date", "To", "KES", "NTD cost", "Platform", "For"], sends),
    ])
    return _download(data, f"budget-{m.year}-{m.month:02d}.xlsx")


@router.get("/export/year/{year}")
def export_year(year: int, db: Session = Depends(get_db)):
    months = db.scalars(
        select(Month).where(Month.year == year).options(selectinload(Month.lines)).order_by(Month.month)).all()
    if not months:
        raise HTTPException(404, f"No months in {year}")
    overview, lines = [], []
    for m in months:
        f = month_figures(db, m)
        overview.append([label(m), m.status, Decimal(f["income"]["KES"]), Decimal(f["budget"]["KES"]),
                         Decimal(f["actual"]["KES"]), Decimal(f["saved"]["KES"]), f["sent_kes"],
                         Decimal(f["free"]["KES"])])
        lines += _plan_rows(db, m, True)
    data = _xlsx([
        ("Overview", ["Month", "Status", "Income (KES)", "Budget (KES)", "Actual (KES)", "Saved (KES)",
                      "Sent home (KES)", "Free (KES)"], overview),
        ("All lines", ["Month"] + PLAN_HEADER, lines),
    ])
    return _download(data, f"budget-{year}.xlsx")
