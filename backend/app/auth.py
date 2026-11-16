"""Sign-in with a single password.

- The password is stored only as a salted scrypt hash (in app_setting, key "password_hash").
- Signing in creates a random session token. Only its SHA-256 is stored; the token
  itself lives in an HttpOnly, SameSite=Strict cookie.
- Every data route depends on require_login, so nothing is returned without a valid session.
- After 5 wrong passwords in a row, sign-in is paused for 60 seconds.
- Forgotten password: run `python -m app.reset_password` from backend/ on this computer.
"""
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import AppSetting, AuthSession

router = APIRouter(prefix="/api/auth")

COOKIE = "budget_session"
SHORT = timedelta(hours=12)       # without "keep me signed in"
LONG = timedelta(days=30)         # with it
MAX_FAILS = 5
PAUSE_SECONDS = 60
MIN_LENGTH = 6

_fails = {"count": 0, "until": 0.0}


# ---- passwords --------------------------------------------------------------------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32)
    return hmac.compare_digest(digest.hex(), digest_hex)


def _stored_hash(db: Session) -> str | None:
    setting = db.get(AppSetting, "password_hash")
    return setting.value if setting is not None else None


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---- sessions ---------------------------------------------------------------------

def _start_session(db: Session, response: Response, remember: bool) -> None:
    db.execute(delete(AuthSession).where(AuthSession.expires_at < datetime.now()))  # tidy old ones
    token = secrets.token_urlsafe(32)
    life = LONG if remember else SHORT
    db.add(AuthSession(token_hash=_token_hash(token), created_at=datetime.now(),
                       expires_at=datetime.now() + life, remember=remember))
    db.commit()
    response.set_cookie(
        COOKIE, token, httponly=True, samesite="strict", path="/",
        max_age=int(life.total_seconds()) if remember else None,
    )


def current_session(request: Request, db: Session) -> AuthSession | None:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    session = db.scalars(select(AuthSession).where(AuthSession.token_hash == _token_hash(token))).first()
    if session is None or session.expires_at < datetime.now():
        return None
    return session


def require_login(request: Request, db: Session = Depends(get_db)) -> None:
    """Guard for every data route."""
    if current_session(request, db) is None:
        raise HTTPException(401, "Please sign in")


# ---- routes -----------------------------------------------------------------------

class SetupIn(BaseModel):
    password: str = Field(min_length=MIN_LENGTH, max_length=200)
    remember: bool = True


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    remember: bool = False


class ChangeIn(BaseModel):
    current: str = Field(min_length=1, max_length=200)
    new: str = Field(min_length=MIN_LENGTH, max_length=200)


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)):
    return {"set_up": _stored_hash(db) is not None, "signed_in": current_session(request, db) is not None,
            "min_length": MIN_LENGTH}


@router.post("/setup")
def setup(body: SetupIn, response: Response, db: Session = Depends(get_db)):
    """Create the password. Only possible while none exists."""
    if _stored_hash(db) is not None:
        raise HTTPException(409, "A password is already set. Sign in instead.")
    db.add(AppSetting(key="password_hash", value=hash_password(body.password)))
    db.flush()
    _start_session(db, response, body.remember)
    return {"signed_in": True}


@router.post("/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    now = time.monotonic()
    if now < _fails["until"]:
        wait = int(_fails["until"] - now) + 1
        raise HTTPException(429, f"Too many wrong passwords. Try again in {wait} seconds.")
    stored = _stored_hash(db)
    if stored is None:
        raise HTTPException(409, "No password has been set yet")
    if not check_password(body.password, stored):
        _fails["count"] += 1
        if _fails["count"] >= MAX_FAILS:
            _fails["count"] = 0
            _fails["until"] = now + PAUSE_SECONDS
            raise HTTPException(429, f"Too many wrong passwords. Try again in {PAUSE_SECONDS} seconds.")
        raise HTTPException(401, "That password is not right")
    _fails["count"] = 0
    _start_session(db, response, body.remember)
    return {"signed_in": True}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    session = current_session(request, db)
    if session is not None:
        db.delete(session)
        db.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"signed_in": False}


@router.post("/change-password")
def change_password(body: ChangeIn, request: Request, response: Response, db: Session = Depends(get_db)):
    if current_session(request, db) is None:
        raise HTTPException(401, "Please sign in")
    stored = _stored_hash(db)
    if stored is None or not check_password(body.current, stored):
        raise HTTPException(401, "Your current password is not right")
    db.get(AppSetting, "password_hash").value = hash_password(body.new)
    db.execute(delete(AuthSession))  # sign out everywhere, then sign this browser back in
    db.flush()
    _start_session(db, response, remember=True)
    return {"signed_in": True}
