"""Phase 4 and debts: review, balance check, close and reopen, history, compare, export,
debts, and extra savings shared to goals."""
import io
from decimal import Decimal

import pytest

from app.seed import seed_goals_if_missing, seed_income_if_missing, seed_recipients_if_missing

D = Decimal


@pytest.fixture()
def api(client, session_factory):
    with session_factory() as session:
        seed_income_if_missing(session)
        seed_recipients_if_missing(session)
        seed_goals_if_missing(session)
    return client


def first_month(api):
    months = api.get("/api/months").json()
    return min(months, key=lambda m: (m["year"], m["month"]))


def pay(api, month_id, name, amount, day="2026-11-05"):
    src = next(s for s in api.get(f"/api/months/{month_id}/income").json()["sources"] if s["name"] == name)
    return api.post(f"/api/months/{month_id}/arrivals",
                    json={"source_id": src["id"], "amount": amount, "received_date": day})


def line(api, month_id, name, currency=None):
    return next(l for l in api.get(f"/api/months/{month_id}").json()["lines"]
                if l["name"] == name and (currency is None or l["currency_code"] == currency))


# ---- review ----------------------------------------------------------------------

def test_review_lists_what_needs_attention(api):
    mid = first_month(api)["id"]
    pay(api, mid, "Main job", "12000")
    shop = line(api, mid, "Weekly shop")
    api.patch(f"/api/lines/{shop['id']}", json={"actual": "4500"})   # budget 4,000
    r = api.get(f"/api/months/{mid}/review").json()
    assert [x["name"] for x in r["checks"]["over_budget"]] == ["Weekly shop"]
    assert r["checks"]["ready_to_send"]                                # Kenya cash set aside, not sent
    assert any(u["name"] == "Part-time job" for u in r["checks"]["income_not_arrived"])
    assert r["figures"]["income"]["native"] == {"NTD": "12000.00"}
    assert D(r["figures"]["budget"]["KES"]) > 0


def test_balance_check_compares_with_last_month(api):
    nov = first_month(api)
    accounts = {a["name"]: a["id"] for a in api.get("/api/meta").json()["accounts"]}
    taiwan = accounts["Taiwan bank account"]
    # first month: the balances are just the starting point
    r = api.put(f"/api/months/{nov['id']}/balances", json={"account_id": taiwan, "actual_balance": "5000"}).json()
    assert r["balances"]["has_previous"] is False
    assert r["balances"]["currencies"][0]["expected"] is None

    dec = api.post("/api/months", json={"year": nov["year"], "month": nov["month"] + 1}).json()
    api.post(f"/api/months/{dec['id']}/confirm-all")
    pay(api, dec["id"], "Main job", "12000", "2026-12-05")
    r = api.put(f"/api/months/{dec['id']}/balances", json={"account_id": taiwan, "actual_balance": "8000"}).json()
    ntd = next(c for c in r["balances"]["currencies"] if c["currency_code"] == "NTD")
    assert r["balances"]["has_previous"] is True
    # 5,000 at the start + 12,000 in - NTD lines given out. Bills first pays the 7,700 of Taiwan
    # essentials, then Kenya essentials; the money runs out before the Taiwan flexible lines.
    assert ntd["opening"] == "5000.00" and ntd["income"] == "12000.00" and ntd["spent"] == "7700.00"
    assert ntd["expected"] == "9300.00"
    assert ntd["difference"] == "-1300.00"


def test_closing_locks_the_month_and_reopening_needs_a_reason(api):
    mid = first_month(api)["id"]
    closed = api.post(f"/api/months/{mid}/close", json={"note": "Good month"}).json()
    assert closed["status"] == "closed" and closed["review_note"] == "Good month"
    assert "Closed" in closed["close_log"]
    # nothing in a closed month can change
    some = line(api, mid, "Transport pass")
    assert api.patch(f"/api/lines/{some['id']}", json={"planned": "1"}).status_code == 409
    assert pay(api, mid, "Main job", "100").status_code == 409
    assert api.post(f"/api/months/{mid}/close", json={}).status_code == 409

    assert api.post(f"/api/months/{mid}/reopen", json={"reason": ""}).status_code == 422
    reopened = api.post(f"/api/months/{mid}/reopen", json={"reason": "Forgot a payment"}).json()
    assert reopened["status"] == "active" and "Forgot a payment" in reopened["close_log"]
    assert pay(api, mid, "Main job", "100").status_code == 201


# ---- history and comparison -----------------------------------------------------------

def test_history_and_compare(api):
    nov = first_month(api)
    pay(api, nov["id"], "Main job", "12000")
    dec = api.post("/api/months", json={"year": nov["year"], "month": nov["month"] + 1}).json()
    shop = line(api, dec["id"], "Weekly shop")
    api.patch(f"/api/lines/{shop['id']}", json={"planned": "2500"})
    h = api.get("/api/history").json()
    assert [m["label"] for m in h["months"]] == ["November 2026", "December 2026"]
    assert h["months"][0]["income"] == {"NTD": "12000.00"} and h["months"][1]["income_kes"] == "0.00"
    assert h["years"][0]["months"] == 2

    c = api.get("/api/compare", params={"a": nov["id"], "b": dec["id"]}).json()
    row = next(l for l in c["lines"] if l["name"] == "Weekly shop")
    assert row["a"]["budget"] == "3000.00" and row["b"]["budget"] == "2500.00"
    assert row["a"]["actual"] == "3000.00" and row["b"]["actual"] == "0.00"


