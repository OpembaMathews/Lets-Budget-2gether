"""Where the budget's owner lives, where home is, and today's exchange rate between the two.

The app works with exactly two currencies. Inside they are always stored as
NTD (the currency where you live) and KES (the currency at home). These
settings say which countries and currencies those two really are for this
budget, and every screen shows those names instead.
"""
import json
import time
import urllib.request
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_db
from .models import Account, AppSetting, Location, Recipient
from .services import BASE, QUOTE

router = APIRouter(prefix="/api")

DEFAULTS = {
    "residence_country": "Taiwan", "residence_currency": "NTD",
    "home_country": "Kenya", "home_currency": "KES",
}
# Names the app uses that the rate service knows under another code.
ISO_CODE = {"NTD": "TWD"}
RATE_URL = "https://open.er-api.com/v6/latest/{code}"
RATE_SOURCE = "open.er-api.com"
KEEP_RATES_FOR = 3600  # seconds

_rates: dict[str, tuple[float, dict]] = {}


def get_profile(db: Session) -> dict:
    stored = {s.key: s.value for s in db.scalars(select(AppSetting).where(AppSetting.key.in_(DEFAULTS)))}
    return {**DEFAULTS, **stored}


def currency_labels(db: Session) -> dict:
    """The stored currency code -> the code to show for it."""
    p = get_profile(db)
    return {BASE: p["residence_currency"], QUOTE: p["home_currency"]}


class ProfileIn(BaseModel):
    residence_country: str = Field(min_length=1, max_length=60)
    residence_currency: str = Field(pattern=r"^[A-Z]{3}$")
    home_country: str = Field(min_length=1, max_length=60)
    home_currency: str = Field(pattern=r"^[A-Z]{3}$")


@router.get("/settings/profile")
def read_profile(db: Session = Depends(get_db)):
    return get_profile(db)


@router.put("/settings/profile")
def set_profile(body: ProfileIn, db: Session = Depends(get_db)):
    """Save the two countries, and rename what was still named after the old ones."""
    old, new = get_profile(db), body.model_dump()
    new["residence_country"], new["home_country"] = new["residence_country"].strip(), new["home_country"].strip()
    if new["residence_country"].lower() == new["home_country"].lower():
        raise HTTPException(422, "Choose two different countries")

    for key, value in new.items():
        setting = db.get(AppSetting, key)
        if setting is None:
            db.add(AppSetting(key=key, value=value))
        else:
            setting.value = value

    # Locations keep any name the user gave them; only the country names follow the change.
    renames = {}
    for which, currency in (("residence_country", BASE), ("home_country", QUOTE)):
        if old[which] == new[which]:
            continue
        location = db.scalars(
            select(Location).where(Location.name == old[which], Location.default_currency == currency)).first()
        if location is not None:
            renames[location] = new[which]
    taken = {l.name for l in db.scalars(select(Location)) if l not in renames}
    renames = {l: name for l, name in renames.items() if name not in taken}
    for location in renames:  # names are unique, so step aside first in case the two swap
        location.name = f"{location.name} (moving)"
    db.flush()
    for location, name in renames.items():
        location.name = name

    for which in ("residence_country", "home_country"):
        for account in db.scalars(select(Account).where(Account.name == f"{old[which]} bank account")):
            account.name = f"{new[which]} bank account"
    # M-Pesa is Kenya's mobile money; elsewhere the starting account and recipients just say so.
    before, after = ("M-Pesa", "Mobile money") if new["home_country"] != "Kenya" else ("Mobile money", "M-Pesa")
    for account in db.scalars(select(Account).where(Account.name == before)):
        account.name = after
    for recipient in db.scalars(select(Recipient).where(Recipient.usual_method == before)):
        recipient.usual_method = after
    db.commit()
    return get_profile(db)


def _fetch_rates(code: str) -> dict:
    hit = _rates.get(code)
    if hit and time.time() - hit[0] < KEEP_RATES_FOR:
        return hit[1]
    with urllib.request.urlopen(RATE_URL.format(code=code), timeout=8) as response:
        data = json.load(response)
    if data.get("result") != "success":
        raise ValueError("no rates")
    _rates[code] = (time.time(), data)
    return data


@router.get("/fx-rate")
def fx_rate(db: Session = Depends(get_db)):
    """Today's market rate between the two currencies, as a suggestion. Only the two currency codes leave this computer."""
    p = get_profile(db)
    db.rollback()  # let go of the database before waiting on the network, so nothing else is held up
    base, quote = p["residence_currency"], p["home_currency"]
    if base == quote:
        return {"base": base, "quote": quote, "rate": "1", "as_of": None, "source": None}
    try:
        data = _fetch_rates(ISO_CODE.get(base, base))
    except Exception:  # offline, a timeout, an unknown currency: the rate is only a suggestion
        raise HTTPException(503, "Today's rate could not be fetched. Type the rate yourself.")
    rate = data.get("rates", {}).get(ISO_CODE.get(quote, quote))
    if not rate:
        raise HTTPException(404, f"No rate found for {quote}. Type the rate yourself.")
    rate = Decimal(str(rate))
    return {
        "base": base, "quote": quote,
        "rate": str(rate.quantize(Decimal("0.01") if rate >= 100 else Decimal("0.0001") if rate >= 1 else Decimal("0.000001"))),
        "as_of": data.get("time_last_update_utc"), "source": RATE_SOURCE,
    }
