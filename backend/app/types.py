"""Exact money and rate column types. Money is never stored as a float."""
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import Integer, String
from sqlalchemy.types import TypeDecorator

CENT = Decimal("0.01")


def to_money(value) -> Decimal:
    """Any number-like value as a Decimal rounded to two places."""
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


class Money(TypeDecorator):
    """Stored as whole cents in an integer column, read back as Decimal."""

    impl = Integer
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return int((to_money(value) * 100).to_integral_value(rounding=ROUND_HALF_UP))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return (Decimal(value) / 100).quantize(CENT)


class Rate(TypeDecorator):
    """An exchange rate stored as exact decimal text."""

    impl = String(32)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(Decimal(str(value)))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return Decimal(value)
