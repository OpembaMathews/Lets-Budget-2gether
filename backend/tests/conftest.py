import os
import sys
import tempfile
from pathlib import Path

# Tests never touch the real database files.
os.environ["BUDGET_DATA_DIR"] = tempfile.mkdtemp(prefix="budget-tests-")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.auth as auth
from app.accounts import AccountsBase, User, get_accounts_db
from app.db import Base, enable_foreign_keys, forget_all_engines
from app.main import app
import app.seed as seed
from app.seed import seed_if_empty
from sample import SAMPLE

USERNAME, PASSWORD = "tester", "test-password"
# What a new account really starts from. The tests swap it for the fuller sample budget.
REAL_STARTER = seed.STARTER


@pytest.fixture(autouse=True)
def sample_budget(monkeypatch):
    monkeypatch.setattr(seed, "STARTER", SAMPLE)


def _memory_factory(base):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    enable_foreign_keys(engine)
    base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture()
def session_factory():
    engine, factory = _memory_factory(Base)
    yield factory
    engine.dispose()


@pytest.fixture()
def db(session_factory):
    with session_factory() as session:
        yield session


@pytest.fixture()
def client(session_factory):
    """API client, signed in, on an empty in-memory database loaded with the starting data."""
    with session_factory() as session:
        seed_if_empty(session)
    accounts_engine, accounts_factory = _memory_factory(AccountsBase)
    with accounts_factory() as adb:
        adb.add(User(username=USERNAME, password_hash=auth.hash_password(PASSWORD), is_admin=True, db_file="unused.db"))
        adb.commit()

    def override():
        with session_factory() as session:
            yield session

    def override_accounts():
        with accounts_factory() as adb:
            yield adb

    app.dependency_overrides[auth.get_db] = override
    app.dependency_overrides[get_accounts_db] = override_accounts
    auth._fails.clear()
    # Not used as a context manager, so the real startup (migrations) does not run.
    test_client = TestClient(app)
    # every data route needs a signed-in session: sign in and keep the cookie
    assert test_client.post("/api/auth/login", json={"username": USERNAME, "password": PASSWORD}).status_code == 200
    yield test_client
    app.dependency_overrides.clear()
    accounts_engine.dispose()


@pytest.fixture()
def anonymous(client):
    """A second browser on the same app and data, not signed in."""
    return TestClient(app)


@pytest.fixture()
def real_files(tmp_path, monkeypatch):
    """The app on real database files in an empty folder: nothing overridden, no accounts yet."""
    monkeypatch.setenv("BUDGET_DATA_DIR", str(tmp_path))
    auth._fails.clear()
    yield tmp_path
    forget_all_engines()  # let go of the files so the folder can be removed
