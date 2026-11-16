"""Projects and goals: funding from plan lines, sends and one-off entries; cost breakdowns; order."""
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


def month(api):
    mid = api.get("/api/months").json()[0]["id"]
    return api.get(f"/api/months/{mid}").json()


def goals(api):
    return api.get("/api/goals", params={"month_id": month(api)["id"]}).json()


def goal(view, name):
    return next(g for g in view["goals"] if g["name"] == name)


def test_sample_projects(api):
    v = goals(api)
    names = [g["name"] for g in v["goals"]]
    assert names[0] == "Emergency Fund (Kenya)"           # emergency fund first
    assert names[-2:] == ["Water tank", "New phone"]  # completed ones last
    land = goal(v, "Land savings")
    assert (land["target"], land["funded"], land["needed"]) == ("300000.00", "120000.00", "180000.00")
    assert land["percent"] == 40.0
    tank = goal(v, "Water tank")
    assert tank["spent"] == "33500.00" and len(tank["items"]) == 5
    assert v["open_count"] == 11


def test_a_linked_plan_line_counts_once_its_money_is_sent(api):
    m = month(api)
    chama_line = next(l for l in m["lines"] if l["name"] == "Chama contribution")
    chama = goal(goals(api), "Chama fund")
    assert chama_line["goal_id"] == chama["id"]
    assert chama["this_month"] == "3000.00" and chama["funded"] == "0.00"
    # at 3,000 a month the 24,000 target takes 8 months
    assert chama["months_left"] == 8

    partner = next(r["id"] for r in api.get("/api/recipients").json() if r["name"] == "Partner")
    api.post(f"/api/months/{m['id']}/sends", json={
        "sent_date": "2026-11-06", "recipient_id": partner, "amount_kes": "3000",
        "purposes": [{"budget_line_id": chama_line["id"], "amount": "3000"}]})
    chama = goal(goals(api), "Chama fund")
    assert chama["funded"] == "3000.00" and chama["needed"] == "21000.00"
    assert chama["history"][0]["source"] == "Plan: Chama contribution"


def test_a_line_in_the_other_currency_is_converted(api):
    m = month(api)
    tw = goal(goals(api), "Savings (Taiwan)")         # an NTD goal
    group_id = next(l for l in m["lines"] if l["currency_code"] == "KES")["group_id"]
    line = api.post(f"/api/months/{m['id']}/lines", json={
        "group_id": group_id, "name": "To Taiwan savings", "currency_code": "KES", "kind": "saving",
        "planned": "4000", "goal_id": tw["id"]}).json()
    api.patch(f"/api/lines/{line['id']}", json={"actual": "4000"})
    tw = goal(goals(api), "Savings (Taiwan)")
    assert tw["funded"] == "1000.00"                       # 4,000 KES at 4 KES per NTD


def test_one_off_entries_and_opening_amounts(api):
    v = goals(api)
    land = goal(v, "Land savings")
    after = api.post(f"/api/goals/{land['id']}/entries", params={"month_id": v["month"]["id"]},
                     json={"entry_date": "2026-11-20", "amount": "180000", "note": "Bonus"}).json()
    land = goal(after, "Land savings")
    assert land["funded"] == "300000.00" and land["needed"] == "0.00" and land["months_left"] == 0
    assert [h["source"] for h in land["history"]] == ["Already in", "Bonus"]
    entry_id = land["history"][1]["entry_id"]
    land = goal(api.delete(f"/api/goal-entries/{entry_id}").json(), "Land savings")
    assert land["funded"] == "120000.00"


def test_cost_breakdown_items(api):
    v = goals(api)
    sewing = goal(v, "Business equipment")
    v = api.post(f"/api/goals/{sewing['id']}/items",
                 json={"name": "Industrial sewing machine", "category": "Equipment", "estimate": "90000"}).json()
    item = goal(v, "Business equipment")["items"][0]
    v = api.patch(f"/api/goal-items/{item['id']}", json={"actual": "85000", "done": True}).json()
    sewing = goal(v, "Business equipment")
    assert (sewing["estimate"], sewing["spent"]) == ("90000.00", "85000.00")


def test_order_can_be_changed_and_completed_goals_drop_to_the_end(api):
    v = goals(api)
    second = v["goals"][1]
    v = api.post(f"/api/goals/{second['id']}/move", json={"direction": "up"}).json()
    assert v["goals"][0]["id"] == second["id"]
    v = api.patch(f"/api/goals/{second['id']}", json={"status": "completed"}).json()
    assert v["goals"][v["open_count"]]["id"] == second["id"]   # first of the closed ones


def test_new_project_and_deleting_keeps_the_plan_line(api):
    m = month(api)
    v = api.post("/api/goals", json={"name": "Water tank", "target": "25000", "monthly_amount": "5000"}).json()
    tank = goal(v, "Water tank")
    assert tank["months_left"] == 5 and tank["finish"] is not None
    group_id = next(l for l in m["lines"] if l["currency_code"] == "KES")["group_id"]
    line = api.post(f"/api/months/{m['id']}/lines", json={
        "group_id": group_id, "name": "Water tank", "currency_code": "KES", "kind": "saving",
        "planned": "5000", "goal_id": tank["id"]}).json()
    api.delete(f"/api/goals/{tank['id']}")
    kept = next(l for l in month(api)["lines"] if l["id"] == line["id"])
    assert kept["goal_id"] is None and kept["planned"] == "5000.00"


def test_linked_goal_is_copied_into_the_next_month(api):
    m = month(api)
    nxt = api.post("/api/months", json={"year": m["year"] + 1, "month": 1}).json()
    chama_line = next(l for l in nxt["lines"] if l["name"] == "Chama contribution")
    assert chama_line["goal_id"] is not None
