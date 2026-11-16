"""Phase 2 checks: plan fit, core saving, the split of each payment."""
from decimal import Decimal

import pytest

from app.seed import seed_income_if_missing

D = Decimal


@pytest.fixture()
def api(client, session_factory):
    """Client with the starting plan and income sources, sharing money out savings first.

    These tests cover the savings-first order. Bills first, the default, is
    covered in tests/test_bills_first.py.
    """
    with session_factory() as session:
        seed_income_if_missing(session)
    assert client.put("/api/settings/split-order", json={"order": "savings_first"}).status_code == 200
    return client


def month_id(api):
    return api.get("/api/months").json()[0]["id"]


def view(api):
    return api.get(f"/api/months/{month_id(api)}/income").json()


def source(api, name):
    return next(s for s in view(api)["sources"] if s["name"] == name)


def start(api, **body):
    return api.post(f"/api/months/{month_id(api)}/activate", json=body)


def pay(api, name, amount, day="2026-11-05"):
    return api.post(f"/api/months/{month_id(api)}/arrivals", json={
        "source_id": source(api, name)["id"], "amount": amount, "received_date": day})


def pending(v):
    """The payment recorded last. Payments are saved straight away, so it is confirmed."""
    newest = max(v["arrivals"], key=lambda a: a["id"])
    assert newest["confirmed"] is True
    return newest


def by_kind(arrival, kind):
    return sum((D(a["amount"]) for a in arrival["allocations"] if a["kind"] == kind), D("0"))


# ---- fit check --------------------------------------------------------------

def test_fit_counts_only_reliable_income(api):
    fit = view(api)["fit"]
    # Main job 15,000 + part-time 12,000 are reliable. Freelance 6,000 is not.
    assert fit["reliable"]["native"] == {"NTD": "27000.00"}
    assert fit["irregular"]["native"] == {"NTD": "6000.00"}
    assert fit["reliable"]["KES"] == "108000.00"
    assert fit["plan"]["KES"] == "80900.00"          # KES 42,100 + NTD 9,700 x 4
    assert fit["fits"] is True
    assert D(fit["gap_kes"]) == D("80900") - D("108000")


def test_over_planned_month_cannot_start_without_a_shortfall_source(api):
    mid = month_id(api)
    internship = source(api, "Part-time job")
    api.put(f"/api/months/{mid}/expected", json={"source_id": internship["id"], "amount": "0"})
    fit = view(api)["fit"]
    assert fit["fits"] is False
    assert fit["gap_kes"] == "20900.00"            # 80,900 - 15,000 x 4
    assert fit["flexible_lines"][0]["name"] == "Family support"   # biggest flexible line first

    blocked = start(api)
    assert blocked.status_code == 409
    assert view(api)["status"] == "planning"

    ok = start(api, shortfall_source="Last month's balance")
    assert ok.status_code == 200
    body = ok.json()
    assert body["status"] == "active"
    assert body["shortfall_amount"] == "20900.00"
    assert body["shortfall_source"] == "Last month's balance"


def test_a_payment_can_be_added_before_the_month_is_started_and_starts_it(api):
    assert view(api)["status"] == "planning"
    assert pay(api, "Main job", "12000").status_code == 201
    assert view(api)["status"] == "active"     # the plan fits, so the first payment started the month


def test_a_payment_is_still_saved_when_the_plan_does_not_fit(api):
    mid = month_id(api)
    for s in view(api)["sources"]:
        api.put(f"/api/months/{mid}/expected", json={"source_id": s["id"], "amount": "0"})
    assert view(api)["fit"]["fits"] is False
    assert pay(api, "Main job", "12000").status_code == 201
    v = view(api)
    assert v["status"] == "planning"            # not started: the plan is still too large
    assert len(v["arrivals"]) == 1


def test_closed_month_takes_no_payments(api, session_factory):
    from app.models import Month
    with session_factory() as session:
        session.get(Month, month_id(api)).status = "closed"
        session.commit()
    assert pay(api, "Main job", "12000").status_code == 409


