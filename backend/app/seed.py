"""Sample starting data for a new, empty database.

The figures and names are made up. They show how the app is meant to be used:
someone working in Taiwan (NTD) who supports a household in Kenya (KES).
Everything can be renamed, changed or removed in the app. A database that
already holds data is never touched.
"""
from datetime import date
from datetime import date as Date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    Account, BudgetLine, Currency, ExpectedIncome, Goal, GoalItem, IncomeSource, LineGroup, Location, Month,
    Recipient, SplitRule,
)

FX_RATE = Decimal("4.0")  # KES for one NTD; change it on the Month plan

CURRENCIES = [("KES", "Kenyan Shilling"), ("NTD", "New Taiwan Dollar")]

ACCOUNTS = [
    ("Taiwan bank account", "NTD", "bank"),
    ("Kenya bank account", "KES", "bank"),
    ("M-Pesa", "KES", "mobile_money"),
    ("Chama fund", "KES", "chama"),
]

E, F = "essential", "flexible"
FIX, VAR = "fixed", "variable"

# location -> (currency, [(group, [(name, type, priority, planned, note, kind)])])
PLAN = {
    "Taiwan": ("NTD", [
        ("Living costs", [
            ("Meals", VAR, E, 2500, "Canteen and eating out", "expense"),
            ("Weekly shop", VAR, E, 3000, "Supermarket", "expense"),
            ("Transport pass", FIX, E, 1200, "Monthly bus and metro pass", "expense"),
            ("Phone & data", FIX, E, 600, "Mobile plan", "expense"),
            ("Toiletries", VAR, F, 300, "Soap, tissues and so on", "expense"),
            ("Clothes", VAR, F, 600, "Clothes and grooming", "expense"),
            ("Health", VAR, E, 400, "Clinic and pharmacy", "expense"),
            ("Books & study", VAR, F, 500, "Course materials", "expense"),
            ("Buffer", VAR, F, 600, "Anything unexpected", "expense"),
        ]),
    ]),
    "Kenya": ("KES", [
        ("Household", [
            ("Groceries", VAR, E, 3000, "Monthly household groceries", "expense"),
            ("Cereals", VAR, E, 2000, "Flour, rice, grains", "expense"),
            ("Toiletries", VAR, F, 800, "Soap, lotion and so on", "expense"),
            ("Weekly food", VAR, E, 3500, "Fresh food and snacks", "expense"),
            ("Cooking fuel", VAR, E, 1500, "Gas or charcoal", "expense"),
            ("Personal care", VAR, F, 600, "Hair and grooming", "expense"),
            ("Medicals", VAR, E, 4000, "Clinic and pharmacy", "expense"),
            ("Groceries (Top-up)", VAR, F, 500, "Top-up for shortfalls", "expense"),
            ("Cereals (Top-up)", VAR, F, 500, "Extra cereals", "expense"),
            ("Toiletries (Top-up)", VAR, F, 500, "Top-up toiletries", "expense"),
        ]),
        ("Utilities & Giving", [
            ("Data & Airtime", FIX, E, 1000, "Home internet and airtime", "expense"),
            ("Family support", VAR, F, 5000, "Help for the wider family", "expense"),
            ("Giving / charity", VAR, F, 2000, "Church, charity, tithe", "expense"),
        ]),
        ("Parents", [
            ("Groceries", FIX, E, 1200, "Parents' groceries", "expense"),
            ("Cereals", FIX, E, 600, "Parents' flour and rice", "expense"),
            ("Toiletries", FIX, E, 400, "Parents' personal care", "expense"),
        ]),
        ("School", [
            ("School Fees", FIX, E, 2500, "Term fees spread over the months", "expense"),
            ("Transport", VAR, E, 1000, "School bus or fare", "expense"),
            ("School supplies", VAR, E, 700, "Books, pens, materials", "expense"),
            ("Uniform & lunch", VAR, E, 1800, "Uniform and packed lunch", "expense"),
        ]),
        ("Savings", [
            ("Chama contribution", FIX, E, 3000, "Monthly chama contribution", "saving"),
        ]),
        ("My Savings", [
            ("Core saving", FIX, E, 6000, "A fixed amount saved every month. Change or remove it.", "saving"),
        ]),
    ]),
}


def seed_if_empty(db: Session, today: date | None = None) -> bool:
    """Load the starting data. Does nothing if the database already has data."""
    if db.scalars(select(Currency)).first() is not None:
        return False

    today = today or date.today()
    for code, name in CURRENCIES:
        db.add(Currency(code=code, name=name))
    db.flush()
    for name, currency, kind in ACCOUNTS:
        db.add(Account(name=name, currency_code=currency, kind=kind))

    month = Month(year=today.year, month=today.month, status="planning",
                  fx_rate_ntd_kes=FX_RATE, weeks=4)
    db.add(month)

    line_order = 0
    group_order = 0
    for loc_order, (loc_name, (currency, groups)) in enumerate(PLAN.items(), start=1):
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
    db.commit()
    return True


# name, currency, usual day, reliability, active, rule, save %, obligations %, expected
INCOME_SOURCES = [
    ("Main job", "NTD", 5, "regular", True, "percent_first", 20, None, 15000),
    ("Part-time job", "NTD", 20, "regular", True, "percent_first", 20, None, 12000),
    ("Freelance", "NTD", 10, "irregular", True, "percent_first", 25, None, 6000),
    ("Side projects", "NTD", None, "irregular", True, "three_way", 30, 40, 0),
    ("Kenya salary", "KES", None, "regular", False, "percent_first", 10, None, 0),
]


