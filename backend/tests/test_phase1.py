"""Phase 1 checks: exact money, conversion, totals, weekly lines, copy-forward."""
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.models import BudgetLine, Currency, LineGroup, Location, Month
from app.seed import seed_if_empty
from sample import PLAN
from app.services import Bucket, convert, copy_forward, month_totals, weekly_planned

D = Decimal


# ---- money and conversion ---------------------------------------------------

def test_money_is_stored_exactly(db):
    db.add_all([Currency(code="KES", name="Kenyan Shilling")])
    loc = Location(name="Kenya", default_currency="KES")
    db.add(loc)
    db.flush()
    group = LineGroup(name="Home", location_id=loc.id)
    month = Month(year=2026, month=11, fx_rate_ntd_kes=D("4.1"))
    db.add_all([group, month])
    db.flush()
    # 0.1 + 0.2 is the classic float trap
    for amount in ("0.10", "0.20"):
        db.add(BudgetLine(month_id=month.id, group_id=group.id, name="x",
                          currency_code="KES", planned=D(amount)))
    db.commit()
    db.expire_all()
    stored = db.scalars(select(BudgetLine)).all()
    assert sum(l.planned for l in stored) == D("0.30")
    assert db.get(Month, month.id).fx_rate_ntd_kes == D("4.1")


def test_conversion_both_ways():
    assert convert(D("1000"), "NTD", "KES", D("4.1")) == D("4100.00")
    assert convert(D("4100"), "KES", "NTD", D("4.1")) == D("1000.00")
    assert convert(D("250"), "KES", "KES", D("4.1")) == D("250.00")
    # rounds half up to cents
    assert convert(D("100"), "KES", "NTD", D("3")) == D("33.33")


def test_bucket_rounds_once_not_per_line():
    bucket = Bucket()
    for _ in range(3):
        bucket.add("KES", D("100"))
    # 300 / 3 = 100 exactly; rounding each 33.33 first would give 99.99
    assert bucket.report(D("3"))["NTD"] == D("100.00")


def test_weekly_amount_times_weeks():
    assert weekly_planned(D("1250"), 4) == D("5000.00")
    assert weekly_planned(D("1250"), 5) == D("6250.00")


# ---- totals -----------------------------------------------------------------

def _expected_native():
    totals = {"KES": D("0"), "NTD": D("0")}
    for currency, groups in PLAN.values():
        for _name, lines in groups:
            for line in lines:
                totals[currency] += D(line[3])
    return totals


def test_totals_come_from_lines_only(db):
    seed_if_empty(db, today=date(2026, 11, 10))
    month = db.scalars(select(Month)).one()
    groups = {g.id: g for g in db.scalars(select(LineGroup))}
    totals = month_totals(month, groups)

    native = _expected_native()
    # Totals come only from the lines, never from stored subtotals.
    assert native["KES"] == D("42100")
    assert native["NTD"] == D("9700")
    assert totals["grand"]["native"] == {"KES": D("42100.00"), "NTD": D("9700.00")}
    assert totals["grand"]["KES"] == D("42100") + D("9700") * D("4.0")
    # group totals add up to the grand total, with nothing counted twice
    assert sum(g["KES"] for g in totals["groups"].values()) == totals["grand"]["KES"]
    assert sum(l["KES"] for l in totals["locations"].values()) == totals["grand"]["KES"]
    assert (totals["priority"]["essential"]["KES"] + totals["priority"]["flexible"]["KES"]
            == totals["grand"]["KES"])
    assert totals["kind"]["saving"]["native"] == {"KES": D("9000.00")}


# ---- copy-forward -----------------------------------------------------------

def test_copy_forward_rules(db):
    seed_if_empty(db, today=date(2026, 11, 10))
    source = db.scalars(select(Month)).one()
    group_id = source.lines[0].group_id
    source.lines.append(BudgetLine(group_id=group_id, name="Wedding gift", currency_code="KES",
                                   line_type="one_off", planned=D("3000")))
    source.lines.append(BudgetLine(group_id=group_id, name="Weekly market", currency_code="NTD",
                                   line_type="variable", weekly_amount=D("1000"), planned=D("4000")))
    for line in source.lines:
        line.actual = line.planned  # pretend the month was reviewed
    db.commit()

    target = Month(year=2026, month=12, fx_rate_ntd_kes=source.fx_rate_ntd_kes, weeks=5)
    copied = copy_forward(source, target)
    db.add(target)
    db.commit()

    names = [l.name for l in target.lines]
    assert "Wedding gift" not in names                 # one-off lines stay behind
    assert copied == len(source.lines) - 1
    by_name = {(l.name, l.group_id): l for l in target.lines}
    for line in source.lines:
        if line.line_type == "one_off":
            continue
        new = by_name[(line.name, line.group_id)]
        assert new.actual is None                      # actuals are never copied
        assert new.needs_review == (line.line_type == "variable")
        if line.weekly_amount is None:
            assert new.planned == line.planned
    weekly = next(l for l in target.lines if l.name == "Weekly market")
    assert weekly.planned == D("5000.00")              # 1,000 x 5 weeks in the new month


