"""Tables. Phase 1: currency, account, location, line_group, month, budget_line.
Phase 2: income_source, split_rule, expected_income, income_arrival, allocation.
Phase 3: recipient, send, send_purpose.
Projects and goals: goal, goal_item, goal_entry."""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base
from .types import Money, Rate

MONTH_STATUSES = ("planning", "active", "closed")
LINE_TYPES = ("fixed", "variable", "one_off")
LINE_KINDS = ("expense", "saving", "debt_repayment")
PRIORITIES = ("essential", "flexible")
ACCOUNT_KINDS = ("bank", "mobile_money", "savings", "chama")
RELIABILITIES = ("regular", "irregular")
RULE_TYPES = ("none", "percent_first", "fixed_first", "three_way")
ALLOCATION_KINDS = ("core_saving", "savings", "essential", "flexible", "project", "free")
SPLIT_ORDERS = ("bills_first", "savings_first")


class Currency(Base):
    __tablename__ = "currency"

    code: Mapped[str] = mapped_column(String(3), primary_key=True)
    name: Mapped[str] = mapped_column(String(60))


class Account(Base):
    __tablename__ = "account"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    currency_code: Mapped[str] = mapped_column(ForeignKey("currency.code"))
    kind: Mapped[str] = mapped_column(String(20), default="bank")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Location(Base):
    __tablename__ = "location"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    default_currency: Mapped[str] = mapped_column(ForeignKey("currency.code"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    groups: Mapped[list["LineGroup"]] = relationship(
        back_populates="location", order_by="LineGroup.sort_order"
    )


class LineGroup(Base):
    __tablename__ = "line_group"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    location_id: Mapped[int] = mapped_column(ForeignKey("location.id"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Who money for this section is usually sent to.
    usual_recipient_id: Mapped[int | None] = mapped_column(
        ForeignKey("recipient.id", ondelete="SET NULL"), nullable=True
    )

    location: Mapped[Location] = relationship(back_populates="groups")


class Month(Base):
    __tablename__ = "month"
    __table_args__ = (UniqueConstraint("year", "month", name="uq_month_year_month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year: Mapped[int] = mapped_column(Integer)
    month: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default="planning")
    # How many KES one NTD buys. The single planning rate for the month.
    fx_rate_ntd_kes: Mapped[Decimal] = mapped_column(Rate)
    weeks: Mapped[int] = mapped_column(Integer, default=4)
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Set when the month was started with a plan larger than reliable income.
    shortfall_amount: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    shortfall_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Reasons given for reducing or removing the core saving this month.
    core_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Month-end review: what the user noted, and a log of closing and reopening.
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    close_log: Mapped[str | None] = mapped_column(Text, nullable=True)

    lines: Mapped[list["BudgetLine"]] = relationship(
        back_populates="month", cascade="all, delete-orphan", order_by="BudgetLine.sort_order"
    )
    expected: Mapped[list["ExpectedIncome"]] = relationship(
        back_populates="month", cascade="all, delete-orphan"
    )
    arrivals: Mapped[list["IncomeArrival"]] = relationship(
        back_populates="month", cascade="all, delete-orphan", order_by="IncomeArrival.id"
    )


class BudgetLine(Base):
    __tablename__ = "budget_line"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    month_id: Mapped[int] = mapped_column(ForeignKey("month.id", ondelete="CASCADE"))
    group_id: Mapped[int] = mapped_column(ForeignKey("line_group.id"))
    name: Mapped[str] = mapped_column(String(120))
    currency_code: Mapped[str] = mapped_column(ForeignKey("currency.code"))
    line_type: Mapped[str] = mapped_column(String(12), default="variable")
    kind: Mapped[str] = mapped_column(String(16), default="expense")
    priority: Mapped[str] = mapped_column(String(12), default="flexible")
    # Set for weekly lines. Planned is then weekly_amount x the month's weeks.
    weekly_amount: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    planned: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    actual: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    # True when the amount was carried over as a suggestion and not yet confirmed.
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    # The one fixed monthly saving, taken from the first reliable payment.
    is_core: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    destination_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("account.id", ondelete="SET NULL"), nullable=True
    )
    # The project or goal this line's money goes toward. Its actual counts as funding.
    goal_id: Mapped[int | None] = mapped_column(ForeignKey("goal.id", ondelete="SET NULL"), nullable=True)
    # Who this line's money is sent to, when not the section's usual recipient.
    recipient_id: Mapped[int | None] = mapped_column(ForeignKey("recipient.id", ondelete="SET NULL"), nullable=True)
    # The debt this line repays. Its actual counts as a repayment.
    debt_id: Mapped[int | None] = mapped_column(ForeignKey("debt.id", ondelete="SET NULL"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    month: Mapped[Month] = relationship(back_populates="lines")
    group: Mapped[LineGroup] = relationship()
    goal: Mapped["Goal | None"] = relationship()


class IncomeSource(Base):
    __tablename__ = "income_source"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    currency_code: Mapped[str] = mapped_column(ForeignKey("currency.code"))
    usual_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Regular income counts toward covering the plan. Irregular income never does.
    reliability: Mapped[str] = mapped_column(String(12), default="regular")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    rule: Mapped["SplitRule"] = relationship(
        back_populates="source", uselist=False, cascade="all, delete-orphan"
    )


class SplitRule(Base):
    """How each payment from one source is divided before it can be spent."""

    __tablename__ = "split_rule"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("income_source.id", ondelete="CASCADE"), unique=True)
    rule_type: Mapped[str] = mapped_column(String(16), default="percent_first")
    save_percent: Mapped[Decimal | None] = mapped_column(Rate, nullable=True)
    save_fixed: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    # three_way only: the share that may go to budget lines. The rest is personal.
    obligations_percent: Mapped[Decimal | None] = mapped_column(Rate, nullable=True)

    source: Mapped[IncomeSource] = relationship(back_populates="rule")


class ExpectedIncome(Base):
    __tablename__ = "expected_income"
    __table_args__ = (UniqueConstraint("month_id", "source_id", name="uq_expected_month_source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    month_id: Mapped[int] = mapped_column(ForeignKey("month.id", ondelete="CASCADE"))
    source_id: Mapped[int] = mapped_column(ForeignKey("income_source.id", ondelete="CASCADE"))
    amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    expected_day: Mapped[int | None] = mapped_column(Integer, nullable=True)

    month: Mapped[Month] = relationship(back_populates="expected")
    source: Mapped[IncomeSource] = relationship()


class IncomeArrival(Base):
    """One actual payment. Recording it produces a split to confirm."""

    __tablename__ = "income_arrival"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    month_id: Mapped[int] = mapped_column(ForeignKey("month.id", ondelete="CASCADE"))
    source_id: Mapped[int] = mapped_column(ForeignKey("income_source.id"))
    amount: Mapped[Decimal] = mapped_column(Money)
    currency_code: Mapped[str] = mapped_column(ForeignKey("currency.code"))
    received_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    # True once the user has changed the split by hand. Such a split is kept as it
    # is; every other split is worked out again whenever payments change.
    adjusted: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    month: Mapped[Month] = relationship(back_populates="arrivals")
    source: Mapped[IncomeSource] = relationship()
    allocations: Mapped[list["Allocation"]] = relationship(
        back_populates="arrival", cascade="all, delete-orphan", order_by="Allocation.id"
    )


class Allocation(Base):
    """One slice of a payment. Amount is in the payment's currency."""

    __tablename__ = "allocation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    arrival_id: Mapped[int] = mapped_column(ForeignKey("income_arrival.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    amount: Mapped[Decimal] = mapped_column(Money)
    budget_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("budget_line.id", ondelete="SET NULL"), nullable=True
    )
    # The same slice in the budget line's own currency.
    line_amount: Mapped[Decimal | None] = mapped_column(Money, nullable=True)

    arrival: Mapped[IncomeArrival] = relationship(back_populates="allocations")
    line: Mapped[BudgetLine | None] = relationship()


class Recipient(Base):
    """A person or payee money is sent to, e.g. a partner, a parent, a school, a chama."""

    __tablename__ = "recipient"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    usual_method: Mapped[str | None] = mapped_column(String(40), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Send(Base):
    """One transfer of money home. A month can have one send or many."""

    __tablename__ = "send"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    month_id: Mapped[int] = mapped_column(ForeignKey("month.id", ondelete="CASCADE"))
    sent_date: Mapped[date] = mapped_column(Date)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("recipient.id"))
    # The amount that arrived, in KES. Always required.
    amount_kes: Mapped[Decimal] = mapped_column(Money)
    # Optional: what it cost in NTD in total, and the fee within that.
    amount_ntd: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    fee_ntd: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    platform: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(60), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    recipient: Mapped[Recipient] = relationship()
    purposes: Mapped[list["SendPurpose"]] = relationship(
        back_populates="send", cascade="all, delete-orphan", order_by="SendPurpose.id"
    )


class SendPurpose(Base):
    """Part of a send given to one budget line. Never more than the send in total."""

    __tablename__ = "send_purpose"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    send_id: Mapped[int] = mapped_column(ForeignKey("send.id", ondelete="CASCADE"))
    budget_line_id: Mapped[int] = mapped_column(ForeignKey("budget_line.id", ondelete="CASCADE"))
    amount_kes: Mapped[Decimal] = mapped_column(Money)
    # Set when the amount was given to a whole section and spread over its lines.
    via_group_id: Mapped[int | None] = mapped_column(
        ForeignKey("line_group.id", ondelete="SET NULL"), nullable=True
    )

    send: Mapped[Send] = relationship(back_populates="purposes")
    line: Mapped[BudgetLine] = relationship()


GOAL_KINDS = ("project", "saving_goal")
GOAL_STATUSES = ("planning", "active", "on_hold", "completed", "cancelled")
IMPORTANCE = ("high", "medium", "low")


class Goal(Base):
    """A project (land, sewing machine, construction) or a savings goal (emergency fund).

    Funded = opening amount + actuals of linked plan lines + one-off entries.
    For a project, spent = the actual cost of its breakdown items.
    """

    __tablename__ = "goal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16), default="project")
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    currency_code: Mapped[str] = mapped_column(ForeignKey("currency.code"))
    target: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    # Money already put in before it was tracked here.
    opening_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    monthly_amount: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    importance: Mapped[str] = mapped_column(String(8), default="medium")
    status: Mapped[str] = mapped_column(String(12), default="planning")
    # Order in which goals get money: 1 comes first.
    rank: Mapped[int] = mapped_column(Integer, default=0)
    funded_from: Mapped[str | None] = mapped_column(String(80), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["GoalItem"]] = relationship(
        back_populates="goal", cascade="all, delete-orphan", order_by="GoalItem.sort_order"
    )
    entries: Mapped[list["GoalEntry"]] = relationship(
        back_populates="goal", cascade="all, delete-orphan", order_by="GoalEntry.entry_date"
    )


class GoalItem(Base):
    """One part of a project's cost: materials, labour, meals, unplanned extras."""

    __tablename__ = "goal_item"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goal.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    estimate: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    actual: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    goal: Mapped[Goal] = relationship(back_populates="items")


class GoalEntry(Base):
    """Money put toward a goal outside the monthly plan, e.g. a bonus. In the goal's currency."""

    __tablename__ = "goal_entry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goal.id", ondelete="CASCADE"))
    entry_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Money)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    goal: Mapped[Goal] = relationship(back_populates="entries")


class AppSetting(Base):
    """One app-wide choice, stored as text. Key "split_order": bills_first or savings_first."""

    __tablename__ = "app_setting"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


DEBT_STATUSES = ("open", "cleared")
DEBT_ENTRY_KINDS = ("borrowed", "repaid")


class Debt(Base):
    """Money owed: a loan, a phone on credit, an overdraft such as Fuliza.

    Balance = starting balance + borrowed entries - repaid entries - actuals of
    plan lines linked to it.
    """

    __tablename__ = "debt"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lender: Mapped[str] = mapped_column(String(80))
    currency_code: Mapped[str] = mapped_column(ForeignKey("currency.code"))
    starting_balance: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    monthly_repayment: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    started_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(8), default="open")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    entries: Mapped[list["DebtEntry"]] = relationship(
        back_populates="debt", cascade="all, delete-orphan", order_by="DebtEntry.entry_date"
    )


class DebtEntry(Base):
    """Borrowing more, or a repayment made outside the monthly plan. In the debt's currency."""

    __tablename__ = "debt_entry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    debt_id: Mapped[int] = mapped_column(ForeignKey("debt.id", ondelete="CASCADE"))
    entry_date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(10))
    amount: Mapped[Decimal] = mapped_column(Money)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    debt: Mapped[Debt] = relationship(back_populates="entries")


class BalanceCheck(Base):
    """The real balance of one account at the end of a month."""

    __tablename__ = "balance_check"
    __table_args__ = (UniqueConstraint("month_id", "account_id", name="uq_balance_month_account"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    month_id: Mapped[int] = mapped_column(ForeignKey("month.id", ondelete="CASCADE"))
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id", ondelete="CASCADE"))
    actual_balance: Mapped[Decimal] = mapped_column(Money)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class AuthSession(Base):
    """No longer used: sign-in sessions now live with the accounts (accounts.py).

    Kept so the table layout still matches databases made before accounts existed.
    """

    __tablename__ = "auth_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    remember: Mapped[bool] = mapped_column(Boolean, default=False)
