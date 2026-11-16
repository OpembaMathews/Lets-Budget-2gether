"""Migrations must upgrade a database that already holds data.

SQLite changes a table by rebuilding it, which fails if other tables point at it
while foreign-key checks are on. An empty test database never shows this, so
this test fills a database at the Phase 2 layout first, then upgrades it.
"""
from sqlalchemy import create_engine, text

from app.db import enable_foreign_keys, migrate


def test_upgrade_keeps_existing_data(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'old.db').as_posix()}")
    enable_foreign_keys(engine)  # the same setting the app uses

    migrate(engine, "194845c2779b")  # the Phase 2 layout
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO currency (code, name) VALUES ('KES', 'Kenyan Shilling')"))
        conn.execute(text("INSERT INTO location (id, name, default_currency, sort_order) VALUES (1, 'Kenya', 'KES', 1)"))
        conn.execute(text("INSERT INTO line_group (id, name, location_id, sort_order) VALUES (1, 'School', 1, 1)"))
        conn.execute(text(
            "INSERT INTO month (id, year, month, status, fx_rate_ntd_kes, weeks, opened_at) "
            "VALUES (1, 2026, 11, 'planning', '4.1', 4, '2026-11-01 00:00:00')"))
        conn.execute(text(
            "INSERT INTO budget_line (id, month_id, group_id, name, currency_code, line_type, kind, priority, "
            "planned, needs_review, is_core, sort_order) "
            "VALUES (1, 1, 1, 'School Fees', 'KES', 'fixed', 'expense', 'essential', 220000, 0, 0, 1)"))

    migrate(engine)

    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM budget_line")).scalar() == 1
        assert conn.execute(text("SELECT name FROM line_group WHERE id = 1")).scalar() == "School"
        assert conn.execute(text("PRAGMA foreign_key_check")).fetchall() == []
        tables = {r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type = 'table'"))}
        assert {"recipient", "send", "send_purpose"} <= tables
        assert not any(t.startswith("_alembic_tmp") for t in tables)
    engine.dispose()
