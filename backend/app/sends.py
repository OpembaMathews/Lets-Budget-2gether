"""Money sent home, send by send (docs/DESIGN.md, section 5, step 4).

Only cash is sent: "to send" is what income has set aside for a line and has
not been sent yet, never more than the actual typed on the Month plan (if any).
The part no income has covered is "waiting".

A send has a recipient and one or more purposes. A purpose is either one budget
line or a whole section; a section amount is spread over that section's lines
in plan order. Purposes never add up to more than the send; the difference is
shown as unassigned until it is sorted.

Sends are in KES, so only KES lines can be a purpose.
"""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .auth import get_db
from .models import BudgetLine, IncomeArrival, LineGroup, Location, Month, Recipient, Send, SendPurpose
from .split import jsonify, line_coverage, line_target
from .types import to_money

router = APIRouter(prefix="/api")

SEND_CURRENCY = "KES"
ZERO = Decimal("0.00")


# ---- request shapes -----------------------------------------------------------

class RecipientIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    usual_method: str | None = Field(default=None, max_length=40)
    active: bool = True


class RecipientPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    usual_method: str | None = Field(default=None, max_length=40)
    active: bool | None = None


class PurposeIn(BaseModel):
    budget_line_id: int | None = None
    group_id: int | None = None
    amount: Decimal = Field(gt=0)

    @model_validator(mode="after")
    def one_target(self):
        if (self.budget_line_id is None) == (self.group_id is None):
            raise ValueError("Each purpose needs either a line or a section, not both")
        return self


class SendIn(BaseModel):
    sent_date: date
    recipient_id: int
    amount_kes: Decimal = Field(gt=0)
    amount_ntd: Decimal | None = Field(default=None, gt=0)
    fee_ntd: Decimal | None = Field(default=None, ge=0)
    platform: str | None = Field(default=None, max_length=40)
    reference: str | None = Field(default=None, max_length=60)
    note: str | None = None
    purposes: list[PurposeIn] = []


# ---- helpers ------------------------------------------------------------------

def _load_month(db: Session, month_id: int) -> Month:
    stmt = (
        select(Month)
        .where(Month.id == month_id)
        .options(
            selectinload(Month.lines),
            selectinload(Month.arrivals).selectinload(IncomeArrival.allocations),
        )
        .execution_options(populate_existing=True)
    )
    month = db.scalars(stmt).first()
    if month is None:
        raise HTTPException(404, "Month not found")
    return month


def _sends(db: Session, month_id: int) -> list[Send]:
    stmt = (
        select(Send)
        .where(Send.month_id == month_id)
        .options(selectinload(Send.purposes), selectinload(Send.recipient))
        .order_by(Send.sent_date, Send.id)
        .execution_options(populate_existing=True)
    )
    return list(db.scalars(stmt))


def _open(month: Month) -> None:
    if month.status == "closed":
        raise HTTPException(409, "This month is closed and cannot be changed")


def cash_ready(month: Month) -> dict[int, Decimal]:
    """Cash set aside from income for each line, never more than what really goes to it."""
    covered = line_coverage(month)
    return {l.id: min(covered.get(l.id, ZERO), line_target(l)) for l in month.lines}


def sent_per_line(sends: list[Send], skip_send_id: int | None = None) -> dict[int, Decimal]:
    out: dict[int, Decimal] = {}
    for send in sends:
        if send.id == skip_send_id:
            continue
        for p in send.purposes:
            out[p.budget_line_id] = out.get(p.budget_line_id, ZERO) + p.amount_kes
    return out


