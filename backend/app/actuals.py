"""Budget and actual for every line.

The budget is the line's planned amount: the limit. The actual is the money
really given to the line, worked out from what has been distributed:

- a payment split in the line's own currency puts the money where it is spent,
  so it counts as actual straight away (e.g. NTD income to Taiwan lines);
- a payment split in another currency only sets money aside; it counts once it
  is sent (e.g. NTD income set aside for a Kenya line counts when the KES send
  is recorded);
- every send counts as actual for the lines it was for.

The user can type an actual over the automatic figure (it is stored on the line)
and clear it again to go back to the automatic figure.
"""
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import IncomeArrival, Month, Send

ZERO = Decimal("0.00")


def line_actuals(db: Session, month: Month) -> dict[int, dict]:
    lines = {l.id: l for l in month.lines}
    given: dict[int, Decimal] = {}       # payments in the line's own currency
    set_aside: dict[int, Decimal] = {}   # payments in another currency, waiting to be sent
    sent: dict[int, Decimal] = {}

    arrivals = db.scalars(
        select(IncomeArrival)
        .where(IncomeArrival.month_id == month.id, IncomeArrival.confirmed)
        .options(selectinload(IncomeArrival.allocations))
    )
    for arrival in arrivals:
        for alloc in arrival.allocations:
            line = lines.get(alloc.budget_line_id) if alloc.budget_line_id else None
            if line is None or alloc.line_amount is None:
                continue
            target = given if arrival.currency_code == line.currency_code else set_aside
            target[line.id] = target.get(line.id, ZERO) + alloc.line_amount

    sends = db.scalars(select(Send).where(Send.month_id == month.id).options(selectinload(Send.purposes)))
    for send in sends:
        for p in send.purposes:
            if p.budget_line_id in lines:
                sent[p.budget_line_id] = sent.get(p.budget_line_id, ZERO) + p.amount_kes

    out: dict[int, dict] = {}
    for line in month.lines:
        auto = given.get(line.id, ZERO) + sent.get(line.id, ZERO)
        actual = line.actual if line.actual is not None else auto
        waiting = max(ZERO, set_aside.get(line.id, ZERO) - sent.get(line.id, ZERO))
        out[line.id] = {
            "auto": str(auto),
            "actual": str(actual),
            "manual": line.actual is not None,
            "left": str(line.planned - actual),
            "over": actual > line.planned,
            "set_aside_to_send": str(waiting),
        }
    return out
