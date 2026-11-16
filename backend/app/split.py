"""Income rules: the plan fit check, the split of each payment, and the month view.

Order of every split (docs/DESIGN.md, section 5, step 3):
  1. core saving, once a month, from a reliable source
  2. savings from the source's own rule
  3. essential lines in the payment's currency
  4. essential lines in the other currency (the amount to send)
  5. flexible lines, same currency then the other
  6. whatever is left is free to spend
"""
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from .models import Allocation, AppSetting, BudgetLine, IncomeArrival, IncomeSource, LineGroup, Location, Month
from .services import Bucket, convert
from .types import to_money

ZERO = Decimal("0.00")
HUNDRED = Decimal("100")


def jsonify(value):
    """Decimals as exact text and dates as ISO text, all the way down."""
    if isinstance(value, Decimal):
        return str(to_money(value))
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): jsonify(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonify(v) for v in value]
    return value


# ---- coverage ---------------------------------------------------------------

def line_target(line: BudgetLine) -> Decimal:
    """What income pays toward a line: the actual typed on the Month plan, otherwise the budget.

    A typed actual below the budget frees the rest of the cash; it goes to the next
    things in the split and, once everything is covered, to free to spend.
    """
    return line.actual if line.actual is not None else line.planned


def line_coverage(
    month: Month, include_arrival_id: int | None = None, exclude_arrival_id: int | None = None
) -> dict[int, Decimal]:
    """How much of each line has been funded, in the line's own currency.

    Counts confirmed payments, plus one unconfirmed payment if asked for, and
    leaves one payment out when its own split is being worked out again.
    """
    covered: dict[int, Decimal] = {}
    for arrival in month.arrivals:
        if arrival.id == exclude_arrival_id:
            continue
        if not arrival.confirmed and arrival.id != include_arrival_id:
            continue
        for alloc in arrival.allocations:
            if alloc.budget_line_id is not None and alloc.line_amount is not None:
                covered[alloc.budget_line_id] = covered.get(alloc.budget_line_id, ZERO) + alloc.line_amount
    return covered


# ---- the split --------------------------------------------------------------

def rule_savings(source: IncomeSource, amount: Decimal) -> Decimal:
    rule = source.rule
    if rule is None or rule.rule_type == "none":
        return ZERO
    if rule.rule_type in ("percent_first", "three_way"):
        return to_money(amount * (rule.save_percent or ZERO) / HUNDRED)
    if rule.rule_type == "fixed_first":
        return to_money(rule.save_fixed or ZERO)
    return ZERO


def split_order(db: Session | None) -> str:
    """The order money is shared out in. Bills first unless the user chose otherwise."""
    if db is None:
        return "bills_first"
    setting = db.get(AppSetting, "split_order")
    return setting.value if setting is not None else "bills_first"


