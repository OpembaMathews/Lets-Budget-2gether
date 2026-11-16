"""Calculations: currency conversion, plan totals, weekly lines and copy-forward.

Totals are always worked out from the lines. No subtotal is ever stored.
"""
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import BudgetLine, LineGroup, Month
from .types import to_money

BASE = "NTD"  # the month's rate says how many QUOTE one BASE buys
QUOTE = "KES"
ZERO = Decimal("0.00")


def convert(amount: Decimal, from_code: str, to_code: str, rate: Decimal) -> Decimal:
    """Convert between the two supported currencies at the month's planning rate."""
    if from_code == to_code:
        return to_money(amount)
    if from_code == BASE and to_code == QUOTE:
        return to_money(Decimal(amount) * rate)
    if from_code == QUOTE and to_code == BASE:
        return to_money(Decimal(amount) / rate)
    raise ValueError(f"No rate between {from_code} and {to_code}")


def weekly_planned(weekly_amount: Decimal, weeks: int) -> Decimal:
    return to_money(Decimal(weekly_amount) * weeks)


class Bucket:
    """Adds up amounts per currency, then reports them natively and converted."""

    def __init__(self) -> None:
        self.native: dict[str, Decimal] = defaultdict(lambda: ZERO)

    def add(self, currency: str, amount: Decimal) -> None:
        self.native[currency] += amount

    def report(self, rate: Decimal) -> dict:
        out = {"native": {code: to_money(v) for code, v in sorted(self.native.items())}}
        for target in (QUOTE, BASE):
            # Sum exact values first and round once, so rounding does not pile up.
            total = Decimal("0")
            for code, value in self.native.items():
                if code == target:
                    total += value
                elif code == BASE:
                    total += value * rate
                else:
                    total += value / rate
            out[target] = to_money(total)
        return out


def month_totals(month: Month, groups: dict[int, LineGroup]) -> dict:
    """Every total for a month's plan, built from its lines."""
    rate = month.fx_rate_ntd_kes
    grand = Bucket()
    by_group: dict[int, Bucket] = defaultdict(Bucket)
    by_location: dict[int, Bucket] = defaultdict(Bucket)
    by_priority: dict[str, Bucket] = defaultdict(Bucket)
    by_kind: dict[str, Bucket] = defaultdict(Bucket)
    needs_review = 0

    for line in month.lines:
        grand.add(line.currency_code, line.planned)
        by_group[line.group_id].add(line.currency_code, line.planned)
        group = groups.get(line.group_id)
        if group is not None:
            by_location[group.location_id].add(line.currency_code, line.planned)
        by_priority[line.priority].add(line.currency_code, line.planned)
        by_kind[line.kind].add(line.currency_code, line.planned)
        if line.needs_review:
            needs_review += 1

    return {
        "grand": grand.report(rate),
        "groups": {gid: b.report(rate) for gid, b in by_group.items()},
        "locations": {lid: b.report(rate) for lid, b in by_location.items()},
        "priority": {name: b.report(rate) for name, b in by_priority.items()},
        "kind": {name: b.report(rate) for name, b in by_kind.items()},
        "needs_review": needs_review,
        "line_count": len(month.lines),
    }


def previous_month(db: Session, year: int, month: int) -> Month | None:
    """The latest stored month that comes before the given one."""
    stmt = (
        select(Month)
        .where((Month.year < year) | ((Month.year == year) & (Month.month < month)))
        .order_by(Month.year.desc(), Month.month.desc())
        .limit(1)
    )
    return db.scalars(stmt).first()


def copy_forward(source: Month, target: Month) -> int:
    """Copy a plan into a new month. Returns the number of lines copied.

    Fixed lines are copied unchanged. Variable lines are copied with the old
    amount as a suggestion to confirm. One-off lines are left behind.
    Actual amounts are never copied.
    """
    copied = 0
    for line in source.lines:
        if line.line_type == "one_off":
            continue
        planned = line.planned
        if line.weekly_amount is not None:
            planned = weekly_planned(line.weekly_amount, target.weeks)
        target.lines.append(
            BudgetLine(
                group_id=line.group_id,
                name=line.name,
                currency_code=line.currency_code,
                line_type=line.line_type,
                kind=line.kind,
                priority=line.priority,
                weekly_amount=line.weekly_amount,
                planned=planned,
                actual=None,
                needs_review=line.line_type == "variable",
                is_core=line.is_core,
                destination_account_id=line.destination_account_id,
                goal_id=line.goal_id,
                recipient_id=line.recipient_id,
                debt_id=line.debt_id,
                note=line.note,
                sort_order=line.sort_order,
            )
        )
        copied += 1
    return copied


def recalculate_weekly_lines(month: Month) -> None:
    """Refresh weekly lines after the month's number of weeks changes."""
    for line in month.lines:
        if line.weekly_amount is not None:
            line.planned = weekly_planned(line.weekly_amount, month.weeks)
