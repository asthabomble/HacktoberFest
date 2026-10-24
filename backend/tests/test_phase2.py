"""Automated tests for Phase 2: Supplier Bill + Shelf -> Stock.

Tests all 10 requirements:
1. Valid supplier bill extraction using a mocked Gemma response.
2. Invalid Gemma JSON: retry once, then return a clear error.
3. Bill line-total and bill-total mismatch detection.
4. Editing/correcting extracted bill values before confirmation.
5. Fuzzy product matching and unmatched products.
6. Confirmed bill creates stock entries correctly.
7. Repeated confirmation does not double-add stock (idempotency).
8. Transaction rollback if a stock update fails.
9. Shelf assessment returns only low/medium/full, not exact counts.
10. Shelf visual assessment does not modify recorded quantity.
"""

from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import BaseModel, ValidationError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.db import get_session, get_shop
from app.main import app
from app.models import Product, ShelfStatus, Shop, StockEntry, StockEntryKind, SupplierBill
from app.routers.stock import ConfirmBillItem, ConfirmBillRequest, ConfirmShelfItem, ConfirmShelfRequest
from app.services import gemma
from app.services.bill import BillExtraction, ExtractedBillItem, extract_bill, process_bill_extraction
from app.services.gemma import GemmaError
from app.services.matching import calculate_similarity, match_product
from app.services.shelf import ShelfExtraction, ShelfItemAssessment, assess_shelf
from app.services.stock import calculate_product_stock, list_shop_products

# --- Test DB Setup ---

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
        # Create default demo shop
        shop = Shop(id=1, name="Sharma Kirana Store", owner_name="Sharma ji")
        session.add(shop)
        session.commit()
        session.refresh(shop)
        yield session
    SQLModel.metadata.drop_all(engine)


# --- 1. Valid Supplier Bill Extraction ---


@pytest.mark.anyio
async def test_valid_supplier_bill_extraction():
    mock_extraction = BillExtraction(
        supplier_name="Ramesh Wholesale Trader",
        bill_date="2026-10-20",
        items=[
            ExtractedBillItem(
                item_name="Sugar M-30",
                quantity=50.0,
                unit="kg",
                rate=42.0,
                line_total=2100.0,
                raw_text="Sugar M-30 50kg @ 42 = 2100",
                confidence="high",
            ),
            ExtractedBillItem(
                item_name="Fortune Sunflower Oil 1L",
                quantity=10.0,
                unit="pcs",
                rate=135.0,
                line_total=1350.0,
                raw_text="Fortune Oil 1L x 10 = 1350",
                confidence="high",
            ),
        ],
        bill_total=3450.0,
    )

    with patch("app.services.gemma.generate_json", new=AsyncMock(return_value=mock_extraction)):
        result = await extract_bill(b"fake_image_bytes")

        assert result.supplier_name == "Ramesh Wholesale Trader"
        assert result.bill_date == "2026-10-20"
        assert len(result.items) == 2
        assert result.items[0].item_name == "Sugar M-30"
        assert result.items[0].quantity == 50.0
        assert result.items[0].rate == 42.0
        assert result.items[0].line_total == 2100.0
        assert result.calculated_total == 3450.0
        assert result.has_total_mismatch is False


# --- 2. Invalid Gemma JSON Retry Once Then Error ---


@pytest.mark.anyio
async def test_invalid_gemma_json_retry():
    class DummySchema(BaseModel):
        val: int

    mock_provider = AsyncMock()
    # First returns invalid JSON, second also returns invalid JSON
    mock_provider.generate = AsyncMock(side_effect=["Not JSON at all", "{invalid: json}"])

    with patch("app.services.gemma.get_provider", return_value=mock_provider):
        with pytest.raises(GemmaError) as exc_info:
            await gemma.generate_json("Test prompt", DummySchema)

        assert "Model returned invalid JSON twice" in str(exc_info.value)
        # Verify provider.generate was called exactly twice (1 retry)
        assert mock_provider.generate.call_count == 2


# --- 3. Bill Line-Total and Bill-Total Mismatch Detection ---


