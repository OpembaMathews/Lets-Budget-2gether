"""Phase 3 checks: sends in parts, spreading by section, still to send."""
from decimal import Decimal

import pytest

from app.models import Month
from app.seed import seed_recipients_if_missing

D = Decimal


@pytest.fixture()
def api(client, session_factory):
    with session_factory() as session:
        seed_recipients_if_missing(session)
    return client


def mid(api):
    return api.get("/api/months").json()[0]["id"]


def view(api):
    return api.get(f"/api/months/{mid(api)}/sends").json()


def recipient(api, name):
    return next(r["id"] for r in view(api)["recipients"] if r["name"] == name)


def group(api, name):
    return next(g for g in view(api)["groups"] if g["name"] == name)


def line(api, group_name, line_name):
    return next(l for l in group(api, group_name)["lines"] if l["name"] == line_name)


def send(api, who, amount, purposes, day="2026-11-06", **extra):
    return api.post(f"/api/months/{mid(api)}/sends", json={
        "sent_date": day, "recipient_id": recipient(api, who), "amount_kes": amount,
        "purposes": purposes, **extra})


def test_kenya_view_shows_only_kes_sections_with_usual_recipients(api):
    v = view(api)
    names = [g["name"] for g in v["groups"]]
    assert names == ["Household", "Utilities & Giving", "Parents", "School", "Savings", "My Savings"]
    assert all(g["location_name"] == "Kenya" for g in v["groups"])
    assert v["totals"]["planned"] == "42100.00"
    # no income yet, so nothing is ready to send; the whole budget is waiting
    assert v["totals"]["to_send"] == "0.00"
    assert v["totals"]["remaining"] == v["totals"]["waiting"] == "42100.00"
    assert group(api, "Parents")["usual_recipient_id"] == recipient(api, "Parent")
    # the core saving has a section of its own that goes to the user's own account
    my = group(api, "My Savings")
    assert my["usual_recipient_id"] == recipient(api, "Me – Bank")
    assert [l["name"] for l in my["lines"]] == ["Core saving"] and my["lines"][0]["is_core"]
    assert group(api, "Savings")["usual_recipient_id"] == recipient(api, "Partner")


def test_the_example_from_the_design(api):
    """15,000 to the partner (10,000 Household, 5,000 School), then 2,000 to a parent."""
    first = send(api, "Partner", "15000", [
        {"group_id": group(api, "Household")["group_id"], "amount": "10000"},
        {"group_id": group(api, "School")["group_id"], "amount": "5000"},
    ])
    assert first.status_code == 201
    second = send(api, "Parent", "2000", [{"group_id": group(api, "Parents")["group_id"], "amount": "2000"}],
                  day="2026-11-07")
    assert second.status_code == 201

    parents, school, household = group(api, "Parents"), group(api, "School"), group(api, "Household")
    assert (parents["sent"], parents["remaining"]) == ("2000.00", "200.00")
    assert (school["sent"], school["remaining"]) == ("5000.00", "1000.00")
    assert (household["sent"], household["planned"]) == ("10000.00", "16900.00")

    # a section amount fills lines in plan order: 3,000 + 2,000 + 800 + 3,500 = 9,300, then 700 of cooking fuel
    household_lines = {l["name"]: l["sent"] for l in household["lines"]}
    assert household_lines["Groceries"] == "3000.00"
    assert household_lines["Toiletries"] == "800.00"
    assert household_lines["Weekly food"] == "3500.00"
    assert household_lines["Cooking fuel"] == "700.00"
    assert household_lines["Personal care"] == "0.00"

    totals = view(api)["totals"]
    assert totals["sent"] == "17000.00"
    assert totals["unassigned"] == "0.00"
    assert totals["count"] == 2
    per = {r["name"]: r["amount_kes"] for r in view(api)["per_recipient"]}
    assert per == {"Partner": "15000.00", "Parent": "2000.00"}


def test_a_second_send_continues_where_the_first_stopped(api):
    household = group(api, "Household")["group_id"]
    send(api, "Partner", "6000", [{"group_id": household, "amount": "6000"}])
    send(api, "Partner", "3000", [{"group_id": household, "amount": "3000"}], day="2026-11-12")
    lines = {l["name"]: l["sent"] for l in group(api, "Household")["lines"]}
    # first send: 3,000 + 2,000 + 800 + 200 of weekly food; second: 3,000 more weekly food
    assert lines["Weekly food"] == "3200.00"
    assert lines["Cooking fuel"] == "0.00"


