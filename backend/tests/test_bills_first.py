"""Bills first (the default): the first money in pays every KE and TW bill before any saving."""
from decimal import Decimal

import pytest

from app.seed import seed_goals_if_missing, seed_income_if_missing

D = Decimal


@pytest.fixture()
def api(client, session_factory):
    with session_factory() as session:
        seed_income_if_missing(session)
        seed_goals_if_missing(session)
    return client


def month(api):
    mid = api.get("/api/months").json()[0]["id"]
    return api.get(f"/api/months/{mid}").json()


def pay(api, name, amount, day):
    m = month(api)
    api.post(f"/api/months/{m['id']}/activate", json={})
    src = next(s for s in api.get(f"/api/months/{m['id']}/income").json()["sources"] if s["name"] == name)
    return api.post(f"/api/months/{m['id']}/arrivals",
                    json={"source_id": src["id"], "amount": amount, "received_date": day}).json()


def kinds(arrival):
    out = {}
    for x in arrival["allocations"]:
        out[x["kind"]] = out.get(x["kind"], D("0")) + D(x["amount"])
    return out


def bills_left_kes(api):
    m = month(api)
    rate = D(m["fx_rate_ntd_kes"])
    left = D("0")
    for l in m["lines"]:
        if l["is_core"] or l["goal_id"] is not None:
            continue
        covered = D(api.get(f"/api/months/{m['id']}/income").json()["coverage"].get(str(l["id"]), "0"))
        gap = D(l["planned"]) - covered
        left += gap if l["currency_code"] == "KES" else gap * rate
    return left


def test_bills_first_is_the_default(api):
    assert api.get("/api/settings/split-order").json() == {"order": "bills_first"}


def test_the_first_payment_goes_to_bills_before_any_saving(api):
    v = pay(api, "Main job", "12000", "2026-11-05")
    first = v["arrivals"][0]
    k = kinds(first)
    # bills come to more than 12,000 NTD, so all of it pays bills and nothing is saved yet
    assert set(k) <= {"essential", "flexible"}
    assert sum(k.values()) == D("12000.00")
    # Taiwan and Kenya bills are both paid, essentials before flexible
    names = [x["line_name"] for x in first["allocations"]]
    assert "Transport pass" in names and "Groceries" in names
    assert "Core saving" not in names


def test_savings_come_from_what_is_left_after_bills(api):
    pay(api, "Main job", "12000", "2026-11-05")
    v = pay(api, "Part-time job", "16000", "2026-11-20")
    second = next(a for a in v["arrivals"] if a["source_name"] == "Part-time job")
    k = kinds(second)
    assert bills_left_kes(api) == D("0")                 # every bill is covered now
    assert k["core_saving"] == D("1500.00")              # KES 6,000 at 4, after the bills
    assert k["savings"] == D("3200.00")                  # 20% of 16,000
    assert sum(k.values()) == D("16000.00")
    # the core saving was taken once, and only by the second payment
    first = next(a for a in v["arrivals"] if a["source_name"] == "Main job")
    assert "core_saving" not in kinds(first)


def test_project_lines_are_funded_in_project_priority_order(api):
    m = month(api)
    goals = api.get("/api/goals", params={"month_id": m["id"]}).json()["goals"]
    land = next(g for g in goals if g["name"] == "Land savings")
    sewing = next(g for g in goals if g["name"] == "Business equipment")
    group_id = next(l for l in m["lines"] if l["currency_code"] == "KES")["group_id"]
    for g in (land, sewing):
        api.post(f"/api/months/{m['id']}/lines", json={
            "group_id": group_id, "name": g["name"], "currency_code": "KES", "kind": "saving",
            "planned": "10000", "goal_id": g["id"]})
    # land is put first, so land gets money before the sewing machine
    order = [land["id"]] + [g["id"] for g in goals if g["id"] != land["id"]]
    assert api.put("/api/goals/order", json={"ids": order}).status_code == 200

    v = pay(api, "Main job", "30000", "2026-11-05")   # bills, core and 20% leave about 2,580 NTD
    projects = [x for x in v["arrivals"][0]["allocations"] if x["kind"] == "project"]
    assert [x["line_name"] for x in projects] == ["Land savings", "Business equipment"]
    assert projects[0]["line_amount"] == "10000.00"            # land is funded in full first
    assert D(projects[1]["line_amount"]) < D("10000")          # the sewing machine gets what is left
    assert "free" not in kinds(v["arrivals"][0])
    # project money counts as saved
    assert D(v["summary"]["savings_reserved"]["NTD"]) >= sum(D(x["amount"]) for x in projects)


def test_switching_the_order_shares_out_existing_payments_again(api):
    pay(api, "Main job", "12000", "2026-11-05")
    api.put("/api/settings/split-order", json={"order": "savings_first"})
    m = month(api)
    v = api.get(f"/api/months/{m['id']}/income").json()
    k = kinds(v["arrivals"][0])
    assert k["core_saving"] == D("1500.00") and k["savings"] == D("2400.00")
    api.put("/api/settings/split-order", json={"order": "bills_first"})
    v = api.get(f"/api/months/{m['id']}/income").json()
    assert "core_saving" not in kinds(v["arrivals"][0])


def test_a_lower_actual_frees_its_cash_to_free_to_spend(api):
    """Cereals budget 2,000, actual typed as 1,500: the spare 500 becomes free to spend."""
    pay(api, "Main job", "30000", "2026-11-05")   # covers every bill, savings and leaves some free
    m = month(api)
    before = D(api.get(f"/api/months/{m['id']}/income").json()["summary"]["free"]["native"]["NTD"])
    cereals = next(l for l in m["lines"] if l["name"] == "Cereals" and l["currency_code"] == "KES")
    api.patch(f"/api/lines/{cereals['id']}", json={"actual": "1500"})
    v = api.get(f"/api/months/{m['id']}/income").json()
    after = D(v["summary"]["free"]["native"]["NTD"])
    # KES 500 at 4 KES per NTD is NTD 125 freed
    assert after - before == D("125.00")
    assert D(v["coverage"][str(cereals["id"])]) == D("1500")
    # nothing shows as unfunded because of the lower actual
    assert v["summary"]["essentials_left"]["KES"] == "0.00"

    # clearing the actual takes the cash back for the full budget
    api.patch(f"/api/lines/{cereals['id']}", json={"actual": None})
    v = api.get(f"/api/months/{m['id']}/income").json()
    assert D(v["summary"]["free"]["native"]["NTD"]) == before
