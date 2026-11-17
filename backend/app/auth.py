"""Sign-in with a username and password.

- Anyone can create an account. Each account has its own budget (see accounts.py).
- A password is stored only as a salted scrypt hash.
- Signing in creates a random session token. Only its SHA-256 is stored; the token
  itself lives in an HttpOnly, SameSite=Strict cookie.
- Every data route depends on require_login, and get_db opens the signed-in
  person's own database, so nothing is returned without a valid session.
- After 5 wrong passwords in a row for a username, sign-in to it is paused for 60 seconds.
- The owner (super admin) can see the accounts, give one a new password, or remove it.
- Forgotten owner password: run `python -m app.reset_password` from backend/ on this computer.
"""
import hashlib
import hmac
import re
import secrets
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .accounts import User, UserSession, create_user, get_accounts_db, remove_user, user_db_path
from .db import open_session

router = APIRouter(prefix="/api/auth")
admin_router = APIRouter(prefix="/api/admin")

COOKIE = "budget_session"
SHORT = timedelta(hours=12)       # without "keep me signed in"
LONG = timedelta(days=30)         # with it
MAX_FAILS = 5
PAUSE_SECONDS = 60
MIN_LENGTH = 6
MAX_ACCOUNTS = 100                # the app is reachable from the internet; keep sign-ups bounded
USERNAME = re.compile(r"[a-z0-9][a-z0-9._-]{2,29}")
USERNAME_RULE = "A username is 3 to 30 letters, numbers, dots, dashes or underscores."

# username -> {"count": wrong passwords in a row, "until": paused until (monotonic seconds)}
_fails: dict[str, dict] = {}


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


def clean_username(raw: str) -> str:
    username = raw.strip().lower()
    if not USERNAME.fullmatch(username):
        raise HTTPException(422, USERNAME_RULE)
    return username


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---- sessions ---------------------------------------------------------------------

def _start_session(adb: Session, response: Response, user: User, remember: bool) -> None:
    adb.execute(delete(UserSession).where(UserSession.expires_at < datetime.now()))  # tidy old ones
    token = secrets.token_urlsafe(32)
    life = LONG if remember else SHORT
    adb.add(UserSession(token_hash=_token_hash(token), user_id=user.id, created_at=datetime.now(),
                        expires_at=datetime.now() + life, remember=remember))
    adb.commit()
    response.set_cookie(
        COOKIE, token, httponly=True, samesite="strict", path="/",
        max_age=int(life.total_seconds()) if remember else None,
    )


def current_session(request: Request, adb: Session) -> UserSession | None:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    session = adb.scalars(select(UserSession).where(UserSession.token_hash == _token_hash(token))).first()
    if session is None or session.expires_at < datetime.now():
        return None
    return session


def current_user(request: Request, adb: Session) -> User | None:
    session = current_session(request, adb)
    return adb.get(User, session.user_id) if session is not None else None


def require_login(request: Request, adb: Session = Depends(get_accounts_db)) -> User:
    """Guard for every data route."""
    user = current_user(request, adb)
    if user is None:
        raise HTTPException(401, "Please sign in")
    return user


def require_admin(user: User = Depends(require_login)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Only the owner of this app can do that")
    return user


def get_db(user: User = Depends(require_login)):
    """The signed-in person's own budget database."""
    with open_session(user_db_path(user)) as db:
        yield db


# ---- routes -----------------------------------------------------------------------

class SignupIn(BaseModel):
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=MIN_LENGTH, max_length=200)
    remember: bool = True


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1, max_length=200)
    remember: bool = False


class ChangeIn(BaseModel):
    current: str = Field(min_length=1, max_length=200)
    new: str = Field(min_length=MIN_LENGTH, max_length=200)


class DeleteMeIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class NewPasswordIn(BaseModel):
    new: str = Field(min_length=MIN_LENGTH, max_length=200)


@router.get("/status")
def status(request: Request, adb: Session = Depends(get_accounts_db)):
    user = current_user(request, adb)
    return {
        "set_up": adb.scalars(select(User)).first() is not None,  # does any account exist yet
        "signed_in": user is not None,
        "min_length": MIN_LENGTH,
        "user": {"username": user.username, "is_admin": user.is_admin} if user is not None else None,
    }


@router.post("/signup")
def signup(body: SignupIn, response: Response, adb: Session = Depends(get_accounts_db)):
    """Create an account with its own budget, and sign in. The first account is the owner."""
    username = clean_username(body.username)
    if adb.scalar(select(func.count()).select_from(User)) >= MAX_ACCOUNTS:
        raise HTTPException(403, "This app is not taking new accounts at the moment")
    if adb.scalars(select(User).where(User.username == username)).first() is not None:
        raise HTTPException(409, "That username is taken. Choose another, or sign in.")
    try:
        user = create_user(adb, username, hash_password(body.password))
    except IntegrityError:  # two sign-ups for the same name at the same moment
        adb.rollback()
        raise HTTPException(409, "That username is taken. Choose another, or sign in.")
    _start_session(adb, response, user, body.remember)
    return {"signed_in": True}