def test_unconfirmed_suggestions_block_the_start(api):
    first = api.get("/api/months").json()[0]
    nxt = api.post("/api/months", json={"year": first["year"] + 1, "month": 1}).json()
    assert len(api.get(f"/api/months/{nxt['id']}/income").json()["sources"]) == 5
    blocked = api.post(f"/api/months/{nxt['id']}/activate", json={})
    assert blocked.status_code == 409
    api.post(f"/api/months/{nxt['id']}/confirm-all")
    # expected income was carried into the new month, so it fits and can start
    assert api.post(f"/api/months/{nxt['id']}/activate", json={}).status_code == 200


# ---- the split --------------------------------------------------------------

def test_first_reliable_payment_takes_core_saving_then_rule_then_essentials(api):
    start(api)
    arrival = pending(pay(api, "Main job", "12000").json())
    allocations = arrival["allocations"]

    # every slice adds up to exactly the payment
    assert sum(D(a["amount"]) for a in allocations) == D("12000.00")

    # 1. core saving of KES 6,000 at 4 = NTD 1,500, fully funded
    core = allocations[0]
    assert core["kind"] == "core_saving"
    assert core["amount"] == "1500.00"
    assert core["line_amount"] == "6000.00"

    # 2. the day job rule saves 20% of the whole payment
    assert allocations[1]["kind"] == "savings"
    assert allocations[1]["amount"] == "2400.00"

    # 3. essentials in NTD come next, in plan order (7,700), then Kenya essentials until the money runs out
    essentials = [a for a in allocations if a["kind"] == "essential"]
    assert [a["line_name"] for a in essentials[:3]] == ["Meals", "Weekly shop", "Transport pass"]
    assert essentials[-1]["line_name"] == "Groceries"
    assert essentials[-1]["amount"] == "400.00"     # partly funded: 8,100 - 7,700 left
    assert by_kind(arrival, "flexible") == 0
    assert by_kind(arrival, "free") == 0

    # the payment could not cover every essential, and the view says how much is left
    assert D(view(api)["summary"]["essentials_left"]["KES"]) > 0


def test_core_saving_is_taken_once_and_later_payments_reach_kenya(api):
    start(api)
    first = pending(pay(api, "Main job", "12000").json())
    api.post(f"/api/arrivals/{first['id']}/confirm")

    second = pending(pay(api, "Part-time job", "16000", "2026-11-20").json())
    assert by_kind(second, "core_saving") == 0                 # already taken this month
    assert by_kind(second, "savings") == D("3200.00")           # 20% of 16,000
    assert sum(D(a["amount"]) for a in second["allocations"]) == D("16000.00")
    kenya = [a for a in second["allocations"] if a["line_currency"] == "KES"]
    assert kenya and all(a["location_name"] == "Kenya" for a in kenya)
    api.post(f"/api/arrivals/{second['id']}/confirm")

    summary = view(api)["summary"]
    assert summary["core"]["covered"] == summary["core"]["planned"] == "6000.00"
    assert summary["arrived"]["native"] == {"NTD": "28000.00"}
    # 1,500 core + 2,400 + 3,200 from the saving rules + 750 for the KES 3,000 chama saving line
    assert summary["savings_reserved"]["NTD"] == "7850.00"
    # all essentials are funded once both reliable payments are in
    assert summary["essentials_left"]["KES"] == "0.00"
    assert summary["essential"]["covered"]["KES"] == summary["essential"]["planned"]["KES"]
    # nothing was funded twice
    plan = {l["id"]: D(l["planned"]) for l in api.get(f"/api/months/{month_id(api)}").json()["lines"]}
    for line_id, amount in view(api)["coverage"].items():
        assert D(amount) <= plan[int(line_id)]


