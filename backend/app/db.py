"""Database connection. One SQLite file, reached only through SQLAlchemy."""
import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"


def _default_url() -> str:
    DATA_DIR.mkdir(exist_ok=True)
    return f"sqlite:///{(DATA_DIR / 'budget.db').as_posix()}"


DATABASE_URL = os.environ.get("BUDGET_DB_URL") or _default_url()

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def enable_foreign_keys(target_engine) -> None:
    @event.listens_for(target_engine, "connect")
    def _fk_on(dbapi_connection, _record):  # pragma: no cover - driver hook
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


enable_foreign_keys(engine)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