def suggest_split(month: Month, source: IncomeSource, amount: Decimal, covered: dict[int, Decimal]) -> list[dict]:
    """Divide one payment. Returns slices that add up to exactly the payment.

    Bills first (the default):
      1. bills: every KE and TW line that is not the core saving and not a project,
         essentials before flexible, the payment's own currency first
      2. the core saving, from reliable income only
      3. extra savings from the source's rule, worked out on the whole payment
      4. project lines, in project priority order
      5. the rest is free to spend
    Savings first: core saving, extra savings, then every line, then free.
    """
    rate = month.fx_rate_ntd_kes
    currency = source.currency_code
    remaining = to_money(amount)
    slices: list[dict] = []
    order = split_order(object_session(month))

    def fund_line(line: BudgetLine, kind: str, budget: Decimal) -> Decimal:
        """Fund a line from `budget` (payment currency). Returns what was used."""
        outstanding = line_target(line) - covered.get(line.id, ZERO)
        if outstanding <= 0 or budget <= 0:
            return ZERO
        want = convert(outstanding, line.currency_code, currency, rate)
        if want <= budget:
            used, line_amount = want, outstanding  # fully funded, no rounding drift
        else:
            used = budget
            line_amount = min(outstanding, convert(used, currency, line.currency_code, rate))
        if used <= 0:
            return ZERO
        slices.append({"kind": kind, "amount": used, "budget_line_id": line.id, "line_amount": line_amount})
        return used

    lines = sorted(month.lines, key=lambda l: (l.sort_order, l.id))
    core_lines = [l for l in lines if l.is_core]

    # A three-way rule caps what may go to bills; the rest is personal.
    rule = source.rule
    cap = None
    if rule is not None and rule.rule_type == "three_way":
        cap = to_money(to_money(amount) * (rule.obligations_percent or ZERO) / HUNDRED)

    def take_core() -> None:
        nonlocal remaining
        if source.reliability == "regular":
            for line in core_lines:
                remaining -= fund_line(line, "core_saving", remaining)

    def take_rule_savings() -> None:
        nonlocal remaining
        extra = min(rule_savings(source, to_money(amount)), remaining)
        if extra > 0:
            slices.append({"kind": "savings", "amount": extra, "budget_line_id": None, "line_amount": None})
            remaining -= extra

    def pay_lines(candidates: list[BudgetLine], kind_for=None) -> None:
        """Essentials before flexible, the payment's own currency before the other."""
        nonlocal remaining
        budget = remaining if cap is None else min(remaining, cap - spent_on_lines())
        for priority in ("essential", "flexible"):
            for same_currency in (True, False):
                for line in candidates:
                    if line.priority != priority or (line.currency_code == currency) != same_currency:
                        continue
                    used = fund_line(line, kind_for or priority, budget)
                    budget -= used
                    remaining -= used

    def spent_on_lines() -> Decimal:
        return sum((x["amount"] for x in slices if x["kind"] in ("essential", "flexible")), ZERO)

    if order == "savings_first":
        take_core()
        take_rule_savings()
        pay_lines([l for l in lines if not l.is_core])
    else:
        bills = [l for l in lines if not l.is_core and l.goal_id is None]
        projects = sorted(
            (l for l in lines if not l.is_core and l.goal_id is not None),
            key=lambda l: (l.goal.rank if l.goal is not None else 10**6, l.sort_order, l.id),
        )
        pay_lines(bills)
        take_core()
        take_rule_savings()
        for line in projects:  # in project priority order, not plan order
            remaining -= fund_line(line, "project", remaining)

    if remaining > 0:
        slices.append({"kind": "free", "amount": remaining, "budget_line_id": None, "line_amount": None})
    return slices


def store_slices(arrival: IncomeArrival, slices: list[dict]) -> None:
    arrival.allocations.clear()
    for item in slices:
        arrival.allocations.append(Allocation(**item))


def resplit_month(month: Month) -> None:
    """Work out every payment's split again, oldest first.

    Splits the user changed by hand are kept and count first. Every other
    payment is split in date order against what earlier payments already
    funded, so the core saving always comes from the first reliable payment
    and nothing is funded twice, whatever order payments were added or removed.
    """
    covered: dict[int, Decimal] = {}

    def count(slices) -> None:
        for item in slices:
            line_id = item["budget_line_id"] if isinstance(item, dict) else item.budget_line_id
            amount = item["line_amount"] if isinstance(item, dict) else item.line_amount
            if line_id is not None and amount is not None:
                covered[line_id] = covered.get(line_id, ZERO) + amount

    live = [a for a in month.arrivals if a.confirmed]
    for arrival in live:
        if arrival.adjusted:
            count(arrival.allocations)
    # a payment being added has no id yet; it goes after others on the same day
    for arrival in sorted(live, key=lambda a: (a.received_date, a.id if a.id is not None else float("inf"))):
        if arrival.adjusted:
            continue
        slices = suggest_split(month, arrival.source, arrival.amount, covered)
        store_slices(arrival, slices)
        count(slices)


# ---- fit check --------------------------------------------------------------