# ---- API --------------------------------------------------------------------

def _first_month(client):
    return client.get("/api/months").json()[0]


def test_api_month_detail_and_meta(client):
    meta = client.get("/api/meta").json()
    assert [l["name"] for l in meta["locations"]] == ["Taiwan", "Kenya"]
    assert {c["code"] for c in meta["currencies"]} == {"KES", "NTD"}
    month = _first_month(client)
    detail = client.get(f"/api/months/{month['id']}").json()
    assert len(detail["lines"]) == 31
    assert detail["totals"]["grand"]["native"] == {"KES": "42100.00", "NTD": "9700.00"}


def test_api_create_next_month_copies_and_blocks_duplicates(client):
    month = _first_month(client)
    year, number = (month["year"], month["month"] + 1) if month["month"] < 12 else (month["year"] + 1, 1)
    created = client.post("/api/months", json={"year": year, "month": number})
    assert created.status_code == 201
    body = created.json()
    assert body["copied_from"]
    assert len(body["lines"]) == 31
    assert body["totals"]["needs_review"] == sum(1 for l in body["lines"] if l["line_type"] == "variable")
    assert client.post("/api/months", json={"year": year, "month": number}).status_code == 409


def test_api_editing_a_line_updates_totals_and_confirms_it(client):
    month = _first_month(client)
    year, number = (month["year"], month["month"] + 1) if month["month"] < 12 else (month["year"] + 1, 1)
    new = client.post("/api/months", json={"year": year, "month": number}).json()
    line = next(l for l in new["lines"] if l["needs_review"] and l["currency_code"] == "KES")
    before = Decimal(new["totals"]["grand"]["native"]["KES"])

    patched = client.patch(f"/api/lines/{line['id']}", json={"planned": "9999.50"}).json()
    assert patched["planned"] == "9999.50"
    assert patched["needs_review"] is False
    after = Decimal(client.get(f"/api/months/{new['id']}").json()["totals"]["grand"]["native"]["KES"])
    assert after - before == Decimal("9999.50") - Decimal(line["planned"])


def test_api_weekly_line_follows_month_weeks(client):
    month = _first_month(client)
    group_id = client.get("/api/meta").json()["locations"][0]["groups"][0]["id"]
    line = client.post(f"/api/months/{month['id']}/lines", json={
        "group_id": group_id, "name": "Weekly market", "currency_code": "NTD", "weekly_amount": "1000",
    }).json()
    assert line["planned"] == "4000.00"
    client.patch(f"/api/months/{month['id']}", json={"weeks": 5})
    lines = client.get(f"/api/months/{month['id']}").json()["lines"]
    assert next(l for l in lines if l["id"] == line["id"])["planned"] == "5000.00"


def test_api_rejects_bad_input_and_protects_used_sections(client):
    month = _first_month(client)
    meta = client.get("/api/meta").json()
    group_id = meta["locations"][0]["groups"][0]["id"]
    bad = client.post(f"/api/months/{month['id']}/lines", json={
        "group_id": group_id, "name": "Bad", "currency_code": "NTD", "planned": "-5"})
    assert bad.status_code == 422
    unknown = client.post(f"/api/months/{month['id']}/lines", json={
        "group_id": group_id, "name": "Bad", "currency_code": "USD", "planned": "5"})
    assert unknown.status_code == 422
    assert client.delete(f"/api/groups/{group_id}").status_code == 409


def test_api_closed_month_is_locked(client, session_factory):
    month = _first_month(client)
    with session_factory() as session:
        session.get(Month, month["id"]).status = "closed"
        session.commit()
    line_id = client.get(f"/api/months/{month['id']}").json()["lines"][0]["id"]
    assert client.patch(f"/api/lines/{line_id}", json={"planned": "1"}).status_code == 409
    assert client.patch(f"/api/months/{month['id']}", json={"weeks": 5}).status_code == 409
    assert client.delete(f"/api/lines/{line_id}").status_code == 409
