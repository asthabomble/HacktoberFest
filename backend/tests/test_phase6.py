"""Automated tests for Phase 6: voice entry + demo seed data.

1. Voice/typed text -> rows for the Review screen, with learned shorthand applied, nothing saved.
2. Voice prompt carries the text, the shop's customers and shorthand.
3. Seed data produces the demo numbers (overdue, udhaar today, low stock, shorthand).
4. Seed refuses to wipe a database that already has customers unless forced.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

import scripts.seed_demo as seed_demo
from app.db import get_session
from app.main import app
from app.models import CreditEntry, Customer, ShorthandKind, ShorthandMap, Shop
from app.services.khata import ExtractedRow, KhataExtraction


@pytest.fixture(name="engine")
def fixture_engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    yield engine
    SQLModel.metadata.drop_all(engine)


@pytest.fixture(name="client")
def fixture_client(engine):
    with Session(engine) as session:
        session.add(Shop(id=1, name="Sharma Kirana Store"))
        session.add(Customer(id=1, shop_id=1, name="Ramesh bhau"))
        session.add(ShorthandMap(shop_id=1, token="Rmsh", meaning="Ramesh bhau", kind=ShorthandKind.customer))
        session.commit()

        def override_session():
            yield session

        app.dependency_overrides[get_session] = override_session
        try:
            yield TestClient(app), session
        finally:
            app.dependency_overrides.clear()


def test_voice_entry_to_rows(client):
    c, session = client
    mock = AsyncMock(return_value=KhataExtraction(rows=[
        ExtractedRow(customer_name="Rmsh", written_name="Rmsh", amount="५००", type="gave", raw_text="Rmsh ko 500 udhaar", confidence="high"),
        ExtractedRow(customer_name="Sunita", written_name="Sunita", amount=200, type="got", raw_text="Sunita 200 jama", confidence="high"),
    ]))
    with patch("app.services.gemma.generate_json", new=mock):
        res = c.post("/api/khata/voice", json={"text": "Rmsh ko 500 udhaar diya, Sunita ne 200 jama kiye"})
    assert res.status_code == 200, res.text
    rows = res.json()["rows"]
    assert [(r["customer_name"], r["amount"], r["type"], r["matched_by"]) for r in rows] == [
        ("Ramesh bhau", 500.0, "gave", "shorthand"),
        ("Sunita", 200.0, "got", None),
    ]
    assert res.json()["source_image"] == ""

    prompt = mock.call_args.args[0]
    assert "Rmsh ko 500 udhaar diya" in prompt
    assert '"Rmsh" = Ramesh bhau' in prompt
    assert "images" not in mock.call_args.kwargs  # text only, no photo

    # Nothing is saved until the user confirms
    assert session.exec(select(CreditEntry)).all() == []


def test_voice_entry_rejects_empty_text(client):
    c, _ = client
    assert c.post("/api/khata/voice", json={"text": ""}).status_code == 422


def test_seed_demo_numbers(engine, monkeypatch):
    monkeypatch.setattr(seed_demo, "engine", engine)
    monkeypatch.setattr(seed_demo, "init_db", lambda: None)
    assert seed_demo.seed() is True

    with Session(engine) as session:
        def override_session():
            yield session

        app.dependency_overrides[get_session] = override_session
        try:
            o = TestClient(app).get("/api/overview").json()
        finally:
            app.dependency_overrides.clear()

    assert o["customer_count"] == 10
    assert o["overdue_count"] == 3
    assert o["udhaar_today"] == 1620.0
    assert o["low_stock_count"] == 4
    assert o["shorthand_count"] == 6
    top = o["top_debtors"][0]
    assert (top["name"], top["balance"], top["days_due"]) == ("Ramesh bhau", 6450.0, 42)


def test_seed_demo_refuses_to_wipe_without_force(engine, monkeypatch):
    monkeypatch.setattr(seed_demo, "engine", engine)
    monkeypatch.setattr(seed_demo, "init_db", lambda: None)
    with Session(engine) as session:
        session.add(Shop(id=1, name="Real Shop"))
        session.add(Customer(shop_id=1, name="Real customer"))
        session.commit()

    assert seed_demo.seed(force=False) is False
    with Session(engine) as session:
        assert [c.name for c in session.exec(select(Customer)).all()] == ["Real customer"]