def test_lines_can_be_chosen_one_by_one_and_mixed_with_sections(api):
    fees = line(api, "School", "School Fees")["id"]
    obligations = line(api, "Utilities & Giving", "Family support")["id"]
    ok = send(api, "School", "2500", [{"budget_line_id": fees, "amount": "2500"}])
    assert ok.status_code == 201
    send(api, "Partner", "7000", [
        {"budget_line_id": obligations, "amount": "6000"},
        {"group_id": group(api, "Utilities & Giving")["group_id"], "amount": "1000"},
    ])
    util = {l["name"]: l["sent"] for l in group(api, "Utilities & Giving")["lines"]}
    assert util == {"Data & Airtime": "1000.00", "Family support": "6000.00", "Giving / charity": "0.00"}
    assert line(api, "School", "School Fees")["remaining"] == "0.00"


def test_unassigned_money_is_kept_visible_and_can_be_sorted_later(api):
    created = send(api, "Partner", "5000", [{"group_id": group(api, "Household")["group_id"], "amount": "3000"}]).json()
    assert created["totals"]["unassigned"] == "2000.00"
    row = created["sends"][0]
    assert row["assigned"] == "3000.00" and row["unassigned"] == "2000.00"

    # editing the send replaces its purposes, so nothing is counted twice
    fixed = api.put(f"/api/sends/{row['id']}", json={
        "sent_date": "2026-11-06", "recipient_id": recipient(api, "Partner"), "amount_kes": "5000",
        "purposes": [{"group_id": group(api, "Household")["group_id"], "amount": "5000"}],
    })
    assert fixed.status_code == 200
    assert fixed.json()["totals"]["unassigned"] == "0.00"
    assert group(api, "Household")["sent"] == "5000.00"


def test_purposes_cannot_add_up_to_more_than_the_send(api):
    bad = send(api, "Partner", "1000", [{"group_id": group(api, "Household")["group_id"], "amount": "1000.01"}])
    assert bad.status_code == 422
    assert view(api)["totals"]["count"] == 0


def test_ntd_lines_and_bad_purposes_are_rejected(api):
    months = api.get(f"/api/months/{mid(api)}").json()
    ntd_line = next(l for l in months["lines"] if l["currency_code"] == "NTD")
    assert send(api, "Partner", "100", [{"budget_line_id": ntd_line["id"], "amount": "100"}]).status_code == 422
    both = [{"budget_line_id": ntd_line["id"], "group_id": 1, "amount": "100"}]
    assert send(api, "Partner", "100", both).status_code == 422


def test_more_than_a_section_needs_shows_as_over_sent(api):
    parents = group(api, "Parents")["group_id"]
    send(api, "Parent", "2700", [{"group_id": parents, "amount": "2700"}])   # the section needs 2,200
    g = group(api, "Parents")
    assert g["sent"] == "2700.00" and g["to_send"] == "0.00" and g["over"] == "500.00"


def test_effective_rate_and_fees(api):
    v = send(api, "Partner", "4100", [], amount_ntd="1000", fee_ntd="25", platform="Wise").json()
    row = v["sends"][0]
    assert row["rate"] == "4.1000"
    assert row["platform"] == "Wise"
    assert v["totals"]["average_rate"] == "4.1000"
    assert v["totals"]["fees_ntd"] == "25.00"
    too_big_fee = send(api, "Partner", "100", [], amount_ntd="10", fee_ntd="11")
    assert too_big_fee.status_code == 422


def test_deleting_a_send_and_closed_months(api, session_factory):
    created = send(api, "Partner", "1000", [{"group_id": group(api, "Household")["group_id"], "amount": "1000"}]).json()
    send_id = created["sends"][0]["id"]
    assert api.delete(f"/api/sends/{send_id}").json()["totals"]["sent"] == "0.00"

    keep = send(api, "Partner", "1000", []).json()["sends"][0]["id"]
    with session_factory() as session:
        session.get(Month, mid(api)).status = "closed"
        session.commit()
    assert send(api, "Partner", "500", []).status_code == 409
    assert api.delete(f"/api/sends/{keep}").status_code == 409


def test_recipient_with_sends_cannot_be_deleted(api):
    send(api, "Chama", "500", [])
    assert api.delete(f"/api/recipients/{recipient(api, 'Chama')}").status_code == 409
    new = api.post("/api/recipients", json={"name": "Brother"}).json()["id"]
    assert api.delete(f"/api/recipients/{new}").status_code == 204


def test_section_usual_recipient_can_be_changed_and_cleared(api):
    gid = group(api, "Savings")["group_id"]
    chama = recipient(api, "Chama")
    assert api.patch(f"/api/groups/{gid}", json={"usual_recipient_id": chama}).json()["usual_recipient_id"] == chama
    assert api.patch(f"/api/groups/{gid}", json={"usual_recipient_id": None}).json()["usual_recipient_id"] is None


# ---- only cash set aside from income is "ready to send" ---------------------------

