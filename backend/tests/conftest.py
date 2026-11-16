import os
import sys
from pathlib import Path

# Tests never touch the real database file.
os.environ["BUDGET_DB_URL"] = "sqlite://"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, enable_foreign_keys, get_db
from app.main import app
from app.seed import seed_if_empty


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    enable_foreign_keys(engine)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    engine.dispose()


@pytest.fixture()
def db(session_factory):
    with session_factory() as session:
        yield session


@pytest.fixture()
def client(session_factory):
    """API client on an empty in-memory database loaded with the starting data."""
    with session_factory() as session:
        seed_if_empty(session)

    def override():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override
    import app.auth as auth
    auth._fails.update(count=0, until=0.0)
    # Not used as a context manager, so the real startup (migrations) does not run.
    test_client = TestClient(app)
    # every data route needs a signed-in session: create the password and keep the cookie
    assert test_client.post("/api/auth/setup", json={"password": "test-password"}).status_code == 200
    yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def anonymous(client):
    """A second browser on the same app and data, not signed in."""
    return TestClient(app)
