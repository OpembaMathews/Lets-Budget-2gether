"""Lets Budget 2gether backend. Run with:  uvicorn app.main:app --reload --port 8000"""
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from .accounts import start_up
from .api import router
from .auth import admin_router, require_login
from .auth import router as auth_router
from .debts import router as debts_router
from .goals import router as goals_router
from .income import router as income_router
from .review import router as review_router
from .sends import router as sends_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    start_up()
    yield


app = FastAPI(title="Lets Budget 2gether", lifespan=lifespan)
app.include_router(auth_router)  # sign-in itself is open

# Every data route needs a signed-in session.
_signed_in = [Depends(require_login)]
for data_router in (router, income_router, sends_router, goals_router, debts_router, review_router, admin_router):
    app.include_router(data_router, dependencies=_signed_in)


@app.get("/api/health")
def health():
    return {"status": "ok"}
