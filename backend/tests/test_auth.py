"""Sign-in: accounts, sessions in an HttpOnly cookie, every data route protected, each account its own data."""
import sqlite3
from decimal import Decimal

from fastapi.testclient import TestClient

from app.accounts import start_up
from app.auth import check_password, hash_password
from app.db import LEGACY_DB, engine_for, migrate
from app.main import app

DATA_ROUTES = ["/api/meta", "/api/months", "/api/goals", "/api/debts", "/api/history", "/api/recipients",
               "/api/income-sources", "/api/settings/split-order", "/api/admin/accounts"]
ME = {"username": "tester", "password": "test-password"}


def test_password_is_stored_as_a_salted_hash():
    stored = hash_password("my secret")
    assert "my secret" not in stored and stored.startswith("scrypt$")
    assert hash_password("my secret") != stored                    # a new salt each time
    assert check_password("my secret", stored) and not check_password("My secret", stored)


def test_every_data_route_is_refused_without_signing_in(anonymous):
    for path in DATA_ROUTES:
        assert anonymous.get(path).status_code == 401, path
    assert anonymous.get("/api/health").status_code == 200
    status = anonymous.get("/api/auth/status").json()
    assert status == {"set_up": True, "signed_in": False, "min_length": 6, "user": None}


def test_every_api_route_is_protected():
    """Guard against a new router being added without the sign-in check."""
    open_paths = {"/api/health", "/api/auth/status", "/api/auth/signup", "/api/auth/login", "/api/auth/logout",
                  "/api/auth/change-password"}
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api/") or path in open_paths:
            continue
        guards = [d.call.__name__ for d in route.dependant.dependencies]
        assert "require_login" in guards, path
        if path.startswith("/api/admin/"):
            assert "require_admin" in guards, path


def test_sign_in_out_and_wrong_password(client, anonymous):
    assert anonymous.post("/api/auth/login", json={**ME, "password": "wrong"}).status_code == 401
    assert anonymous.post("/api/auth/login", json={"username": "nobody", "password": "test-password"}).status_code == 401
    ok = anonymous.post("/api/auth/login", json={"username": " Tester ", "password": "test-password", "remember": True})
    assert ok.status_code == 200                                      # the username is not case-sensitive
    cookie = ok.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "max-age=" in cookie
    assert anonymous.get("/api/months").status_code == 200
    assert anonymous.get("/api/auth/status").json()["user"] == {"username": "tester", "is_admin": True}
    anonymous.post("/api/auth/logout")
    assert anonymous.get("/api/months").status_code == 401


def test_too_many_wrong_passwords_pauses_sign_in(anonymous):
    for _ in range(4):
        assert anonymous.post("/api/auth/login", json={**ME, "password": "nope"}).status_code == 401
    assert anonymous.post("/api/auth/login", json={**ME, "password": "nope"}).status_code == 429
    # even the right password waits during the pause
    assert anonymous.post("/api/auth/login", json=ME).status_code == 429
    # the pause is for that username only: nobody can lock everyone else out
    assert anonymous.post("/api/auth/login", json={"username": "other", "password": "nope"}).status_code == 401


def test_change_password_signs_out_other_browsers(client, anonymous):
    anonymous.post("/api/auth/login", json=ME)
    assert anonymous.get("/api/months").status_code == 200
    short = client.post("/api/auth/change-password", json={"current": "test-password", "new": "12345"})
    assert short.status_code == 422                                   # at least 6 characters
    wrong = client.post("/api/auth/change-password", json={"current": "nope", "new": "new-password"})
    assert wrong.status_code == 401
    assert client.post("/api/auth/change-password",
                       json={"current": "test-password", "new": "new-password"}).status_code == 200
    assert client.get("/api/months").status_code == 200              # this browser stays signed in
    assert anonymous.get("/api/months").status_code == 401           # the other one is signed out
    assert anonymous.post("/api/auth/login", json={**ME, "password": "new-password"}).status_code == 200


# ---- accounts, each with its own database file ---------------------------------------

def _signed_up(username: str, password: str = "a-password") -> TestClient:
    browser = TestClient(app)
    made = browser.post("/api/auth/signup", json={"username": username, "password": password})
    assert made.status_code == 200, made.text
    return browser


