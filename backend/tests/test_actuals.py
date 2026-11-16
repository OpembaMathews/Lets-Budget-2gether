"""Budget against actual: actuals come from what was distributed, and can be typed over."""
from decimal import Decimal

import pytest

from app.seed import seed_income_if_missing, seed_recipients_if_missing

D = Decimal


@pytest.fixture()
def api(client, session_factory):
    with session_factory() as session:
        seed_income_if_missing(session)
        seed_recipients_if_missing(session)
    return client


def month(api):
    mid = api.get("/api/months").json()[0]["id"]
    return api.get(f"/api/months/{mid}").json()


def line(m, name, currency=None):
    return next(l for l in m["lines"] if l["name"] == name and (currency is None or l["currency_code"] == currency))


def actual(m, name, currency=None):
    return m["actuals"][str(line(m, name, currency)["id"])]


def start_and_pay(api, source_name, amount, day="2026-11-05"):
    m = month(api)
    api.post(f"/api/months/{m['id']}/activate", json={})
    src = next(s for s in api.get(f"/api/months/{m['id']}/income").json()["sources"] if s["name"] == source_name)
    api.post(f"/api/months/{m['id']}/arrivals", json={"source_id": src["id"], "amount": amount, "received_date": day})


def test_nothing_distributed_yet_means_actual_zero_and_full_budget_left(api):
    a = actual(month(api), "Transport pass")
    assert a == {"auto": "0.00", "actual": "0.00", "manual": False, "left": "1200.00",
                 "over": False, "set_aside_to_send": "0.00"}


def test_payment_in_the_same_currency_counts_as_actual_straight_away(api):
    start_and_pay(api, "Main job", "12000")
    m = month(api)
    tpass = actual(m, "Transport pass")  # an NTD line paid from NTD income
    assert tpass["actual"] == "1200.00" and tpass["left"] == "0.00"


def test_money_for_kenya_counts_once_it_is_sent(api):
    start_and_pay(api, "Part-time job", "30000")  # enough to cover the bills and reach the core saving
    m = month(api)
    core = actual(m, "Core saving")
    # set aside from NTD income, but not sent yet, so not actual yet
    assert core["actual"] == "0.00"
    assert core["set_aside_to_send"] == "6000.00"

    recipients = {r["name"]: r["id"] for r in api.get("/api/recipients").json()}
    api.post(f"/api/months/{m['id']}/sends", json={
        "sent_date": "2026-11-06", "recipient_id": recipients["Me – Bank"], "amount_kes": "6000",
        "purposes": [{"budget_line_id": line(m, "Core saving")["id"], "amount": "6000"}]})
    core = actual(month(api), "Core saving")
    assert core["actual"] == "6000.00" and core["left"] == "0.00" and core["set_aside_to_send"] == "0.00"


def test_sending_more_than_the_budget_shows_as_over(api):
    m = month(api)
    recipients = {r["name"]: r["id"] for r in api.get("/api/recipients").json()}
    api.post(f"/api/months/{m['id']}/sends", json={
        "sent_date": "2026-11-06", "recipient_id": recipients["Parent"], "amount_kes": "700",
        "purposes": [{"budget_line_id": line(m, "Toiletries", "KES")["id"], "amount": "700"}]})
    # the first Kenya toiletries line is the Household one (budget 800), so 700 is within budget
    a = actual(month(api), "Toiletries", "KES")
    assert a["actual"] == "700.00" and a["over"] is False


def test_an_actual_can_be_typed_over_and_cleared(api):
    m = month(api)
    fuel = line(m, "Cooking fuel")
    typed = api.patch(f"/api/lines/{fuel['id']}", json={"actual": "1800"})
    assert typed.status_code == 200
    a = actual(month(api), "Cooking fuel")
    assert a["manual"] is True and a["actual"] == "1800.00"
    assert a["over"] is True and a["left"] == "-300.00"   # budget 1,500
    # typing an actual does not change the budget
    assert line(month(api), "Cooking fuel")["planned"] == "1500.00"

    cleared = api.patch(f"/api/lines/{fuel['id']}", json={"actual": None})
    assert cleared.status_code == 200
    a = actual(month(api), "Cooking fuel")
    assert a["manual"] is False and a["actual"] == "0.00"


def test_typed_actuals_are_not_copied_into_the_next_month(api):
    m = month(api)
    api.patch(f"/api/lines/{line(m, 'Cooking fuel')['id']}", json={"actual": "1800"})
    nxt = api.post("/api/months", json={"year": m["year"] + 1, "month": 1}).json()
    fuel = line(nxt, "Cooking fuel")
    assert fuel["actual"] is None
    assert nxt["actuals"][str(fuel["id"])]["actual"] == "0.00"


def test_lowering_a_budget_after_a_payment_moves_the_money_on(api):
    """A budget lowered from 3,000 to 2,000 after a payment was split."""
    start_and_pay(api, "Main job", "12000")
    m = month(api)
    shop = line(m, "Weekly shop")
    assert actual(m, "Weekly shop")["actual"] == "3000.00"

    api.patch(f"/api/lines/{shop['id']}", json={"planned": "2000"})
    m = month(api)
    shop_actual = actual(m, "Weekly shop")
    assert shop_actual["actual"] == "2000.00" and shop_actual["over"] is False
    # the 1,000 freed went to the next lines, so nothing is over and the payment still adds up
    assert not any(a["over"] for a in m["actuals"].values())
    v = api.get(f"/api/months/{m['id']}/income").json()
    for a in v["arrivals"]:
        assert sum(D(x["amount"]) for x in a["allocations"]) == D(a["amount"])


def test_raising_a_budget_lets_payments_fund_more(api):
    start_and_pay(api, "Main job", "30000")  # more than the plan needs
    m = month(api)
    tpass = line(m, "Transport pass")
    api.patch(f"/api/lines/{tpass['id']}", json={"planned": "1500"})
    assert actual(month(api), "Transport pass")["actual"] == "1500.00"


def test_a_removed_line_frees_its_money(api):
    start_and_pay(api, "Main job", "30000")
    m = month(api)
    before = api.get(f"/api/months/{m['id']}/income").json()["summary"]["free"]["native"]["NTD"]
    books = line(m, "Books & study")
    api.delete(f"/api/lines/{books['id']}")
    after = api.get(f"/api/months/{m['id']}/income").json()["summary"]["free"]["native"]["NTD"]
    assert D(after) - D(before) == D("500.00")