def test_bill_mismatch_detection():
    # Item 1: quantity=10, rate=50, but stated line total is 600 (should be 500)
    # Item 2: quantity=5, rate=100, line total is 500
    # Calculated total = 500 + 500 = 1000. Stated bill_total = 1200.
    extraction = BillExtraction(
        supplier_name="Gupta Agencies",
        bill_date="2026-10-22",
        items=[
            ExtractedBillItem(
                item_name="Chana Dal",
                quantity=10.0,
                rate=50.0,
                line_total=600.0,  # 10 * 50 = 500 != 600!
                raw_text="Chana Dal 10 x 50 = 600",
                confidence="high",
            ),
            ExtractedBillItem(
                item_name="Moong Dal",
                quantity=5.0,
                rate=100.0,
                line_total=500.0,
                raw_text="Moong Dal 5 x 100 = 500",
                confidence="high",
            ),
        ],
        bill_total=1200.0,  # Sum is 1000 != 1200!
    )

    processed = process_bill_extraction(extraction)

    # Item 1 line mismatch should be detected
    assert processed.items[0].line_mismatch is True
    assert processed.items[0].confidence == "low"
    assert processed.items[0].needs_confirmation is True
    # Line total uses Python-calculated value (10 * 50 = 500)
    assert processed.items[0].line_total == 500.0

    # Total mismatch should be flagged
    assert processed.calculated_total == 1000.0
    assert processed.stated_total == 1200.0
    assert processed.has_total_mismatch is True
    assert "Bill states ₹1,200.00, but sum of item totals is ₹1,000.00" in processed.discrepancy_details


# --- 4. Editing/Correcting Extracted Bill Values Before Confirmation ---


def test_editing_extracted_bill_values(db_session: Session):
    from app.routers.stock import confirm_supplier_bill

    # Shopkeeper manually corrects supplier name, quantity, and adds a product
    req = ConfirmBillRequest(
        confirmation_token="token_edit_test",
        supplier_name="Sharmaji Corrected Traders",
        bill_date=date(2026, 10, 24),
        stated_total=1500.0,
        calculated_total=1500.0,
        items=[
            ConfirmBillItem(
                new_product_name="Aashirvaad Atta 10kg",
                unit="packet",
                quantity=4.0,  # Shopkeeper corrected quantity from 3 to 4
                rate=375.0,
                line_total=1500.0,
                raw_text="Atta 10kg x 4",
                confidence="high",
            )
        ],
    )

    res = confirm_supplier_bill(req, session=db_session)
    assert res["status"] == "success"

    # Verify saved bill has the corrected name
    bill = db_session.exec(select(SupplierBill).where(SupplierBill.confirmation_token == "token_edit_test")).first()
    assert bill is not None
    assert bill.supplier_name == "Sharmaji Corrected Traders"

    # Verify product was created and stock matches edited quantity 4.0
    prod = db_session.exec(select(Product).where(Product.name == "Aashirvaad Atta 10kg")).first()
    assert prod is not None
    assert calculate_product_stock(db_session, prod.id) == 4.0


# --- 5. Fuzzy Product Matching and Unmatched Products ---


def test_fuzzy_product_matching(db_session: Session):
    p1 = Product(shop_id=1, name="Tata Salt 1kg", unit="packet")
    p2 = Product(shop_id=1, name="Red Label Tea 500g", unit="packet")
    db_session.add(p1)
    db_session.add(p2)
    db_session.commit()
    db_session.refresh(p1)
    db_session.refresh(p2)

    prods = [p1, p2]

    # Test good match: "tata salt" -> Tata Salt 1kg
    match, score = match_product("Tata Salt", prods, threshold=0.55)
    assert match is not None
    assert match.id == p1.id
    assert score >= 0.70

    # Test distinguishing variants: "Red Label Tea 250g" vs "Red Label Tea 500g"
    score_diff_variants = calculate_similarity("Red Label Tea 250g", "Red Label Tea 500g")
    assert score_diff_variants < 0.75  # variant penalty applied

    # Test unmatched product: completely different item
    unmatched, score_unmatched = match_product("Dettol Soap 75g", prods, threshold=0.55)
    assert unmatched is None
    assert score_unmatched < 0.55


# --- 6. Confirmed Bill Creates Stock Entries Correctly ---


def test_confirmed_bill_creates_stock_entries(db_session: Session):
    from app.routers.stock import confirm_supplier_bill

    # Create existing product
    prod = Product(shop_id=1, name="Parle-G 250g", unit="pcs")
    db_session.add(prod)
    db_session.commit()
    db_session.refresh(prod)

    req = ConfirmBillRequest(
        confirmation_token="token_stock_add_test",
        supplier_name="National Biscuit Depot",
        bill_date=date(2026, 10, 24),
        items=[
            ConfirmBillItem(
                product_id=prod.id,
                unit="pcs",
                quantity=24.0,
                rate=20.0,
                line_total=480.0,
                raw_text="Parle-G 250g 24 @ 20",
                confidence="high",
            )
        ],
    )

    res = confirm_supplier_bill(req, session=db_session)
    assert res["status"] == "success"

    # Verify StockEntry created
    entry = db_session.exec(
        select(StockEntry).where(
            StockEntry.product_id == prod.id,
            StockEntry.kind == StockEntryKind.purchase,
        )
    ).first()
    assert entry is not None
    assert entry.qty_change == 24.0
    assert entry.rate == 20.0
    assert entry.confirmed is True

    # Verify current stock equals 24.0
    assert calculate_product_stock(db_session, prod.id) == 24.0


