"""Starting data for a new, empty database.

A new account starts clean: a short plan with common line names and no amounts,
two income sources with nothing expected, and no projects. It is laid out for
someone working in Taiwan (NTD) who supports a household in Kenya (KES).
Everything can be renamed, changed or removed in the app. A database that
already holds data is never touched.
"""
from dataclasses import dataclass, field
from datetime import date
from datetime import date as Date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    Account, AppSetting, BudgetLine, Currency, ExpectedIncome, Goal, GoalItem, IncomeSource, LineGroup, Location, Month,
    Recipient, SplitRule,
)

FX_RATE = Decimal("4.0")  # KES for one NTD; change it on the Month plan

CURRENCIES = [("KES", "Kenyan Shilling"), ("NTD", "New Taiwan Dollar")]

E, F = "essential", "flexible"
FIX, VAR = "fixed", "variable"


@dataclass
class Starter:
    """Everything a new database is filled with."""

    # (name, currency, kind)
    accounts: list
    # location -> (currency, [(group, [(name, type, priority, planned, note, kind)])])
    plan: dict
    # (name, currency, usual day, reliability, active, rule, save %, obligations %, expected)
    income_sources: list
    # (name, usual payment method)
    recipients: list
    # section name -> usual recipient name
    usual_recipient: dict
    # (name, kind, category, currency, target, already in, monthly, target date,
    #  importance, status, funded from, note)
    goals: list = field(default_factory=list)
    # goal name -> [(item, category, cost)], a finished cost breakdown
    goal_items: dict = field(default_factory=dict)
    # plan line name -> goal it counts toward
    linked_lines: dict = field(default_factory=dict)


STARTER = Starter(
    accounts=[
        ("Taiwan bank account", "NTD", "bank"),
        ("Kenya bank account", "KES", "bank"),
        ("M-Pesa", "KES", "mobile_money"),
    ],
    plan={
        "Taiwan": ("NTD", [
            ("Living costs", [
                ("Rent", FIX, E, 0, "", "expense"),
                ("Food", VAR, E, 0, "", "expense"),
                ("Transport", VAR, E, 0, "", "expense"),
                ("Phone & internet", FIX, E, 0, "", "expense"),
                ("Other spending", VAR, F, 0, "", "expense"),
            ]),
        ]),
        "Kenya": ("KES", [
            ("Home", [
                ("Food & shopping", VAR, E, 0, "", "expense"),
                ("Bills", FIX, E, 0, "Electricity, water, internet", "expense"),
                ("Family support", VAR, F, 0, "", "expense"),
            ]),
            ("Savings", [
                ("Core saving", FIX, E, 0, "A fixed amount saved every month. Change or remove it.", "saving"),
            ]),
        ]),
    },
    income_sources=[
        ("Salary", "NTD", None, "regular", True, "percent_first", 10, None, 0),
        ("Other income", "NTD", None, "irregular", True, "percent_first", 10, None, 0),
    ],
    recipients=[
        ("Family", "M-Pesa"),
        ("Me – Bank", "Bank transfer"),  # money moved to your own account at home
    ],
    usual_recipient={"Home": "Family", "Savings": "Me – Bank"},
)