@router.post("/login")
def login(body: LoginIn, response: Response, adb: Session = Depends(get_accounts_db)):
    username = body.username.strip().lower()[:60]
    now = time.monotonic()
    for name in [n for n, f in _fails.items() if f["count"] == 0 and f["until"] < now]:
        del _fails[name]  # forget pauses that have run out
    if len(_fails) > 10_000:  # someone is trying endless usernames; do not let the list grow without end
        _fails.clear()
    fails = _fails.setdefault(username, {"count": 0, "until": 0.0})
    if now < fails["until"]:
        wait = int(fails["until"] - now) + 1
        raise HTTPException(429, f"Too many wrong passwords. Try again in {wait} seconds.")
    user = adb.scalars(select(User).where(User.username == username)).first()
    if user is None or not check_password(body.password, user.password_hash):
        fails["count"] += 1
        if fails["count"] >= MAX_FAILS:
            fails["count"] = 0
            fails["until"] = now + PAUSE_SECONDS
            raise HTTPException(429, f"Too many wrong passwords. Try again in {PAUSE_SECONDS} seconds.")
        raise HTTPException(401, "That username or password is not right")
    del _fails[username]
    _start_session(adb, response, user, body.remember)
    return {"signed_in": True}


@router.post("/logout")
def logout(request: Request, response: Response, adb: Session = Depends(get_accounts_db)):
    session = current_session(request, adb)
    if session is not None:
        adb.delete(session)
        adb.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"signed_in": False}


@router.post("/change-password")
def change_password(body: ChangeIn, request: Request, response: Response, adb: Session = Depends(get_accounts_db)):
    user = current_user(request, adb)
    if user is None:
        raise HTTPException(401, "Please sign in")
    if not check_password(body.current, user.password_hash):
        raise HTTPException(401, "Your current password is not right")
    user.password_hash = hash_password(body.new)
    # sign out everywhere, then sign this browser back in
    adb.execute(delete(UserSession).where(UserSession.user_id == user.id))
    adb.flush()
    _start_session(adb, response, user, remember=True)
    return {"signed_in": True}


@router.post("/delete-account")
def delete_my_account(body: DeleteMeIn, request: Request, response: Response, adb: Session = Depends(get_accounts_db)):
    """Delete the signed-in person's own account and budget, for good. They type their password to confirm."""
    user = current_user(request, adb)
    if user is None:
        raise HTTPException(401, "Please sign in")
    if user.is_admin:
        raise HTTPException(409, "The owner's account cannot be deleted, because the app needs an owner")
    if not check_password(body.password, user.password_hash):
        raise HTTPException(401, "That password is not right")
    try:
        remove_user(adb, user, erase=True)
    except OSError:  # the file is in use this very moment
        adb.rollback()
        raise HTTPException(503, "Your account could not be deleted just now. Try again in a moment.")
    _fails.pop(user.username, None)
    response.delete_cookie(COOKIE, path="/")
    return {"signed_in": False}


# ---- the owner's view of the accounts ---------------------------------------------

def _account(adb: Session, user_id: int) -> User:
    user = adb.get(User, user_id)
    if user is None:
        raise HTTPException(404, "No such account")
    return user


@admin_router.get("/accounts", dependencies=[Depends(require_admin)])
def list_accounts(adb: Session = Depends(get_accounts_db)):
    return [
        {"id": u.id, "username": u.username, "is_admin": u.is_admin, "created_at": u.created_at.isoformat()}
        for u in adb.scalars(select(User).order_by(User.id))
    ]


@admin_router.post("/accounts/{user_id}/password", dependencies=[Depends(require_admin)])
def set_account_password(user_id: int, body: NewPasswordIn, adb: Session = Depends(get_accounts_db)):
    """Give someone who forgot their password a new one. They are signed out everywhere."""
    user = _account(adb, user_id)
    user.password_hash = hash_password(body.new)
    adb.execute(delete(UserSession).where(UserSession.user_id == user.id))
    adb.commit()
    _fails.pop(user.username, None)
    return {"ok": True}


@admin_router.delete("/accounts/{user_id}")
def delete_account(user_id: int, me: User = Depends(require_admin), adb: Session = Depends(get_accounts_db)):
    user = _account(adb, user_id)
    if user.id == me.id:
        raise HTTPException(409, "You cannot remove your own account")
    return {"ok": True, "kept_as": remove_user(adb, user)}