# --- 7. Repeated Confirmation Does Not Double-Add Stock (Idempotency) ---


def test_repeated_confirmation_does_not_double_add_stock(db_session: Session):
    from app.routers.stock import confirm_supplier_bill

    token = "token_idempotency_123"
    req = ConfirmBillRequest(
        confirmation_token=token,
        supplier_name="Anand Wholesale",
        bill_date=date(2026, 10, 24),
        items=[
            ConfirmBillItem(
                new_product_name="Maggi Noodles 70g",
                unit="pcs",
                quantity=50.0,
                rate=12.0,
                line_total=600.0,
                confidence="high",
            )
        ],
    )

    # First confirmation
    res1 = confirm_supplier_bill(req, session=db_session)
    assert res1["status"] == "success"

    prod = db_session.exec(select(Product).where(Product.name == "Maggi Noodles 70g")).first()
    assert calculate_product_stock(db_session, prod.id) == 50.0

    # Second confirmation with the exact same confirmation_token (user pressed submit again or retried)
    res2 = confirm_supplier_bill(req, session=db_session)
    assert res2["status"] == "already_confirmed"

    # Stock must NOT be 100.0! Must remain 50.0
    assert calculate_product_stock(db_session, prod.id) == 50.0

    # Ensure only 1 StockEntry was created
    entries = db_session.exec(select(StockEntry).where(StockEntry.product_id == prod.id)).all()
    assert len(entries) == 1


# --- 8. Transaction Rollback if a Stock Update Fails ---


def test_transaction_rollback_if_update_fails(db_session: Session):
    from fastapi import HTTPException
    from app.routers.stock import confirm_supplier_bill

    initial_bills = len(db_session.exec(select(SupplierBill)).all())
    initial_entries = len(db_session.exec(select(StockEntry)).all())

    # Request has one valid item and one item with an invalid nonexistent product_id (99999)
    req = ConfirmBillRequest(
        confirmation_token="token_fail_rollback",
        supplier_name="Faulty Supplier",
        bill_date=date(2026, 10, 24),
        items=[
            ConfirmBillItem(
                new_product_name="Item 1 Valid",
                unit="pcs",
                quantity=10.0,
                confidence="high",
            ),
            ConfirmBillItem(
                product_id=99999,  # does not exist!
                unit="pcs",
                quantity=5.0,
                confidence="high",
            ),
        ],
    )

    with pytest.raises(HTTPException):
        confirm_supplier_bill(req, session=db_session)

    # Verify transaction rolled back: no bill was created, and no stock entries were saved
    final_bills = len(db_session.exec(select(SupplierBill)).all())
    final_entries = len(db_session.exec(select(StockEntry)).all())
    assert final_bills == initial_bills
    assert final_entries == initial_entries

    # "Item 1 Valid" should NOT exist in products
    prod = db_session.exec(select(Product).where(Product.name == "Item 1 Valid")).first()
    assert prod is None


# --- 9. Shelf Assessment Returns Only Low/Medium/Full, Not Exact Counts ---


@pytest.mark.anyio
async def test_shelf_assessment_status_values():
    mock_shelf = ShelfExtraction(
        items=[
            ShelfItemAssessment(
                product_name="Parle-G 100g",
                stock_status="low",
                visual_evidence="Only 2 packets left on bottom tray with empty shelf space",
                confidence="high",
                uncertainty=None,
            ),
            ShelfItemAssessment(
                product_name="Good Day Butter Cookies",
                stock_status="full",
                visual_evidence="Multiple stacked rows filling the shelf",
                confidence="high",
                uncertainty="Top row slightly occluded by price tag",
            ),
        ]
    )

    with patch("app.services.gemma.generate_json", new=AsyncMock(return_value=mock_shelf)):
        result = await assess_shelf(b"fake_shelf_image")

        assert len(result.items) == 2
        for item in result.items:
            # Status must strictly be one of low, medium, full
            assert item.stock_status in ("low", "medium", "full")
            # Must not contain numerical count fields
            assert not hasattr(item, "quantity")
            assert not hasattr(item, "exact_count")


# --- 10. Shelf Visual Assessment Does Not Modify Recorded Quantity ---