def pay(api, amount):
    from app.seed import seed_income_if_missing  # noqa: F401  (sources come with the fixture below)
    m = mid(api)
    src = next(s for s in api.get(f"/api/months/{m}/income").json()["sources"] if s["name"] == "Main job")
    api.post(f"/api/months/{m}/arrivals", json={"source_id": src["id"], "amount": amount, "received_date": "2026-11-05"})


@pytest.fixture()
def paid(api, session_factory):
    from app.seed import seed_income_if_missing
    with session_factory() as session:
        seed_income_if_missing(session)
    return api


def test_ready_to_send_is_the_cash_set_aside_not_the_budget(paid):
    api = paid
    pay(api, "12000")   # bills first: Taiwan bills, then Kenya essentials as far as it goes
    v = view(api)
    household = group(api, "Household")
    groceries = next(l for l in household["lines"] if l["name"] == "Groceries")
    assert groceries["to_send"] == groceries["set_aside"] == "3000.00"
    # a flexible Kenya line got no income yet: nothing to send, its budget is waiting
    care = next(l for l in household["lines"] if l["name"] == "Personal care")
    assert (care["set_aside"], care["to_send"], care["waiting"]) == ("0.00", "0.00", "600.00")
    assert D(v["totals"]["to_send"]) == D(v["totals"]["set_aside"])
    assert D(v["totals"]["to_send"]) < D(v["totals"]["planned"])

    # sending the cash for groceries leaves nothing ready on that line
    send(api, "Partner", "3000", [{"budget_line_id": groceries["id"], "amount": "3000"}])
    groceries = next(l for l in group(api, "Household")["lines"] if l["name"] == "Groceries")
    assert groceries["to_send"] == "0.00" and groceries["sent"] == "3000.00"


def test_a_section_send_covers_ready_cash_first(paid):
    api = paid
    pay(api, "12000")
    household = group(api, "Household")
    ready = {l["name"]: D(l["to_send"]) for l in household["lines"]}
    total_ready = sum(ready.values())
    created = send(api, "Partner", str(total_ready), [{"group_id": household["group_id"], "amount": str(total_ready)}]).json()
    sent = {l["name"]: D(l["sent"]) for l in group(api, "Household")["lines"]}
    # exactly the ready cash went to each line, so flexible lines with no income got nothing
    assert sent == ready
    assert created["totals"]["unassigned"] == "0.00"


def test_an_actual_typed_on_the_plan_limits_what_is_sent(paid):
    """Cereals typed as 1,500 (budget 2,000): only 1,500 is offered for sending."""
    api = paid
    pay(api, "12000")
    cereals = next(l for l in group(api, "Household")["lines"] if l["name"] == "Cereals")
    assert cereals["to_send"] == "2000.00"
    api.patch(f"/api/lines/{cereals['id']}", json={"actual": "1500"})
    cereals = next(l for l in group(api, "Household")["lines"] if l["name"] == "Cereals")
    assert (cereals["actual"], cereals["to_send"], cereals["remaining"]) == ("1500.00", "1500.00", "1500.00")

    # a section send fills the typed actual, not the old budget
    household = group(api, "Household")
    ready = {l["name"]: D(l["to_send"]) for l in household["lines"]}
    total = sum(ready.values())
    send(api, "Partner", str(total), [{"group_id": household["group_id"], "amount": str(total)}])
    sent = {l["name"]: D(l["sent"]) for l in group(api, "Household")["lines"]}
    assert sent["Cereals"] == D("1500")
    assert sent == ready


def test_a_line_can_go_to_someone_other_than_its_section(api):
    """A line can go straight to someone else, e.g. family support sent directly to a relative."""
    dad = api.post("/api/recipients", json={"name": "Dad"}).json()["id"]
    obligations = line(api, "Utilities & Giving", "Family support")
    assert obligations["recipient_id"] == recipient(api, "Partner") and obligations["own_recipient"] is False

    api.patch(f"/api/lines/{obligations['id']}", json={"recipient_id": dad})
    obligations = line(api, "Utilities & Giving", "Family support")
    assert obligations["recipient_id"] == dad and obligations["own_recipient"] is True
    # the rest of the section still goes to the section's usual recipient
    assert line(api, "Utilities & Giving", "Data & Airtime")["recipient_id"] == recipient(api, "Partner")

    # clearing it goes back to the section's recipient
    api.patch(f"/api/lines/{obligations['id']}", json={"recipient_id": None})
    assert line(api, "Utilities & Giving", "Family support")["own_recipient"] is False

    # set again, it is carried into the next month
    api.patch(f"/api/lines/{obligations['id']}", json={"recipient_id": dad})
    m = api.get(f"/api/months/{mid(api)}").json()
    nxt = api.post("/api/months", json={"year": m["year"] + 1, "month": 1}).json()
    copied = next(l for l in nxt["lines"] if l["name"] == "Family support")
    assert copied["recipient_id"] == dad