def seed_if_empty(db: Session, today: date | None = None) -> bool:
    """Load the starting data. Does nothing if the database already has data."""
    if db.scalars(select(Currency)).first() is not None:
        return False

    today = today or date.today()
    for code, name in CURRENCIES:
        db.add(Currency(code=code, name=name))
    db.flush()
    for name, currency, kind in STARTER.accounts:
        db.add(Account(name=name, currency_code=currency, kind=kind))

    month = Month(year=today.year, month=today.month, status="planning",
                  fx_rate_ntd_kes=FX_RATE, weeks=4)
    db.add(month)

    line_order = 0
    group_order = 0
    for loc_order, (loc_name, (currency, groups)) in enumerate(STARTER.plan.items(), start=1):
        location = Location(name=loc_name, default_currency=currency, sort_order=loc_order)
        db.add(location)
        db.flush()
        for group_name, lines in groups:
            group_order += 1
            group = LineGroup(name=group_name, location_id=location.id, sort_order=group_order)
            db.add(group)
            db.flush()
            for name, line_type, priority, planned, note, kind in lines:
                line_order += 1
                month.lines.append(BudgetLine(
                    group_id=group.id, name=name, currency_code=currency,
                    line_type=line_type, kind=kind, priority=priority,
                    planned=Decimal(planned), note=note, sort_order=line_order,
                    is_core=(name == "Core saving" and kind == "saving"),
                ))
    # A new budget opens on the set-up guide until its owner has been through it.
    db.add(AppSetting(key="setup_pending", value="1"))
    db.commit()
    return True


def seed_income_if_missing(db: Session) -> bool:
    """Load the income sources once, with expected income for every open month."""
    if db.scalars(select(IncomeSource)).first() is not None:
        return False
    if db.scalars(select(Currency)).first() is None:
        return False
    months = db.scalars(select(Month).where(Month.status != "closed")).all()
    for order, row in enumerate(STARTER.income_sources, start=1):
        name, currency, day, reliability, active, rule_type, save, obligations, expected = row
        source = IncomeSource(
            name=name, currency_code=currency, usual_day=day, reliability=reliability,
            active=active, sort_order=order,
            rule=SplitRule(
                rule_type=rule_type, save_percent=Decimal(save),
                obligations_percent=Decimal(obligations) if obligations is not None else None,
            ),
        )
        db.add(source)
        db.flush()
        if active:
            for month in months:
                db.add(ExpectedIncome(month_id=month.id, source_id=source.id,
                                      amount=Decimal(expected), expected_day=day))
    db.commit()
    return True


def seed_recipients_if_missing(db: Session) -> bool:
    """Load the recipients once and give the Kenya sections a usual recipient."""
    if db.scalars(select(Recipient)).first() is not None:
        return False
    if db.scalars(select(Currency)).first() is None:
        return False
    by_name = {}
    for order, (name, method) in enumerate(STARTER.recipients, start=1):
        recipient = Recipient(name=name, usual_method=method, sort_order=order)
        db.add(recipient)
        by_name[name] = recipient
    db.flush()
    for group in db.scalars(select(LineGroup)):
        wanted = STARTER.usual_recipient.get(group.name)
        if wanted and group.usual_recipient_id is None:
            group.usual_recipient_id = by_name[wanted].id
    db.commit()
    return True


def seed_goals_if_missing(db: Session) -> bool:
    """Load the starting projects and goals once, if there are any, and link the plan lines that feed them."""
    if not STARTER.goals or db.scalars(select(Goal)).first() is not None:
        return False
    if db.scalars(select(Currency)).first() is None:
        return False
    by_name = {}
    for rank, row in enumerate(STARTER.goals, start=1):
        name, kind, category, currency, target, opening, monthly, when, importance, status, source, note = row
        goal = Goal(
            name=name, kind=kind, category=category, currency_code=currency, target=Decimal(target),
            opening_amount=Decimal(opening), monthly_amount=Decimal(monthly) if monthly is not None else None,
            target_date=Date.fromisoformat(when) if when else None, importance=importance, status=status,
            rank=rank, funded_from=source, note=note,
        )
        db.add(goal)
        by_name[name] = goal
    for goal_name, items in STARTER.goal_items.items():
        for order, (name, category, cost) in enumerate(items, start=1):
            by_name[goal_name].items.append(GoalItem(name=name, category=category, estimate=Decimal(cost),
                                                     actual=Decimal(cost), done=True, sort_order=order))
    db.flush()
    for line in db.scalars(select(BudgetLine).where(BudgetLine.goal_id.is_(None))):
        goal_name = STARTER.linked_lines.get(line.name)
        if goal_name:
            line.goal_id = by_name[goal_name].id
    db.commit()
    return True
