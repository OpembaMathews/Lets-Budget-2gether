"""Accounts: who can sign in, and which database file holds each person's budget.

- data/accounts.db holds the accounts and their sign-in sessions, nothing else.
- Every account has its own budget database, given the clean starting plan
  when the account is created.
- The first account is the owner (super admin). It keeps the database from
  before accounts existed, if there is one.
"""
import secrets
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, delete, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from .db import LEGACY_DB, data_dir, engine_for, forget_engine, migrate, open_session
from .seed import seed_goals_if_missing, seed_if_empty, seed_income_if_missing, seed_recipients_if_missing

ACCOUNTS_DB = "accounts.db"
# The name given to the owner when a password from before accounts existed is carried over.
OWNER_USERNAME = "admin"

_ready: set[Path] = set()


class AccountsBase(DeclarativeBase):
    pass


class User(AccountsBase):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Always stored in lower case.
    username: Mapped[str] = mapped_column(String(30), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    # Hash of the recovery code that sets a new password when this one is forgotten. None: no code yet.
    recovery_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # File name of this person's budget database, inside the data folder.
    db_file: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class UserSession(AccountsBase):
    """A signed-in browser. Only a hash of its token is stored."""

    __tablename__ = "user_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    remember: Mapped[bool] = mapped_column(Boolean, default=False)


def accounts_session() -> Session:
    path = (data_dir() / ACCOUNTS_DB).resolve()
    engine = engine_for(path)
    if path not in _ready:
        AccountsBase.metadata.create_all(engine)
        with engine.begin() as conn:  # an accounts file from before recovery codes existed
            columns = {row[1] for row in conn.execute(text('PRAGMA table_info("user")'))}
            if "recovery_hash" not in columns:
                conn.execute(text('ALTER TABLE "user" ADD COLUMN recovery_hash VARCHAR(200)'))
        _ready.add(path)
    return Session(engine, autoflush=False, expire_on_commit=False)


def get_accounts_db():
    with accounts_session() as adb:
        yield adb


def user_db_path(user: User) -> Path:
    return data_dir() / user.db_file


def prepare_budget_db(path: Path) -> None:
    """Create or upgrade one budget database. A new one gets the clean starting plan."""
    migrate(engine_for(path))
    with open_session(path) as db:
        seed_if_empty(db)
        seed_income_if_missing(db)
        seed_recipients_if_missing(db)
        seed_goals_if_missing(db)


def create_user(adb: Session, username: str, password_hash: str) -> User:
    """Add an account with its own budget. The first one is the owner."""
    first = adb.scalars(select(User)).first() is None
    keeps_legacy = first and (data_dir() / LEGACY_DB).exists()
    db_file = LEGACY_DB if keeps_legacy else f"user-{secrets.token_hex(8)}.db"
    user = User(username=username, password_hash=password_hash, is_admin=first, db_file=db_file)
    adb.add(user)
    adb.flush()  # fails here if the username is taken, before any file is made
    prepare_budget_db(user_db_path(user))
    adb.commit()
    return user


def remove_user(adb: Session, user: User, erase: bool = False) -> str:
    """Delete an account. Its budget file is moved to data/removed, not destroyed.

    With `erase`, for someone deleting their own account, the budget file and
    its backup copies are deleted for good instead. Raises OSError, with the
    account left as it was, if the file cannot be deleted right now.
    """
    path = user_db_path(user)
    kept_as = ""
    forget_engine(path)
    if erase:
        copies = list((data_dir() / "backups").glob(f"{path.stem}-*.db"))
        for file in [path, Path(f"{path}-wal"), Path(f"{path}-shm"), Path(f"{path}-journal"), *copies]:
            file.unlink(missing_ok=True)
    elif path.exists():
        folder = data_dir() / "removed"
        folder.mkdir(exist_ok=True)
        target = folder / f"{datetime.now():%Y%m%d-%H%M%S}-{user.username}-{user.db_file}"
        shutil.move(str(path), str(target))
        kept_as = target.name
    adb.execute(delete(UserSession).where(UserSession.user_id == user.id))
    adb.delete(user)
    adb.commit()
    return kept_as


def _legacy_password_hash(path: Path) -> str | None:
    con = sqlite3.connect(path)
    try:
        row = con.execute("SELECT value FROM app_setting WHERE key = 'password_hash'").fetchone()
    except sqlite3.OperationalError:  # a database from before sign-in existed
        row = None
    finally:
        con.close()
    return row[0] if row else None


def adopt_legacy_password(adb: Session) -> bool:
    """Turn the single password from before accounts existed into the owner's account.

    The owner then signs in as OWNER_USERNAME with the password they already use.
    """
    legacy = data_dir() / LEGACY_DB
    if not legacy.exists() or adb.scalars(select(User)).first() is not None:
        return False
    stored = _legacy_password_hash(legacy)
    if stored is None:
        return False
    adb.add(User(username=OWNER_USERNAME, password_hash=stored, is_admin=True, db_file=LEGACY_DB))
    adb.commit()
    # The account now holds the password; do not leave a second copy behind.
    with engine_for(legacy).begin() as conn:
        conn.execute(text("DELETE FROM app_setting WHERE key = 'password_hash'"))
        conn.execute(text("DELETE FROM auth_session"))
    return True


def start_up() -> None:
    """Run when the app starts: bring every budget database up to date."""
    legacy = data_dir() / LEGACY_DB
    if legacy.exists():
        prepare_budget_db(legacy)
    with accounts_session() as adb:
        adopt_legacy_password(adb)
        for user in adb.scalars(select(User)):
            path = user_db_path(user)
            if path != legacy:
                prepare_budget_db(path)
