"""Sign-in: one password, sessions in an HttpOnly cookie, every data route protected."""
from app.auth import check_password, hash_password
from app.main import app

DATA_ROUTES = ["/api/meta", "/api/months", "/api/goals", "/api/debts", "/api/history", "/api/recipients",
               "/api/income-sources", "/api/settings/split-order"]


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
    assert status == {"set_up": True, "signed_in": False, "min_length": 6}


def test_every_api_route_is_protected():
    """Guard against a new router being added without the sign-in check."""
    open_paths = {"/api/health", "/api/auth/status", "/api/auth/setup", "/api/auth/login", "/api/auth/logout",
                  "/api/auth/change-password"}
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api/") or path in open_paths:
            continue
        guards = [d.call.__name__ for d in route.dependant.dependencies]
        assert "require_login" in guards, path


def test_sign_in_out_and_wrong_password(anonymous):
    assert anonymous.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
    ok = anonymous.post("/api/auth/login", json={"password": "test-password", "remember": True})
    assert ok.status_code == 200
    cookie = ok.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "max-age=" in cookie
    assert anonymous.get("/api/months").status_code == 200
    anonymous.post("/api/auth/logout")
    assert anonymous.get("/api/months").status_code == 401


def test_setup_only_once(anonymous):
    assert anonymous.post("/api/auth/setup", json={"password": "another one"}).status_code == 409


def test_too_many_wrong_passwords_pauses_sign_in(anonymous):
    for _ in range(4):
        assert anonymous.post("/api/auth/login", json={"password": "nope"}).status_code == 401
    assert anonymous.post("/api/auth/login", json={"password": "nope"}).status_code == 429
    # even the right password waits during the pause
    assert anonymous.post("/api/auth/login", json={"password": "test-password"}).status_code == 429


def test_change_password_signs_out_other_browsers(client, anonymous):
    anonymous.post("/api/auth/login", json={"password": "test-password"})
    assert anonymous.get("/api/months").status_code == 200
    short = client.post("/api/auth/change-password", json={"current": "test-password", "new": "12345"})
    assert short.status_code == 422                                   # at least 6 characters
    wrong = client.post("/api/auth/change-password", json={"current": "nope", "new": "new-password"})
    assert wrong.status_code == 401
    assert client.post("/api/auth/change-password",
                       json={"current": "test-password", "new": "new-password"}).status_code == 200
    assert client.get("/api/months").status_code == 200              # this browser stays signed in
    assert anonymous.get("/api/months").status_code == 401           # the other one is signed out
    assert anonymous.post("/api/auth/login", json={"password": "new-password"}).status_code == 200