def test_irregular_income_skips_core_saving(api):
    start(api)
    arrival = pending(pay(api, "Freelance", "14000").json())
    assert by_kind(arrival, "core_saving") == 0
    assert by_kind(arrival, "savings") == D("3500.00")          # 25%


def test_three_way_rule_caps_what_goes_to_lines(api):
    start(api)
    arrival = pending(pay(api, "Side projects", "10000").json())
    assert by_kind(arrival, "savings") == D("3000.00")          # 30% saved
    to_lines = by_kind(arrival, "essential") + by_kind(arrival, "flexible")
    assert to_lines == D("4000.00")                             # 40% to obligations
    assert by_kind(arrival, "free") == D("3000.00")             # 30% personal


def test_split_can_be_adjusted_and_the_rest_becomes_free(api):
    start(api)
    arrival = pending(pay(api, "Main job", "12000").json())
    core = arrival["allocations"][0]
    changed = api.put(f"/api/arrivals/{arrival['id']}/allocations", json=[
        {"kind": "core_saving", "budget_line_id": core["budget_line_id"], "amount": core["amount"]},
        {"kind": "savings", "amount": "1000"},
    ])
    assert changed.status_code == 200
    after = pending(changed.json())
    assert by_kind(after, "free") == D("12000") - D(core["amount"]) - D("1000")

    too_much = api.put(f"/api/arrivals/{arrival['id']}/allocations", json=[{"kind": "savings", "amount": "12000.01"}])
    assert too_much.status_code == 422

    # the unchanged core slice keeps its exact KES figure after the adjustment
    assert after["allocations"][0]["line_amount"] == "6000.00"
    # still to come: 3,000 more from the main job (15,000 expected, 12,000 paid) and the part-time job's 12,000
    assert changed.json()["summary"]["upcoming_reliable"]["native"] == {"NTD": "15000.00"}

    # asking again brings the suggested split back
    again = pending(api.post(f"/api/arrivals/{arrival['id']}/resuggest").json())
    assert again["allocations"][1]["amount"] == "2400.00"


def test_three_payments_in_a_row_on_different_dates(api):
    """The user's case: record one payment, then another, then see the total."""
    start(api)
    assert pay(api, "Main job", "12000", "2026-11-05").status_code == 201
    assert pay(api, "Freelance", "14000", "2026-11-10").status_code == 201
    assert pay(api, "Part-time job", "16000", "2026-11-20").status_code == 201
    v = view(api)
    assert [a["source_name"] for a in v["arrivals"]] == ["Main job", "Freelance", "Part-time job"]
    assert all(a["confirmed"] for a in v["arrivals"])
    assert v["summary"]["arrived"]["native"] == {"NTD": "42000.00"}
    assert v["summary"]["arrived"]["KES"] == "168000.00"
    # every payment still adds up to exactly what arrived
    for a in v["arrivals"]:
        assert sum(D(x["amount"]) for x in a["allocations"]) == D(a["amount"])
    # the core saving was taken once, from the first reliable payment
    core = [x for a in v["arrivals"] for x in a["allocations"] if x["kind"] == "core_saving"]
    assert len(core) == 1


def test_a_saved_payment_can_be_reset_without_counting_itself(api):
    start(api)
    first = pending(pay(api, "Main job", "12000").json())
    again = next(a for a in api.post(f"/api/arrivals/{first['id']}/resuggest").json()["arrivals"] if a["id"] == first["id"])
    # still takes the core saving: its own earlier split is left out when working it out again
    assert again["allocations"] == [] or again["allocations"][0]["kind"] == "core_saving"
    assert [(x["kind"], x["amount"]) for x in again["allocations"]] == [
        (x["kind"], x["amount"]) for x in first["allocations"]]
    # and removing it frees everything
    after = api.delete(f"/api/arrivals/{first['id']}").json()
    assert after["arrivals"] == [] and after["summary"]["arrived"]["KES"] == "0.00"


# ---- core saving protection --------------------------------------------------