def build_purposes(
    month: Month,
    purposes: list[PurposeIn],
    already_sent: dict[int, Decimal],
    amount_kes: Decimal,
    ready: dict[int, Decimal] | None = None,
) -> list[SendPurpose]:
    """Turn line and section purposes into line-level parts of a send.

    `ready` is the cash set aside from income for each line. A section amount
    first covers that cash, line by line, and only then the rest of the budget.
    """
    ready = ready or {}
    lines = {l.id: l for l in month.lines}
    sent = dict(already_sent)
    result: list[SendPurpose] = []
    total = ZERO

    def give(line: BudgetLine, amount: Decimal, via: int | None) -> None:
        for existing in result:  # merge repeated parts for the same line
            if existing.budget_line_id == line.id and existing.via_group_id == via:
                existing.amount_kes += amount
                break
        else:
            result.append(SendPurpose(budget_line_id=line.id, amount_kes=amount, via_group_id=via))
        sent[line.id] = sent.get(line.id, ZERO) + amount

    for item in purposes:
        amount = to_money(item.amount)
        total += amount
        if item.budget_line_id is not None:
            line = lines.get(item.budget_line_id)
            if line is None:
                raise HTTPException(422, "A purpose points at a line that is not in this month")
            if line.currency_code != SEND_CURRENCY:
                raise HTTPException(422, f"{line.name} is planned in {line.currency_code}, so it cannot be paid by a KES send")
            give(line, amount, None)
            continue

        group_lines = sorted(
            (l for l in month.lines if l.group_id == item.group_id and l.currency_code == SEND_CURRENCY),
            key=lambda l: (l.sort_order, l.id),
        )
        if not group_lines:
            raise HTTPException(422, "That section has no KES lines in this month")
        left = amount
        # 1. the cash already set aside for each line, then 2. the rest of each budget
        for limit in (lambda l: min(ready.get(l.id, ZERO), line_target(l)), line_target):
            for line in group_lines:
                need = limit(line) - sent.get(line.id, ZERO)
                if need <= 0 or left <= 0:
                    continue
                part = min(need, left)
                give(line, part, item.group_id)
                left -= part
        if left > 0:  # more than the section still needed: it shows as over-sent
            give(group_lines[-1], left, item.group_id)

    if total > amount_kes:
        raise HTTPException(422, f"The purposes add up to KES {total:,.2f}, more than the KES {amount_kes:,.2f} sent")
    return result


def _apply(send: Send, body: SendIn, month: Month, sends: list[Send], db: Session) -> None:
    if db.get(Recipient, body.recipient_id) is None:
        raise HTTPException(404, "Recipient not found")
    if body.fee_ntd is not None and body.amount_ntd is not None and body.fee_ntd > body.amount_ntd:
        raise HTTPException(422, "The fee cannot be more than the NTD amount")
    parts = build_purposes(
        month, body.purposes, sent_per_line(sends, skip_send_id=send.id), to_money(body.amount_kes),
        ready=cash_ready(month),
    )
    send.sent_date = body.sent_date
    send.recipient_id = body.recipient_id
    send.amount_kes = body.amount_kes
    send.amount_ntd = body.amount_ntd
    send.fee_ntd = body.fee_ntd
    send.platform = (body.platform or "").strip() or None
    send.reference = (body.reference or "").strip() or None
    send.note = (body.note or "").strip() or None
    send.purposes.clear()
    db.flush()
    send.purposes.extend(parts)


# ---- the view -----------------------------------------------------------------