def seed_income_if_missing(db: Session) -> bool:
    """Load the income sources once, with expected income for every open month."""
    if db.scalars(select(IncomeSource)).first() is not None:
        return False
    if db.scalars(select(Currency)).first() is None:
        return False
    months = db.scalars(select(Month).where(Month.status != "closed")).all()
    for order, row in enumerate(INCOME_SOURCES, start=1):
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


# name, usual payment method
RECIPIENTS = [
    ("Partner", "M-Pesa"), ("Parent", "M-Pesa"), ("School", "Bank transfer"), ("Chama", "M-Pesa"),
    ("Me – Bank", "Bank transfer"),  # money moved to your own account at home
]

# section name -> usual recipient name
USUAL_RECIPIENT = {
    "Household": "Partner",
    "Utilities & Giving": "Partner",
    "Parents": "Parent",
    "School": "School",
    "Savings": "Partner",
    "My Savings": "Me – Bank",
}


def seed_recipients_if_missing(db: Session) -> bool:
    """Load the recipients once and give the Kenya sections a usual recipient."""
    if db.scalars(select(Recipient)).first() is not None:
        return False
    if db.scalars(select(Currency)).first() is None:
        return False
    by_name = {}
    for order, (name, method) in enumerate(RECIPIENTS, start=1):
        recipient = Recipient(name=name, usual_method=method, sort_order=order)
        db.add(recipient)
        by_name[name] = recipient
    db.flush()
    for group in db.scalars(select(LineGroup)):
        wanted = USUAL_RECIPIENT.get(group.name)
        if wanted and group.usual_recipient_id is None:
            group.usual_recipient_id = by_name[wanted].id
    db.commit()
    return True


# Sample projects and savings goals.
# (name, kind, category, currency, target, already in, monthly, target date,
#  importance, status, funded from, note)
GOALS = [
    ("Emergency Fund (Kenya)", "saving_goal", "Emergency", "KES", 100000, 0, 3000, "2027-12-31",
     "high", "active", None, "A few months of household costs."),
    ("Emergency Fund (Taiwan)", "saving_goal", "Emergency", "NTD", 20000, 0, 2000, "2027-12-31",
     "high", "active", None, "Two months of living costs."),
    ("Business equipment", "project", "Business", "KES", 80000, 0, 3000, "2027-12-31",
     "high", "planning", "Savings", "Equipment for a small home business."),
    ("Land savings", "project", "Land", "KES", 300000, 120000, 5000, "2028-06-30",
     "high", "active", "Savings", "Saving toward a plot of land."),
    ("School fees reserve", "saving_goal", "Education", "KES", 30000, 0, 2500, "2027-12-31",
     "medium", "active", None, "One full year of school fees."),
    ("Family event", "project", "Family", "KES", 150000, 0, 2000, "2028-12-31",
     "low", "planning", None, "A planned family celebration."),
    ("Home furniture", "project", "Home", "KES", 50000, 0, 2000, "2028-06-30",
     "low", "planning", None, "Beds, sofa, kitchen items. Phase by phase."),
    ("Laptop", "project", "Equipment", "KES", 60000, 0, None, None,
     "low", "planning", None, "A personal laptop."),
    ("Home repairs", "project", "Repairs", "KES", 10000, 0, None, "2027-06-30",
     "medium", "planning", None, "Windows and painting."),
    ("Chama fund", "saving_goal", "Savings", "KES", 24000, 0, 3000, "2027-12-31",
     "medium", "active", None, "Counted from the Chama contribution line in the plan."),
    ("Savings (Taiwan)", "saving_goal", "Personal", "NTD", 60000, 0, 3000, "2028-06-30",
     "medium", "active", None, "A buffer kept in Taiwan."),
    ("Water tank", "project", "Construction", "KES", 30000, 33500, None, "2026-06-30",
     "high", "completed", None, "Finished a little over budget."),
    ("New phone", "project", "Equipment", "KES", 20000, 20000, None, None,
     "high", "completed", None, "Completed."),
]

# A finished project's cost breakdown, as an example.
WATER_TANK_ITEMS = [
    ("Tank (5,000 litres)", "Materials", 18000),
    ("Base: sand, ballast, cement", "Materials", 6500),
    ("Gutters and pipes", "Materials", 3500),
    ("Labour", "Labour", 4000),
    ("Transport of the tank", "Transport", 1500),
]

# plan line name -> goal it counts toward
LINKED_LINES = {"Chama contribution": "Chama fund"}


def seed_goals_if_missing(db: Session) -> bool:
    """Load the projects and goals once, and link the plan lines that feed them."""
    if db.scalars(select(Goal)).first() is not None:
        return False
    if db.scalars(select(Currency)).first() is None:
        return False
    by_name = {}
    for rank, row in enumerate(GOALS, start=1):
        name, kind, category, currency, target, opening, monthly, when, importance, status, source, note = row
        goal = Goal(
            name=name, kind=kind, category=category, currency_code=currency, target=Decimal(target),
            opening_amount=Decimal(opening), monthly_amount=Decimal(monthly) if monthly is not None else None,
            target_date=Date.fromisoformat(when) if when else None, importance=importance, status=status,
            rank=rank, funded_from=source, note=note,
        )
        db.add(goal)
        by_name[name] = goal
    tank = by_name["Water tank"]
    for order, (name, category, cost) in enumerate(WATER_TANK_ITEMS, start=1):
        tank.items.append(GoalItem(name=name, category=category, estimate=Decimal(cost), actual=Decimal(cost),
                                     done=True, sort_order=order))
    db.flush()
    for line in db.scalars(select(BudgetLine).where(BudgetLine.goal_id.is_(None))):
        goal_name = LINKED_LINES.get(line.name)
        if goal_name:
            line.goal_id = by_name[goal_name].id
    db.commit()
    return True
