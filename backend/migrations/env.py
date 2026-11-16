"""Alembic environment. Uses the app's own engine and table definitions."""
from alembic import context

import app.models  # noqa: F401  (registers the tables)
from app.db import LEGACY_DB, Base, data_dir, engine_for

target_metadata = Base.metadata
# app.db.migrate passes the database to work on. Run from the command line, it is the owner's.
engine = context.config.attributes.get("engine") or engine_for(data_dir() / LEGACY_DB)


def run_migrations_online() -> None:
    with engine.connect() as connection:
        # SQLite alters a table by rebuilding it, which fails while other tables
        # point at it and foreign-key checks are on. Switch them off while
        # migrating, then confirm nothing was left pointing at a missing row.
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # needed for altering tables in SQLite
        )
        with context.begin_transaction():
            context.run_migrations()
        connection.commit()
        broken = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        if broken:
            raise RuntimeError(f"Migration left broken links between tables: {broken[:5]}")


if context.is_offline_mode():
    raise SystemExit("Offline migrations are not supported for this project.")
run_migrations_online()