def test_sign_up_rules(real_files):
    anonymous = TestClient(app)
    assert anonymous.get("/api/auth/status").json()["set_up"] is False
    assert anonymous.post("/api/auth/signup", json={"username": "ab", "password": "a-password"}).status_code == 422
    assert anonymous.post("/api/auth/signup", json={"username": "has space", "password": "a-password"}).status_code == 422
    assert anonymous.post("/api/auth/signup", json={"username": "amina", "password": "short"}).status_code == 422
    _signed_up("Amina")
    assert anonymous.get("/api/auth/status").json()["set_up"] is True
    taken = anonymous.post("/api/auth/signup", json={"username": "amina", "password": "a-password"})
    assert taken.status_code == 409
    assert anonymous.post("/api/auth/login", json={"username": "amina", "password": "a-password"}).status_code == 200


def test_each_account_has_its_own_sample_data(real_files):
    amina, brian = _signed_up("amina"), _signed_up("brian")
    assert amina.get("/api/auth/status").json()["user"] == {"username": "amina", "is_admin": True}   # the first is the owner
    assert brian.get("/api/auth/status").json()["user"] == {"username": "brian", "is_admin": False}

    # both start from the same sample plan, projects and income sources
    assert len(brian.get("/api/months").json()) == 1
    assert len(brian.get("/api/goals").json()) > 0
    assert len(brian.get("/api/income-sources").json()) > 0

    # what one changes, the other never sees
    before = brian.get("/api/recipients").json()
    assert amina.post("/api/recipients", json={"name": "Amina's landlord"}).status_code in (200, 201)
    assert "Amina's landlord" in [r["name"] for r in amina.get("/api/recipients").json()]
    assert brian.get("/api/recipients").json() == before
    assert len(list(real_files.glob("user-*.db"))) == 2


def test_a_new_account_starts_clean(real_files, monkeypatch):
    from conftest import REAL_STARTER
    monkeypatch.setattr("app.seed.STARTER", REAL_STARTER)
    amina = _signed_up("amina")

    # a short plan with nothing budgeted yet, and one core saving line to fill in
    month_id = amina.get("/api/months").json()[0]["id"]
    month = amina.get(f"/api/months/{month_id}").json()
    assert 0 < len(month["lines"]) < 15
    assert all(Decimal(l["planned"]) == 0 for l in month["lines"])
    assert [l["name"] for l in month["lines"] if l["is_core"]] == ["Core saving"]

    # no projects, no debts, and nothing expected from the income sources
    assert amina.get("/api/goals").json()["goals"] == []
    assert amina.get("/api/debts").json()["debts"] == []
    income = amina.get(f"/api/months/{month_id}/income").json()
    assert len(income["sources"]) == 2 and income["arrivals"] == []
    assert Decimal(income["summary"]["arrived"]["NTD"]) == 0

    # it opens on the set-up guide until that is finished
    assert amina.get("/api/settings/setup").json() == {"pending": True}
    assert amina.put("/api/settings/setup", json={"pending": False}).json() == {"pending": False}
    assert amina.get("/api/settings/setup").json() == {"pending": False}

    # every screen opens on the empty plan
    for path in ("income", "sends", "review"):
        assert amina.get(f"/api/months/{month_id}/{path}").status_code == 200, path
    assert amina.get("/api/history").status_code == 200


def test_only_the_owner_manages_accounts(real_files):
    amina, brian = _signed_up("amina"), _signed_up("brian")
    assert brian.get("/api/admin/accounts").status_code == 403
    accounts = amina.get("/api/admin/accounts").json()
    assert [(a["username"], a["is_admin"]) for a in accounts] == [("amina", True), ("brian", False)]
    brian_id, amina_id = accounts[1]["id"], accounts[0]["id"]

    # a forgotten password: the owner sets a new one, and the old sessions end
    assert amina.post(f"/api/admin/accounts/{brian_id}/password", json={"new": "fresh-password"}).status_code == 200
    assert brian.get("/api/months").status_code == 401
    assert brian.post("/api/auth/login", json={"username": "brian", "password": "fresh-password"}).status_code == 200

    assert amina.delete(f"/api/admin/accounts/{amina_id}").status_code == 409       # not your own
    assert brian.delete(f"/api/admin/accounts/{amina_id}").status_code == 403
    assert amina.delete(f"/api/admin/accounts/{brian_id}").status_code == 200
    assert brian.get("/api/months").status_code == 401
    assert brian.post("/api/auth/login", json={"username": "brian", "password": "fresh-password"}).status_code == 401
    assert len(list(real_files.glob("user-*.db"))) == 1                             # the owner's
    assert len(list((real_files / "removed").glob("*-brian-user-*.db"))) == 1       # kept, not destroyed


