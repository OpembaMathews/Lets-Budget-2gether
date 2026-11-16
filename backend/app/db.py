"""Database connections. SQLite files, reached only through SQLAlchemy.

Every account has its own database file, so one person can never be shown
another person's budget. The accounts themselves are kept in accounts.py.
"""
import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session

BACKEND_DIR = Path(__file__).resolve().parent.parent
# The single database from before accounts existed. The owner's account keeps using it.
LEGACY_DB = "budget.db"

_engines: dict[Path, Engine] = {}


def data_dir() -> Path:
    """The folder holding every database file (BUDGET_DATA_DIR can point a test copy elsewhere)."""
    folder = Path(os.environ.get("BUDGET_DATA_DIR") or BACKEND_DIR / "data")
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def enable_foreign_keys(target_engine) -> None:
    @event.listens_for(target_engine, "connect")
    def _fk_on(dbapi_connection, _record):  # pragma: no cover - driver hook
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def engine_for(path: Path) -> Engine:
    """The one engine for a database file, created the first time it is asked for."""
    path = path.resolve()
    engine = _engines.get(path)
    if engine is None:
        engine = create_engine(f"sqlite:///{path.as_posix()}", connect_args={"check_same_thread": False})
        enable_foreign_keys(engine)
        _engines[path] = engine
    return engine


def forget_engine(path: Path) -> None:
    """Close a database file, so it can be moved or removed."""
    engine = _engines.pop(path.resolve(), None)
    if engine is not None:
        engine.dispose()


def forget_all_engines() -> None:
    for path in list(_engines):
        forget_engine(path)


def open_session(path: Path) -> Session:
    return Session(engine_for(path), autoflush=False, expire_on_commit=False)


def migrate(engine: Engine, revision: str = "head") -> None:
    """Bring one budget database up to the latest table layout."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.attributes["engine"] = engine  # migrations/env.py reads it from here
    command.upgrade(cfg, revision)


class Base(DeclarativeBase):
    pass