def sends_view(db: Session, month: Month) -> dict:
    sends = _sends(db, month.id)
    sent = sent_per_line(sends)
    set_aside = line_coverage(month)  # what confirmed income splits put toward each line
    groups = {g.id: g for g in db.scalars(select(LineGroup))}
    locations = {l.id: l for l in db.scalars(select(Location))}
    recipients = db.scalars(select(Recipient).order_by(Recipient.sort_order, Recipient.id)).all()
    lines = {l.id: l for l in month.lines}

    # Sections that hold KES lines this month, in plan order.
    blocks: dict[int, dict] = {}
    for line in sorted(month.lines, key=lambda l: (l.sort_order, l.id)):
        if line.currency_code != SEND_CURRENCY:
            continue
        group = groups.get(line.group_id)
        if group is None:
            continue
        block = blocks.setdefault(group.id, {
            "group_id": group.id,
            "name": group.name,
            "location_name": locations[group.location_id].name if group.location_id in locations else None,
            "usual_recipient_id": group.usual_recipient_id,
            "sort": (locations[group.location_id].sort_order if group.location_id in locations else 0, group.sort_order),
            "planned": ZERO, "set_aside": ZERO, "sent": ZERO, "to_send": ZERO, "remaining": ZERO,
            "waiting": ZERO, "over": ZERO,
            "lines": [],
        })
        got = sent.get(line.id, ZERO)
        target = line_target(line)                         # typed actual, or the budget
        aside = min(set_aside.get(line.id, ZERO), max(line.planned, target))
        ready = min(aside, target)
        to_send = max(ZERO, ready - got)                    # cash ready to send
        remaining = max(ZERO, target - got)                 # still to go to this line
        waiting = max(ZERO, target - max(ready, got))       # not yet covered by income
        over = max(ZERO, got - target)
        block["lines"].append({
            "id": line.id, "name": line.name, "priority": line.priority, "kind": line.kind,
            "is_core": line.is_core, "planned": line.planned, "actual": line.actual,
            # who it goes to: the line's own recipient, or else the section's usual one
            "recipient_id": line.recipient_id or group.usual_recipient_id,
            "own_recipient": line.recipient_id is not None,
            "set_aside": min(set_aside.get(line.id, ZERO), line.planned),
            "sent": got, "to_send": to_send, "remaining": remaining, "waiting": waiting, "over": over,
        })
        block["planned"] += line.planned
        block["set_aside"] += min(set_aside.get(line.id, ZERO), line.planned)
        block["sent"] += got
        block["to_send"] += to_send
        block["remaining"] += remaining
        block["waiting"] += waiting
        block["over"] += over
    ordered = sorted(blocks.values(), key=lambda b: b.pop("sort"))

    send_rows, per_recipient = [], {}
    total_kes, total_ntd, total_fee, unassigned = ZERO, ZERO, ZERO, ZERO
    priced_kes = ZERO  # KES of sends whose NTD cost is known, for the average rate
    for s in sends:
        assigned = sum((p.amount_kes for p in s.purposes), ZERO)
        left = s.amount_kes - assigned
        unassigned += left
        total_kes += s.amount_kes
        if s.amount_ntd:
            total_ntd += s.amount_ntd
            priced_kes += s.amount_kes
        total_fee += s.fee_ntd or ZERO
        r = per_recipient.setdefault(s.recipient_id, {
            "recipient_id": s.recipient_id, "name": s.recipient.name, "count": 0, "amount_kes": ZERO})
        r["count"] += 1
        r["amount_kes"] += s.amount_kes

        purposes = []
        for p in s.purposes:
            line = lines.get(p.budget_line_id)
            group = groups.get(line.group_id) if line else None
            purposes.append({
                "budget_line_id": p.budget_line_id,
                "line_name": line.name if line else None,
                "group_id": group.id if group else None,
                "group_name": group.name if group else None,
                "via_group_id": p.via_group_id,
                "amount_kes": p.amount_kes,
            })
        send_rows.append({
            "id": s.id, "sent_date": s.sent_date, "recipient_id": s.recipient_id, "recipient_name": s.recipient.name,
            "amount_kes": s.amount_kes, "amount_ntd": s.amount_ntd, "fee_ntd": s.fee_ntd,
            "rate": str((s.amount_kes / s.amount_ntd).quantize(Decimal("0.0001"))) if s.amount_ntd else None,
            "platform": s.platform, "reference": s.reference, "note": s.note,
            "assigned": assigned, "unassigned": left, "purposes": purposes,
        })

    planned = sum((b["planned"] for b in ordered), ZERO)
    return jsonify({
        "month_id": month.id,
        "status": month.status,
        "planning_rate": str(month.fx_rate_ntd_kes),  # text, so it is not rounded to cents
        "recipients": [
            {"id": r.id, "name": r.name, "usual_method": r.usual_method, "active": r.active} for r in recipients
        ],
        "groups": ordered,
        "sends": send_rows,
        "per_recipient": sorted(per_recipient.values(), key=lambda r: -r["amount_kes"]),
        "totals": {
            "planned": planned,
            "set_aside": sum((b["set_aside"] for b in ordered), ZERO),
            "sent": total_kes,
            "assigned": total_kes - unassigned,
            "to_send": sum((b["to_send"] for b in ordered), ZERO),
            "remaining": sum((b["remaining"] for b in ordered), ZERO),
            "waiting": sum((b["waiting"] for b in ordered), ZERO),
            "over": sum((b["over"] for b in ordered), ZERO),
            "unassigned": unassigned,
            "count": len(sends),
            "ntd_paid": total_ntd,
            "fees_ntd": total_fee,
            "average_rate": str((priced_kes / total_ntd).quantize(Decimal("0.0001"))) if total_ntd else None,
        },
    })