def test_budget_from_before_accounts_goes_to_the_owner(real_files):
    """The single-password database becomes the 'admin' account, with the same password and data."""
    legacy = real_files / LEGACY_DB
    migrate(engine_for(legacy))
    con = sqlite3.connect(legacy)
    con.execute("INSERT INTO currency (code, name) VALUES ('KES', 'Kenyan Shilling'), ('NTD', 'New Taiwan Dollar')")
    con.execute("INSERT INTO recipient (name, active, sort_order) VALUES ('My real landlord', 1, 1)")
    con.execute("INSERT INTO app_setting (key, value) VALUES ('password_hash', ?)", (hash_password("old-password"),))
    con.commit()
    con.close()

    start_up()
    start_up()  # starting again changes nothing

    owner = TestClient(app)
    assert owner.post("/api/auth/login", json={"username": "admin", "password": "old-password"}).status_code == 200
    assert owner.get("/api/auth/status").json()["user"] == {"username": "admin", "is_admin": True}
    assert [r["name"] for r in owner.get("/api/recipients").json()] == ["My real landlord"]
    assert [a["username"] for a in owner.get("/api/admin/accounts").json()] == ["admin"]

    con = sqlite3.connect(legacy)
    assert con.execute("SELECT count(*) FROM app_setting WHERE key = 'password_hash'").fetchone()[0] == 0
    con.close()

    newcomer = _signed_up("brian")                                    # gets sample data, not the owner's
    assert newcomer.get("/api/auth/status").json()["user"]["is_admin"] is False
    assert "My real landlord" not in [r["name"] for r in newcomer.get("/api/recipients").json()]


def test_countries_and_currencies_can_be_chosen(real_files, monkeypatch):
    from conftest import REAL_STARTER
    monkeypatch.setattr("app.seed.STARTER", REAL_STARTER)
    amina = _signed_up("amina")
    assert amina.get("/api/meta").json()["profile"] == {
        "residence_country": "Taiwan", "residence_currency": "NTD", "home_country": "Kenya", "home_currency": "KES"}

    same = {"residence_country": "Uganda", "residence_currency": "UGX", "home_country": "uganda", "home_currency": "UGX"}
    assert amina.put("/api/settings/profile", json=same).status_code == 422
    chosen = {"residence_country": "Germany", "residence_currency": "EUR", "home_country": "Uganda", "home_currency": "UGX"}
    assert amina.put("/api/settings/profile", json=chosen).json() == chosen

    # what was named after the old countries follows; the sums underneath do not change
    meta = amina.get("/api/meta").json()
    assert meta["profile"] == chosen
    assert [l["name"] for l in meta["locations"]] == ["Germany", "Uganda"]
    assert [a["name"] for a in meta["accounts"]] == ["Germany bank account", "Uganda bank account", "Mobile money"]
    assert {r["usual_method"] for r in amina.get("/api/recipients").json()} == {"Mobile money", "Bank transfer"}

    # the two can swap, and Kenya gets M-Pesa back
    back = {"residence_country": "Uganda", "residence_currency": "UGX", "home_country": "Kenya", "home_currency": "KES"}
    assert amina.put("/api/settings/profile", json=back).status_code == 200
    meta = amina.get("/api/meta").json()
    assert [l["name"] for l in meta["locations"]] == ["Uganda", "Kenya"]
    assert meta["accounts"][2]["name"] == "M-Pesa"


def test_todays_rate_is_only_a_suggestion(real_files, monkeypatch):
    import app.profile as profile
    amina = _signed_up("amina")
    asked = []

    def rates(code):
        asked.append(code)
        return {"rates": {"KES": 3.944686}, "time_last_update_utc": "Tue, 17 Nov 2026 00:02:31 +0000"}

    monkeypatch.setattr(profile, "_fetch_rates", rates)
    got = amina.get("/api/fx-rate").json()
    assert (got["base"], got["quote"], got["rate"]) == ("NTD", "KES", "3.9447")
    assert asked == ["TWD"]            # the service knows the Taiwan dollar as TWD

    def offline(code):
        raise OSError("no network")

    monkeypatch.setattr(profile, "_fetch_rates", offline)
    assert amina.get("/api/fx-rate").status_code == 503
