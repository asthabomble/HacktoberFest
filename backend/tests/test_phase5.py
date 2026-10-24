"""Automated tests for Phase 5: the app learns the shop's handwriting.

1. Fuzzy customer-name scores (honorifics, abbreviations, ambiguity, Devanagari).
2. Correct an entry, re-upload a similar page -> it's now right (learned shorthand).
3. Learned shorthand and customer list are included in the next extraction prompt.
4. Fuzzy match to an existing customer ("Sunita" -> "Sunita tai") without learning noise.
5. Similar customers are suggested and can be merged; the old name becomes shorthand.
6. Bill item corrected to an existing product -> next bill matches it via learned shorthand.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.db import get_session
from app.main import app
from app.models import Product, ShorthandKind, ShorthandMap, Shop
from app.services.bill import BillExtraction, ExtractedBillItem
from app.services.khata import ExtractedRow, KhataExtraction
from app.services.matching import normalize_text
from app.services.names import best_match, name_score

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 50


@pytest.fixture(name="client")
def fixture_client(tmp_path, monkeypatch):
    # Keep test photos out of the real uploads/ folder
    monkeypatch.setattr("app.routers.khata.UPLOAD_DIR", tmp_path)
    monkeypatch.setattr("app.routers.stock.UPLOAD_DIR", tmp_path)
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Shop(id=1, name="Sharma Kirana Store"))
        session.commit()

        def override_session():
            yield session

        app.dependency_overrides[get_session] = override_session
        try:
            yield TestClient(app), session
        finally:
            app.dependency_overrides.clear()


def khata_reply(*rows: dict) -> AsyncMock:
    return AsyncMock(return_value=KhataExtraction(rows=[ExtractedRow(**r) for r in rows]))


def extract(client: TestClient) -> list[dict]:
    res = client.post("/api/khata/extract", files={"file": ("k.png", PNG, "image/png")})
    assert res.status_code == 200, res.text
    return res.json()["rows"]


def confirm(client: TestClient, rows: list[dict]) -> dict:
    res = client.post("/api/khata/confirm", json={"rows": rows})
    assert res.status_code == 200, res.text
    return res.json()


# --- 1. Name scores ---


def test_name_scores():
    assert normalize_text("रमेश भाऊ") == "रमेश भाऊ"  # Devanagari vowel signs survive normalization
    assert name_score("Ramesh", "Ramesh bhau") == 1.0
    assert name_score("रमेश", "रमेश भाऊ") == 1.0
    assert name_score("Rmsh", "Ramesh bhau") >= 0.8
    assert name_score("Pappu", "Pappu (dhaba)") >= 0.8
    assert name_score("Ramesh", "Suresh") < 0.8
    assert best_match("Rmsh", ["Ramesh bhau", "Suresh", "Sunita tai"])[0] == "Ramesh bhau"
    # Two equally good candidates -> don't guess
    assert best_match("Ramesh", ["Ramesh Patil", "Ramesh Kumar"])[0] is None


# --- 2 & 3. Correct, re-upload, now right ---


def test_correction_is_learned_and_used_next_time(client):
    c, session = client
    page = {"customer_name": "Rmsh", "written_name": "Rmsh", "amount": 450, "type": "gave", "raw_text": "Rmsh 450 ch+tel", "confidence": "high"}

    # First upload: nobody known yet, so the app shows what was written
    with patch("app.services.gemma.generate_json", new=khata_reply(page)):
        rows = extract(c)
    assert rows[0]["customer_name"] == "Rmsh"
    assert rows[0]["matched_by"] is None

    # Shopkeeper corrects the name and confirms
    rows[0]["customer_name"] = "Ramesh bhau"
    assert confirm(c, rows)["learned"] == 1
    learned = session.exec(select(ShorthandMap)).one()
    assert (learned.token, learned.meaning, learned.kind) == ("Rmsh", "Ramesh bhau", ShorthandKind.customer)

    # Similar page again: the model still reads "Rmsh", the app now fills in "Ramesh bhau"
    mock = khata_reply({**page, "amount": 120, "raw_text": "Rmsh 120 doodh"})
    with patch("app.services.gemma.generate_json", new=mock):
        rows = extract(c)
    assert rows[0]["customer_name"] == "Ramesh bhau"
    assert rows[0]["written_name"] == "Rmsh"
    assert rows[0]["matched_by"] == "shorthand"

    # ...and the prompt carried the shop's customers and shorthand
    prompt = mock.call_args.args[0]
    assert "Ramesh bhau" in prompt
    assert '"Rmsh" = Ramesh bhau' in prompt

    # Confirming again doesn't duplicate the shorthand or the customer
    assert confirm(c, rows) == {"saved": 1, "new_customers": 0, "learned": 0}
    ledger = c.get("/api/customers").json()["customers"]
    assert [(x["name"], x["balance"]) for x in ledger] == [("Ramesh bhau", 570.0)]
    assert c.get(f"/api/customers/{ledger[0]['id']}/ledger").json()["aliases"] == ["Rmsh"]


def test_whole_line_in_written_name_is_ignored(client):
    c, _ = client
    with patch("app.services.gemma.generate_json", new=khata_reply(
        {"customer_name": "Rmsh", "written_name": "Rmsh — ch+tel ....... 450", "amount": 450, "type": "gave", "confidence": "high"}
    )):
        rows = extract(c)
    assert rows[0]["written_name"] == "Rmsh"


# --- 4. Fuzzy match to an existing customer ---


def test_fuzzy_match_existing_customer(client):
    c, session = client
    confirm(c, [{"customer_name": "Sunita tai", "amount": 300, "type": "gave"}])

    with patch("app.services.gemma.generate_json", new=khata_reply(
        {"customer_name": "Sunita", "written_name": "Sunita", "amount": 50, "type": "got", "confidence": "high"}
    )):
        rows = extract(c)
    assert rows[0]["customer_name"] == "Sunita tai"
    assert rows[0]["matched_by"] == "fuzzy"

    # Honorific-only difference isn't stored as shorthand
    assert confirm(c, rows)["learned"] == 0
    assert session.exec(select(ShorthandMap)).all() == []
    assert c.get("/api/customers").json()["customers"][0]["balance"] == 250.0


# --- 5. Merge duplicates ---


def test_similar_and_merge(client):
    c, session = client
    confirm(c, [
        {"customer_name": "Ramesh bhau", "amount": 500, "type": "gave"},
        {"customer_name": "Ramesh", "amount": 200, "type": "gave"},
        {"customer_name": "Suresh", "amount": 100, "type": "gave"},
    ])
    ids = {x["name"]: x["id"] for x in c.get("/api/customers").json()["customers"]}

    similar = c.get(f"/api/customers/{ids['Ramesh bhau']}/similar").json()["customers"]
    assert [s["name"] for s in similar] == ["Ramesh"]

    res = c.post(f"/api/customers/{ids['Ramesh bhau']}/merge", json={"from_id": ids["Ramesh"]})
    assert res.json() == {"merged": 1, "into": ids["Ramesh bhau"]}

    customers = {x["name"]: x["balance"] for x in c.get("/api/customers").json()["customers"]}
    assert customers == {"Ramesh bhau": 700.0, "Suresh": 100.0}
    # "Ramesh" vs "Ramesh bhau" only differ by honorific, so nothing to learn from this merge
    assert session.exec(select(ShorthandMap)).all() == []


def test_merge_remembers_old_name(client):
    c, session = client
    confirm(c, [
        {"customer_name": "Iqbal chacha", "amount": 300, "type": "gave"},
        {"customer_name": "Iqbl", "amount": 100, "type": "gave"},
    ])
    ids = {x["name"]: x["id"] for x in c.get("/api/customers").json()["customers"]}
    c.post(f"/api/customers/{ids['Iqbal chacha']}/merge", json={"from_id": ids["Iqbl"]})

    learned = session.exec(select(ShorthandMap)).one()
    assert (learned.token, learned.meaning) == ("Iqbl", "Iqbal chacha")


# --- 6. Bill product shorthand ---


def test_bill_item_shorthand_learned(client):
    c, session = client
    session.add(Product(shop_id=1, name="Sugar / Cheeni", unit="kg"))
    session.commit()
    sugar = session.exec(select(Product)).one()

    bill = BillExtraction(items=[ExtractedBillItem(item_name="ch", quantity=10, unit="kg", rate=44, line_total=440, confidence="high")])
    with patch("app.services.gemma.generate_json", new=AsyncMock(return_value=bill)):
        first = c.post("/api/stock/bills/extract", files={"file": ("b.png", PNG, "image/png")}).json()
    assert first["items"][0]["suggested_product_id"] is None  # "ch" alone doesn't fuzzy-match

    # Shopkeeper links "ch" to the existing product
    c.post("/api/stock/bills/confirm", json={
        "confirmation_token": first["confirmation_token"],
        "items": [{"product_id": sugar.id, "item_name": "ch", "unit": "kg", "quantity": 10, "rate": 44, "line_total": 440}],
    })

    mock = AsyncMock(return_value=bill)
    with patch("app.services.gemma.generate_json", new=mock):
        second = c.post("/api/stock/bills/extract", files={"file": ("b.png", PNG, "image/png")}).json()
    assert second["items"][0]["suggested_product_id"] == sugar.id
    assert second["items"][0]["match_score"] == 1.0
    assert '"ch" = Sugar / Cheeni' in mock.call_args.args[0]