def test_excel_export(api):
    from openpyxl import load_workbook

    mid = first_month(api)["id"]
    pay(api, mid, "Main job", "12000")
    res = api.get(f"/api/export/month/{mid}")
    assert res.status_code == 200 and res.headers["content-type"].startswith("application/vnd.openxmlformats")
    wb = load_workbook(io.BytesIO(res.content))
    assert wb.sheetnames == ["Plan", "Income", "Kenya sends"]
    assert wb["Plan"]["A1"].value == "Location" and wb["Plan"].max_row > 20
    assert wb["Income"]["B2"].value == "Main job"
    year = api.get("/api/export/year/2026")
    assert load_workbook(io.BytesIO(year.content)).sheetnames == ["Overview", "All lines"]
    assert api.get("/api/export/year/1999").status_code == 404


# ---- debts ---------------------------------------------------------------------------

def test_debt_balance_from_repayment_lines_and_entries(api):
    mid = first_month(api)["id"]
    v = api.post("/api/debts", params={"month_id": mid}, json={
        "lender": "Fuliza", "currency_code": "KES", "starting_balance": "6000", "monthly_repayment": "2000"}).json()
    fuliza = v["debts"][0]
    assert fuliza["balance"] == "6000.00" and fuliza["months_left"] == 3
    assert v["total_kes"] == "6000.00"

    # a repayment line in the plan: its actual counts as repaid
    group_id = line(api, mid, "Groceries", "KES")["group_id"]
    rep = api.post(f"/api/months/{mid}/lines", json={
        "group_id": group_id, "name": "Fuliza repayment", "currency_code": "KES", "kind": "debt_repayment",
        "priority": "essential", "planned": "2000", "debt_id": fuliza["id"]}).json()
    api.patch(f"/api/lines/{rep['id']}", json={"actual": "2000"})
    fuliza = api.get("/api/debts", params={"month_id": mid}).json()["debts"][0]
    assert fuliza["repaid"] == "2000.00" and fuliza["balance"] == "4000.00" and fuliza["this_month"] == "2000.00"
    assert fuliza["months_left"] == 2

    # borrowing more and repaying by hand
    api.post(f"/api/debts/{fuliza['id']}/entries", params={"month_id": mid},
             json={"entry_date": "2026-11-20", "kind": "borrowed", "amount": "1500", "note": "Fuliza top-up"})
    v = api.post(f"/api/debts/{fuliza['id']}/entries", params={"month_id": mid},
                 json={"entry_date": "2026-11-25", "kind": "repaid", "amount": "500"}).json()
    fuliza = v["debts"][0]
    assert fuliza["balance"] == "5000.00"
    assert [h["what"] for h in fuliza["history"]][-2:] == ["Fuliza top-up", "Repaid"]

    # deleting the debt keeps the repayment line in the plan
    api.delete(f"/api/debts/{fuliza['id']}", params={"month_id": mid})
    assert line(api, mid, "Fuliza repayment")["debt_id"] is None


def test_a_repayment_line_is_paid_as_a_bill(api):
    mid = first_month(api)["id"]
    v = api.post("/api/debts", json={"lender": "Phone", "starting_balance": "10000"}).json()
    group_id = line(api, mid, "Groceries", "KES")["group_id"]
    api.post(f"/api/months/{mid}/lines", json={
        "group_id": group_id, "name": "Phone repayment", "currency_code": "KES", "kind": "debt_repayment",
        "priority": "essential", "planned": "2169", "debt_id": v["debts"][0]["id"]})
    a = pay(api, mid, "Main job", "30000").json()["arrivals"][0]
    names = [x["line_name"] for x in a["allocations"] if x["kind"] == "essential"]
    assert "Phone repayment" in names


# ---- extra savings shared to goals ------------------------------------------------------

def test_extra_savings_go_to_goals_in_priority_order(api):
    mid = first_month(api)["id"]
    pay(api, mid, "Main job", "30000")     # bills, then 20% = 6,000 NTD extra savings
    v = api.get("/api/goals", params={"month_id": mid}).json()
    open_goals = [g for g in v["goals"] if g["status"] in ("planning", "active", "on_hold")]
    first = open_goals[0]                          # Emergency Fund (Kenya): KES 3,000 a month
    assert first["from_savings"] == "3000.00"
    assert first["history"][-1]["source"] == "Extra savings"
    total_shared = sum(D(g["from_savings"]) for g in open_goals if g["currency_code"] == "KES")
    assert D(v["savings_shared_kes"]) >= total_shared
    # every goal gets at most its monthly amount
    for g in open_goals:
        if g["monthly_amount"]:
            assert D(g["from_savings"]) <= D(g["monthly_amount"])