def test_core_saving_cannot_be_reduced_or_removed_without_a_reason(api):
    mid = month_id(api)
    core = next(l for l in api.get(f"/api/months/{mid}").json()["lines"] if l["is_core"])
    assert core["planned"] == "6000.00"

    assert api.patch(f"/api/lines/{core['id']}", json={"planned": "5000"}).status_code == 409
    assert api.delete(f"/api/lines/{core['id']}").status_code == 409
    # raising it needs no reason
    assert api.patch(f"/api/lines/{core['id']}", json={"planned": "9000"}).status_code == 200

    reduced = api.patch(f"/api/lines/{core['id']}", json={"planned": "5000", "reason": "School fees due"})
    assert reduced.status_code == 200
    assert reduced.json()["planned"] == "5000.00"
    note = view(api)["core_note"]
    assert "School fees due" in note and "9,000.00 to 5,000.00" in note

    assert api.delete(f"/api/lines/{core['id']}", params={"reason": "Paused this month"}).status_code == 204
    assert "Paused this month" in view(api)["core_note"]
    assert view(api)["summary"]["core"] is None


# ---- splits stay right when payments are added out of order or removed --------

def kinds(arrival):
    out = {}
    for x in arrival["allocations"]:
        out[x["kind"]] = out.get(x["kind"], D("0")) + D(x["amount"])
    return out


def by_source(v, name):
    return next(a for a in v["arrivals"] if a["source_name"] == name)


def test_removing_a_payment_moves_the_core_saving_to_the_next_one(api):
    """What happened to the user: a duplicate took the core saving, then was removed."""
    start(api)
    pay(api, "Main job", "18400", "2026-11-10")
    duplicate = pending(pay(api, "Main job", "18400", "2026-11-10").json())
    pay(api, "Part-time job", "16000", "2026-11-10")
    after = api.delete(f"/api/arrivals/{duplicate['id']}").json()

    assert len(after["arrivals"]) == 2
    s = after["summary"]
    assert s["core"]["covered"] == s["core"]["planned"] == "6000.00"
    # the bills the duplicate had covered are funded again by the remaining payments
    assert s["essentials_left"]["KES"] == "0.00"
    for a in after["arrivals"]:
        assert sum(D(x["amount"]) for x in a["allocations"]) == D(a["amount"])
    plan = {l["id"]: D(l["planned"]) for l in api.get(f"/api/months/{mid(api)}").json()["lines"]}
    for line_id, amount in after["coverage"].items():
        assert D(amount) <= plan[int(line_id)]


def mid(api):
    return month_id(api)


def test_an_earlier_payment_added_later_takes_the_core_saving(api):
    start(api)
    pay(api, "Part-time job", "16000", "2026-11-20")
    v = pay(api, "Main job", "12000", "2026-11-05").json()
    assert kinds(by_source(v, "Main job")).get("core_saving") == D("1500.00")
    assert "core_saving" not in kinds(by_source(v, "Part-time job"))


def test_a_split_changed_by_hand_is_kept_when_others_change(api):
    start(api)
    first = pending(pay(api, "Main job", "12000", "2026-11-05").json())
    api.put(f"/api/arrivals/{first['id']}/allocations", json=[{"kind": "savings", "amount": "5000"}])
    v = pay(api, "Part-time job", "16000", "2026-11-20").json()
    mine = by_source(v, "Main job")
    assert kinds(mine) == {"savings": D("5000.00"), "free": D("7000.00")}
    # the core saving the hand-made split left out is taken by the next payment
    assert kinds(by_source(v, "Part-time job")).get("core_saving") == D("1500.00")
    # resetting it brings back the suggestion, and the core saving moves back
    reset = api.post(f"/api/arrivals/{first['id']}/resuggest").json()
    assert kinds(by_source(reset, "Main job")).get("core_saving") == D("1500.00")
    assert "core_saving" not in kinds(by_source(reset, "Part-time job"))
