"""Budget Track backend. Run with:  uvicorn app.main:app --reload --port 8000"""
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from fastapi import Depends, FastAPI

from .api import router
from .auth import require_login
from .auth import router as auth_router
from .db import BACKEND_DIR, SessionLocal
from .debts import router as debts_router
from .goals import router as goals_router
from .income import router as income_router
from .review import router as review_router
from .sends import router as sends_router
from .seed import seed_goals_if_missing, seed_if_empty, seed_income_if_missing, seed_recipients_if_missing


def run_migrations() -> None:
    """Bring the database up to the latest table layout."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    run_migrations()
    with SessionLocal() as db:
        seed_if_empty(db)
        seed_income_if_missing(db)
        seed_recipients_if_missing(db)
        seed_goals_if_missing(db)
    yield


app = FastAPI(title="Budget Track", lifespan=lifespan)
app.include_router(auth_router)  # sign-in itself is open

# Every data route needs a signed-in session.
_signed_in = [Depends(require_login)]
for data_router in (router, income_router, sends_router, goals_router, debts_router, review_router):
    app.include_router(data_router, dependencies=_signed_in)


@app.get("/api/health")
def health():
    return {"status": "ok"}