# ---- routes: recipients -------------------------------------------------------

@router.get("/recipients")
def list_recipients(db: Session = Depends(get_db)):
    rows = db.scalars(select(Recipient).order_by(Recipient.sort_order, Recipient.id))
    return [{"id": r.id, "name": r.name, "usual_method": r.usual_method, "active": r.active} for r in rows]


@router.post("/recipients", status_code=201)
def create_recipient(body: RecipientIn, db: Session = Depends(get_db)):
    order = (db.scalar(select(func.max(Recipient.sort_order))) or 0) + 1
    recipient = Recipient(sort_order=order, **body.model_dump())
    db.add(recipient)
    db.commit()
    return {"id": recipient.id}


@router.patch("/recipients/{recipient_id}")
def update_recipient(recipient_id: int, body: RecipientPatch, db: Session = Depends(get_db)):
    recipient = db.get(Recipient, recipient_id)
    if recipient is None:
        raise HTTPException(404, "Recipient not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is not None or key == "usual_method":
            setattr(recipient, key, value)
    db.commit()
    return {"id": recipient.id}


@router.delete("/recipients/{recipient_id}", status_code=204)
def delete_recipient(recipient_id: int, db: Session = Depends(get_db)):
    recipient = db.get(Recipient, recipient_id)
    if recipient is None:
        raise HTTPException(404, "Recipient not found")
    used = db.scalar(select(func.count()).select_from(Send).where(Send.recipient_id == recipient_id))
    if used:
        raise HTTPException(409, "Money has been sent to this recipient. Mark them as not in use instead.")
    db.delete(recipient)
    db.commit()


# ---- routes: sends ------------------------------------------------------------

@router.get("/months/{month_id}/sends")
def get_sends(month_id: int, db: Session = Depends(get_db)):
    return sends_view(db, _load_month(db, month_id))


@router.post("/months/{month_id}/sends", status_code=201)
def create_send(month_id: int, body: SendIn, db: Session = Depends(get_db)):
    month = _load_month(db, month_id)
    _open(month)
    send = Send(month_id=month.id)
    db.add(send)
    _apply(send, body, month, _sends(db, month.id), db)
    db.commit()
    return sends_view(db, _load_month(db, month_id))


@router.put("/sends/{send_id}")
def update_send(send_id: int, body: SendIn, db: Session = Depends(get_db)):
    send = db.get(Send, send_id)
    if send is None:
        raise HTTPException(404, "Send not found")
    month = _load_month(db, send.month_id)
    _open(month)
    sends = _sends(db, month.id)
    send = next(s for s in sends if s.id == send_id)
    _apply(send, body, month, sends, db)
    db.commit()
    return sends_view(db, _load_month(db, month.id))


@router.delete("/sends/{send_id}")
def delete_send(send_id: int, db: Session = Depends(get_db)):
    send = db.get(Send, send_id)
    if send is None:
        raise HTTPException(404, "Send not found")
    month_id = send.month_id
    _open(db.get(Month, month_id))
    db.delete(send)
    db.commit()
    return sends_view(db, _load_month(db, month_id))