def plan_fit(month: Month) -> dict:
    """Does the plan fit inside the reliable income expected this month?"""
    rate = month.fx_rate_ntd_kes
    reliable, irregular, plan = Bucket(), Bucket(), Bucket()
    for exp in month.expected:
        if not exp.source.active:
            continue
        target = reliable if exp.source.reliability == "regular" else irregular
        target.add(exp.source.currency_code, exp.amount)
    for line in month.lines:
        plan.add(line.currency_code, line.planned)

    reliable_r, plan_r = reliable.report(rate), plan.report(rate)
    gap = to_money(plan_r["KES"] - reliable_r["KES"])
    flexible = sorted(
        (l for l in month.lines if l.priority == "flexible" and l.planned > 0),
        key=lambda l: convert(l.planned, l.currency_code, "KES", rate),
        reverse=True,
    )
    return {
        "reliable": reliable_r,
        "irregular": irregular.report(rate),
        "plan": plan_r,
        "gap_kes": gap,                      # above zero means the plan is too large
        "gap_ntd": convert(gap, "KES", "NTD", rate) if gap > 0 else ZERO,
        "fits": gap <= 0,
        "needs_review": sum(1 for l in month.lines if l.needs_review),
        "flexible_lines": [
            {"id": l.id, "name": l.name, "planned": l.planned, "currency_code": l.currency_code}
            for l in flexible
        ],
    }


# ---- the whole income picture for a month ------------------------------------

