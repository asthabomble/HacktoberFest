"""Automated tests for Phase 4: Alerts + Reminders.

Tests all required scenarios:
1. Seeded low-stock product triggers an alert.
2. Seeded overdue unpaid credit triggers an alert.
3. Customers without positive outstanding balances are excluded from overdue alerts / top debtors.
4. Dashboard total outstanding and top-five ranking are correct.
5. WhatsApp link encoding and Indian phone normalization work.
6. Invalid / missing phone number is handled safely.
7. Gemma failure falls back to a usable reminder message.
8. API endpoints for /api/alerts and /api/reminders/draft function end-to-end.
"""

from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.main import app
from app.models import CreditEntry, CreditType, Customer, Product, Shop, StockEntry, StockEntryKind
from app.services.alerts import get_all_alerts, get_low_stock_alerts, get_overdue_udhaar_alerts
from app.services.ledger import overview
from app.services.reminders import (
    build_whatsapp_url,
    draft_reminder_message,
    get_fallback_reminder,
    normalize_indian_phone,
)

TEST_DB_URL = "sqlite:///:memory:"


@pytest.fixture(name="db_session")
def fixture_db_session():
    engine = create_engine(
        TEST_DB_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        shop = Shop(id=1, name="Sharma Kirana Store", owner_name="Sharma ji", language="hi")
        session.add(shop)
        session.commit()
        session.refresh(shop)
        yield session
    SQLModel.metadata.drop_all(engine)


# --- 1. Seeded low-stock product triggers an alert ---


def test_seeded_low_stock_triggers_alert(db_session: Session):
    # Product with threshold 10 and stock 4 (less than threshold -> low stock alert)
    p_low = Product(shop_id=1, name="Aashirvaad Atta 5kg", unit="packet", low_stock_threshold=10.0)
    # Product with threshold 5 and stock 15 (healthy -> no alert)
    p_ok = Product(shop_id=1, name="Sugar M-30", unit="kg", low_stock_threshold=5.0)
    # Product with threshold 0 (no threshold configured -> no alert)
    p_none = Product(shop_id=1, name="Salt", unit="packet", low_stock_threshold=0.0)

    db_session.add_all([p_low, p_ok, p_none])
    db_session.commit()
    db_session.refresh(p_low)
    db_session.refresh(p_ok)
    db_session.refresh(p_none)

    # Add stock entries
    e1 = StockEntry(shop_id=1, product_id=p_low.id, kind=StockEntryKind.purchase, qty_change=4.0, confirmed=True)
    e2 = StockEntry(shop_id=1, product_id=p_ok.id, kind=StockEntryKind.purchase, qty_change=15.0, confirmed=True)
    db_session.add_all([e1, e2])
    db_session.commit()

    alerts = get_low_stock_alerts(db_session, shop_id=1)
    assert len(alerts) == 1
    assert alerts[0]["product_id"] == p_low.id
    assert alerts[0]["product_name"] == "Aashirvaad Atta 5kg"
    assert alerts[0]["current_stock"] == 4.0
    assert alerts[0]["threshold"] == 10.0
    assert alerts[0]["shortage"] == 6.0
    assert "Aashirvaad Atta 5kg: 4.0 packet remaining" in alerts[0]["message"]


# --- 2. Seeded overdue unpaid credit triggers an alert ---


def test_seeded_overdue_unpaid_credit_triggers_alert(db_session: Session):
    c1 = Customer(shop_id=1, name="Overdue Ramesh", phone="9876543210")
    c2 = Customer(shop_id=1, name="Recent Suresh", phone="9876543211")
    db_session.add_all([c1, c2])
    db_session.commit()
    db_session.refresh(c1)
    db_session.refresh(c2)

    today = date.today()
    forty_days_ago = today - timedelta(days=40)
    five_days_ago = today - timedelta(days=5)

    # c1 has unpaid credit from 40 days ago (> 30 days overdue)
    e1 = CreditEntry(
        shop_id=1,
        customer_id=c1.id,
        amount=1200.0,
        type=CreditType.gave,
        entry_date=forty_days_ago,
        confirmed=True,
    )
    # c2 has credit from 5 days ago (not overdue)
    e2 = CreditEntry(
        shop_id=1,
        customer_id=c2.id,
        amount=500.0,
        type=CreditType.gave,
        entry_date=five_days_ago,
        confirmed=True,
    )
    db_session.add_all([e1, e2])
    db_session.commit()

    alerts = get_overdue_udhaar_alerts(db_session, shop_id=1, overdue_days=30)
    assert len(alerts) == 1
    assert alerts[0]["customer_id"] == c1.id
    assert alerts[0]["customer_name"] == "Overdue Ramesh"
    assert alerts[0]["balance"] == 1200.0
    assert alerts[0]["days_due"] >= 40
    assert "Overdue Ramesh: ₹1,200.00 pending" in alerts[0]["message"]


# --- 3. Customers without positive outstanding balances are excluded ---


def test_customers_without_positive_balance_excluded(db_session: Session):
    c_zero = Customer(shop_id=1, name="Zero Balance Amit")
    c_advance = Customer(shop_id=1, name="Advance Paying Sunita")
    db_session.add_all([c_zero, c_advance])
    db_session.commit()
    db_session.refresh(c_zero)
    db_session.refresh(c_advance)

    old_date = date.today() - timedelta(days=50)

    # c_zero: gave 500, paid back 500 -> balance 0
    e1 = CreditEntry(shop_id=1, customer_id=c_zero.id, amount=500.0, type=CreditType.gave, entry_date=old_date, confirmed=True)
    e2 = CreditEntry(shop_id=1, customer_id=c_zero.id, amount=500.0, type=CreditType.got, entry_date=old_date, confirmed=True)

    # c_advance: paid 300 advance -> balance -300
    e3 = CreditEntry(shop_id=1, customer_id=c_advance.id, amount=300.0, type=CreditType.got, entry_date=old_date, confirmed=True)
    db_session.add_all([e1, e2, e3])
    db_session.commit()

    alerts = get_overdue_udhaar_alerts(db_session, shop_id=1, overdue_days=30)
    assert len(alerts) == 0

    ov = overview(db_session, shop_id=1)
    assert len(ov["top_debtors"]) == 0
    assert ov["total_outstanding"] == 0.0


# --- 4. Dashboard total and top-five ranking are correct ---


def test_dashboard_total_and_top_five_ranking(db_session: Session):
    # Create 7 customers with various positive and zero balances
    customers = [Customer(shop_id=1, name=f"Cust_{i}") for i in range(1, 8)]
    db_session.add_all(customers)
    db_session.commit()
    for c in customers:
        db_session.refresh(c)

    # Balances: Cust_1: 1000, Cust_2: 2500, Cust_3: 300, Cust_4: 4000, Cust_5: 1500, Cust_6: 50, Cust_7: 0
    amounts = [1000.0, 2500.0, 300.0, 4000.0, 1500.0, 50.0, 0.0]
    for c, amt in zip(customers, amounts):
        if amt > 0:
            db_session.add(
                CreditEntry(shop_id=1, customer_id=c.id, amount=amt, type=CreditType.gave, entry_date=date.today(), confirmed=True)
            )
    db_session.commit()

    ov = overview(db_session, shop_id=1)

    # Total outstanding: 1000 + 2500 + 300 + 4000 + 1500 + 50 = 9350.0
    assert ov["total_outstanding"] == 9350.0

    # Top debtors should contain top 5 ranked in descending order:
    # 1. Cust_4: 4000
    # 2. Cust_2: 2500
    # 3. Cust_5: 1500
    # 4. Cust_1: 1000
    # 5. Cust_3: 300
    top = ov["top_debtors"]
    assert len(top) == 5
    assert [d["name"] for d in top] == ["Cust_4", "Cust_2", "Cust_5", "Cust_1", "Cust_3"]
    assert [d["balance"] for d in top] == [4000.0, 2500.0, 1500.0, 1000.0, 300.0]


# --- 5. WhatsApp link encoding and Indian phone normalization work ---


def test_whatsapp_link_encoding_and_phone_normalization():
    # Test valid phone formats
    assert normalize_indian_phone("9876543210") == "919876543210"
    assert normalize_indian_phone("+91 98765 43210") == "919876543210"
    assert normalize_indian_phone("09876543210") == "919876543210"
    assert normalize_indian_phone("919876543210") == "919876543210"
    assert normalize_indian_phone("+91-81234-56789") == "918123456789"
    assert normalize_indian_phone("7000112233") == "917000112233"

    # Test URL generation and encoding
    msg = "Namaste Ramesh ji, aapka ₹1,200.50 baaki hai. Dhanyavaad!"
    url = build_whatsapp_url("9876543210", msg)
    assert url is not None
    assert url.startswith("https://wa.me/919876543210?text=")
    # Check proper URL encoding of rupee sign, spaces, and punctuation
    assert "%E2%82%B91%2C200.50" in url or "1%2C200.50" in url
    assert "Namaste%20Ramesh%20ji" in url


# --- 6. Invalid / missing phone number is handled safely ---


def test_invalid_and_missing_phone_handling():
    # Missing phone (None or empty)
    assert normalize_indian_phone(None) is None
    assert normalize_indian_phone("") is None
    assert normalize_indian_phone("   ") is None
    assert build_whatsapp_url(None, "Hello") is None

    # Invalid numbers (too short, landlines starting with 011, invalid non-digits)
    assert normalize_indian_phone("12345") is None
    assert normalize_indian_phone("0112345678") is None  # not mobile (starts with 2)
    assert normalize_indian_phone("abcde") is None
    assert normalize_indian_phone("5555555555") is None  # doesn't start with 6-9
    assert build_whatsapp_url("12345", "Hello") is None


# --- 7. Gemma failure falls back to a usable reminder message ---


@pytest.mark.anyio
async def test_gemma_failure_fallback_message():
    # When Gemma throws an exception
    with patch("app.services.gemma.generate_text", new=AsyncMock(side_effect=Exception("API connection timeout"))):
        draft_hi, is_fallback_hi = await draft_reminder_message("Ramesh", 750.0, language="hi")
        assert is_fallback_hi is True
        assert "Ramesh" in draft_hi
        assert "750" in draft_hi
        assert "नमस्ते" in draft_hi

        draft_mr, is_fallback_mr = await draft_reminder_message("Suresh", 1500.0, language="mr")
        assert is_fallback_mr is True
        assert "Suresh" in draft_mr
        assert "1,500" in draft_mr
        assert "नमस्कार" in draft_mr

        draft_en, is_fallback_en = await draft_reminder_message("Deepak", 300.0, language="en")
        assert is_fallback_en is True
        assert "Deepak" in draft_en
        assert "300" in draft_en
        assert "pending balance" in draft_en


# --- 8. API Endpoints: /api/alerts and /api/reminders/draft ---


def test_alerts_and_reminders_api_endpoints(db_session: Session):
    from fastapi.testclient import TestClient
    from app.db import get_session

    def override_session():
        yield db_session

    app.dependency_overrides[get_session] = override_session

    try:
        client = TestClient(app)

        # 1. Seed customer with positive balance and phone
        c = Customer(shop_id=1, name="Kailash Sharma", phone="9876543210", language="hi")
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)

        db_session.add(
            CreditEntry(
                shop_id=1,
                customer_id=c.id,
                amount=850.0,
                type=CreditType.gave,
                entry_date=date.today() - timedelta(days=35),
                confirmed=True,
            )
        )
        db_session.commit()

        # 2. Seed low stock product
        p = Product(shop_id=1, name="Chana Besan 1kg", unit="packet", low_stock_threshold=10.0)
        db_session.add(p)
        db_session.commit()
        db_session.refresh(p)
        db_session.add(
            StockEntry(shop_id=1, product_id=p.id, kind=StockEntryKind.purchase, qty_change=2.0, confirmed=True)
        )
        db_session.commit()

        # 3. Test GET /api/alerts
        res_alerts = client.get("/api/alerts")
        assert res_alerts.status_code == 200
        alerts_data = res_alerts.json()
        assert alerts_data["total_alerts"] == 2
        assert len(alerts_data["low_stock_alerts"]) == 1
        assert alerts_data["low_stock_alerts"][0]["product_name"] == "Chana Besan 1kg"
        assert len(alerts_data["overdue_udhaar_alerts"]) == 1
        assert alerts_data["overdue_udhaar_alerts"][0]["customer_name"] == "Kailash Sharma"

        # 4. Test POST /api/reminders/draft (with mock Gemma)
        mock_gemma_reply = "नमस्ते कैलाश शर्मा जी, आपकी ₹850 की उधारी बाकी है। कृपया जल्द भुगतान करें।"
        with patch("app.services.gemma.generate_text", new=AsyncMock(return_value=mock_gemma_reply)):
            res_draft = client.post("/api/reminders/draft", json={"customer_id": c.id})
            assert res_draft.status_code == 200
            draft_data = res_draft.json()
            assert draft_data["customer_name"] == "Kailash Sharma"
            assert draft_data["is_phone_valid"] is True
            assert draft_data["normalized_phone"] == "919876543210"
            assert draft_data["whatsapp_url"].startswith("https://wa.me/919876543210?text=")
            assert draft_data["message"] == mock_gemma_reply
            assert draft_data["is_fallback"] is False

        # 5. Test GET /api/customers/{id}/reminder
        with patch("app.services.gemma.generate_text", new=AsyncMock(return_value=mock_gemma_reply)):
            res_get_reminder = client.get(f"/api/customers/{c.id}/reminder")
            assert res_get_reminder.status_code == 200
            assert res_get_reminder.json()["customer_id"] == c.id

        # 6. Test GET /api/overview includes alert lists
        res_ov = client.get("/api/overview")
        assert res_ov.status_code == 200
        ov_data = res_ov.json()
        assert "low_stock_alerts" in ov_data
        assert "overdue_alerts" in ov_data
        assert len(ov_data["low_stock_alerts"]) == 1
        assert len(ov_data["overdue_alerts"]) == 1

    finally:
        app.dependency_overrides.clear()