def test_shelf_assessment_does_not_modify_recorded_quantity(db_session: Session):
    from app.routers.stock import confirm_shelf_assessment

    # Setup product with established stock = 30.0
    prod = Product(shop_id=1, name="Basmati Rice 5kg", unit="packet")
    db_session.add(prod)
    db_session.commit()
    db_session.refresh(prod)

    # Add initial purchase
    purchase_entry = StockEntry(
        shop_id=1,
        product_id=prod.id,
        kind=StockEntryKind.purchase,
        qty_change=30.0,
        confirmed=True,
    )
    db_session.add(purchase_entry)
    db_session.commit()

    assert calculate_product_stock(db_session, prod.id) == 30.0

    # Now assess shelf: visual status is "low" (e.g. shelf only has 1 bag on display, remainder in backroom)
    shelf_req = ConfirmShelfRequest(
        items=[
            ConfirmShelfItem(
                product_id=prod.id,
                stock_status="low",
                visual_evidence="Front display shelf is nearly empty, only 1 packet visible",
                source_image="/uploads/shelf_sample.jpg",
            )
        ]
    )

    res = confirm_shelf_assessment(shelf_req, session=db_session)
    assert res["status"] == "success"

    # CRITICAL CHECK: Recorded quantity MUST STILL BE 30.0! (Not 1, not 0, not reduced)
    assert calculate_product_stock(db_session, prod.id) == 30.0

    # Check product listing shows the visual shelf status as "low" without corrupting inventory
    prods = list_shop_products(db_session, shop_id=1)
    rice = next(p for p in prods if p["id"] == prod.id)
    assert rice["current_stock"] == 30.0
    assert rice["shelf_status"] == "low"
    assert rice["shelf_evidence"] == "Front display shelf is nearly empty, only 1 packet visible"
    assert rice["last_source"] == "shelf_assessment"


def test_stock_products_api_endpoints(db_session: Session):
    from fastapi.testclient import TestClient
    from app.db import get_session

    def override_session():
        yield db_session

    app.dependency_overrides[get_session] = override_session

    try:
        client = TestClient(app)

        # 1. Add product to test DB
        prod = Product(shop_id=1, name="Kisan Jam 500g", unit="bottle")
        db_session.add(prod)
        db_session.commit()
        db_session.refresh(prod)

        # 2. Add confirmed purchase
        db_session.add(
            StockEntry(
                shop_id=1,
                product_id=prod.id,
                kind=StockEntryKind.purchase,
                qty_change=12.0,
                rate=95.0,
                confirmed=True,
            )
        )
        db_session.commit()

        # 3. GET /api/stock/products
        res = client.get("/api/stock/products")
        assert res.status_code == 200
        data = res.json()
        assert "products" in data
        item = next(p for p in data["products"] if p["id"] == prod.id)
        assert item["name"] == "Kisan Jam 500g"
        assert item["current_stock"] == 12.0

        # 4. GET /api/stock/products/{id}/history
        res_hist = client.get(f"/api/stock/products/{prod.id}/history")
        assert res_hist.status_code == 200
        hist_data = res_hist.json()
        assert hist_data["product"]["id"] == prod.id
        assert len(hist_data["history"]) == 1
        assert hist_data["history"][0]["qty_change"] == 12.0
    finally:
        app.dependency_overrides.clear()


def test_phase1_khata_and_ledger_preserved(db_session: Session):
    from fastapi.testclient import TestClient
    from app.db import get_session
    from app.models import Customer, CreditEntry, CreditType

    def override_session():
        yield db_session

    app.dependency_overrides[get_session] = override_session

    try:
        client = TestClient(app)

        # 1. Post to /api/khata/confirm
        confirm_payload = {
            "source_image": "/uploads/khata_demo.jpg",
            "rows": [
                {
                    "customer_name": "Ramesh Kumar",
                    "amount": 500.0,
                    "type": "gave",
                    "date": "2026-10-24",
                    "raw_text": "Ramesh udhaar 500",
                    "confidence": "high",
                },
                {
                    "customer_name": "Ramesh Kumar",
                    "amount": 200.0,
                    "type": "got",
                    "date": "2026-10-24",
                    "raw_text": "Ramesh jama 200",
                    "confidence": "high",
                },
            ],
        }
        res_confirm = client.post("/api/khata/confirm", json=confirm_payload)
        assert res_confirm.status_code == 200
        assert res_confirm.json()["saved"] == 2
        assert res_confirm.json()["new_customers"] == 1

        # 2. Verify GET /api/customers balance = 500 - 200 = 300
        res_cust = client.get("/api/customers")
        assert res_cust.status_code == 200
        cust_data = res_cust.json()
        assert cust_data["total_outstanding"] == 300.0
        cust = cust_data["customers"][0]
        assert cust["name"] == "Ramesh Kumar"
        assert cust["balance"] == 300.0

        # 3. Verify GET /api/customers/{id}/ledger
        res_ledger = client.get(f"/api/customers/{cust['id']}/ledger")
        assert res_ledger.status_code == 200
        ledger_data = res_ledger.json()
        assert ledger_data["balance"] == 300.0
        assert len(ledger_data["entries"]) == 2
        assert ledger_data["entries"][-1]["running_balance"] == 300.0
    finally:
        app.dependency_overrides.clear()