def income_view(db: Session, month: Month) -> dict:
    rate = month.fx_rate_ntd_kes
    groups = {g.id: g for g in db.scalars(select(LineGroup))}
    locations = {l.id: l for l in db.scalars(select(Location))}
    sources = db.scalars(select(IncomeSource).order_by(IncomeSource.sort_order, IncomeSource.id)).all()
    lines = {l.id: l for l in month.lines}
    covered = line_coverage(month)
    expected = {e.source_id: e for e in month.expected}

    arrived_by_source: dict[int, Decimal] = {}
    arrived, savings, free = Bucket(), Bucket(), Bucket()
    for arrival in month.arrivals:
        if not arrival.confirmed:
            continue
        arrived_by_source[arrival.source_id] = arrived_by_source.get(arrival.source_id, ZERO) + arrival.amount
        arrived.add(arrival.currency_code, arrival.amount)
        for alloc in arrival.allocations:
            if alloc.kind in ("core_saving", "savings", "project"):
                savings.add(arrival.currency_code, alloc.amount)
            elif alloc.kind == "free":
                free.add(arrival.currency_code, alloc.amount)

    def source_row(src: IncomeSource) -> dict:
        exp = expected.get(src.id)
        rule = src.rule
        return {
            "id": src.id,
            "name": src.name,
            "currency_code": src.currency_code,
            "usual_day": src.usual_day,
            "reliability": src.reliability,
            "active": src.active,
            "rule_type": rule.rule_type if rule else "none",
            "save_percent": rule.save_percent if rule else None,
            "save_fixed": rule.save_fixed if rule else None,
            "obligations_percent": rule.obligations_percent if rule else None,
            "expected": exp.amount if exp else None,
            "expected_day": (exp.expected_day if exp and exp.expected_day else src.usual_day),
            "arrived": arrived_by_source.get(src.id, ZERO),
        }

    def priority_block(priority: str) -> dict:
        planned, done = Bucket(), Bucket()
        for line in month.lines:
            if line.priority == priority:
                planned.add(line.currency_code, line_target(line))
                done.add(line.currency_code, min(covered.get(line.id, ZERO), line_target(line)))
        return {"planned": planned.report(rate), "covered": done.report(rate)}

    location_blocks: dict[int, dict] = {}
    for loc_id in locations:
        planned, done = Bucket(), Bucket()
        for line in month.lines:
            group = groups.get(line.group_id)
            if group is not None and group.location_id == loc_id:
                planned.add(line.currency_code, line_target(line))
                done.add(line.currency_code, min(covered.get(line.id, ZERO), line_target(line)))
        location_blocks[loc_id] = {"planned": planned.report(rate), "covered": done.report(rate)}

    core_lines = [l for l in month.lines if l.is_core]
    core = None
    if core_lines:
        line = core_lines[0]
        core = {
            "line_id": line.id,
            "name": line.name,
            "currency_code": line.currency_code,
            "planned": line.planned,
            "covered": covered.get(line.id, ZERO),
        }

    def describe(alloc: Allocation) -> dict:
        line = lines.get(alloc.budget_line_id) if alloc.budget_line_id else None
        group = groups.get(line.group_id) if line else None
        location = locations.get(group.location_id) if group else None
        return {
            "id": alloc.id,
            "kind": alloc.kind,
            "amount": alloc.amount,
            "budget_line_id": alloc.budget_line_id,
            "line_amount": alloc.line_amount,
            "line_name": line.name if line else None,
            "line_currency": line.currency_code if line else None,
            "line_planned": line_target(line) if line else None,
            "group_name": group.name if group else None,
            "location_name": location.name if location else None,
        }

    def essentials_left(coverage: dict[int, Decimal]) -> dict:
        bucket = Bucket()
        for line in month.lines:
            if line.priority == "essential":
                left = line_target(line) - coverage.get(line.id, ZERO)
                if left > 0:
                    bucket.add(line.currency_code, left)
        return bucket.report(rate)

    upcoming = []
    still_reliable = Bucket()
    for src in sources:
        exp = expected.get(src.id)
        if not src.active or exp is None:
            continue
        left = exp.amount - arrived_by_source.get(src.id, ZERO)
        if left > 0:
            upcoming.append({
                "source_id": src.id, "name": src.name, "currency_code": src.currency_code,
                "amount": left, "expected_day": exp.expected_day or src.usual_day,
                "reliability": src.reliability,
            })
            if src.reliability == "regular":
                still_reliable.add(src.currency_code, left)
    upcoming.sort(key=lambda u: (u["expected_day"] or 99, u["name"]))

    arrivals = []
    for arrival in month.arrivals:
        row = {
            "id": arrival.id,
            "source_id": arrival.source_id,
            "source_name": arrival.source.name,
            "amount": arrival.amount,
            "currency_code": arrival.currency_code,
            "received_date": arrival.received_date,
            "note": arrival.note,
            "confirmed": arrival.confirmed,
            "adjusted": arrival.adjusted,
            "allocations": [describe(a) for a in arrival.allocations],
        }
        if not arrival.confirmed:
            # What would still be unfunded if this split were confirmed as it stands.
            row["essentials_left"] = essentials_left(line_coverage(month, include_arrival_id=arrival.id))
            # Reliable income still to come once this payment is counted.
            after = Bucket()
            for src in sources:
                exp = expected.get(src.id)
                if not src.active or exp is None or src.reliability != "regular":
                    continue
                got = arrived_by_source.get(src.id, ZERO) + (arrival.amount if src.id == arrival.source_id else ZERO)
                if exp.amount - got > 0:
                    after.add(src.currency_code, exp.amount - got)
            row["reliable_after"] = after.report(rate)
        arrivals.append(row)

    return jsonify({
        "month_id": month.id,
        "status": month.status,
        "shortfall_amount": month.shortfall_amount,
        "shortfall_source": month.shortfall_source,
        "core_note": month.core_note,
        "sources": [source_row(s) for s in sources],
        "fit": plan_fit(month),
        "arrivals": arrivals,
        "coverage": covered,
        "summary": {
            "arrived": arrived.report(rate),
            "savings_reserved": savings.report(rate),
            "free": free.report(rate),
            "core": core,
            "essential": priority_block("essential"),
            "flexible": priority_block("flexible"),
            "locations": location_blocks,
            "essentials_left": essentials_left(covered),
            "upcoming": upcoming,
            "upcoming_reliable": still_reliable.report(rate),
        },
    })
