import datetime as dt
import uuid
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db import get_session, get_shop
from app.models import (
    Confidence,
    Product,
    ShelfStatus,
    StockEntry,
    StockEntryKind,
    SupplierBill,
)
from app.services.bill import extract_bill
from app.services.gemma import GemmaError
from app.services.matching import match_product
from app.services.shelf import assess_shelf
from app.services.stock import (
    get_product_stock_history,
    list_shop_products,
)

router = APIRouter(prefix="/api/stock", tags=["stock"])

UPLOAD_DIR = Path("uploads")
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


# --- Phase 2A/2B: Supplier Bill Schemas ---


class ExtractedItemWithMatch(BaseModel):
    item_name: str
    quantity: float
    unit: str
    rate: Optional[float] = None
    line_total: float
    raw_text: str = ""
    confidence: Literal["high", "low"] = "high"
    needs_confirmation: bool = False
    line_mismatch: bool = False
    suggested_product_id: Optional[int] = None
    suggested_product_name: Optional[str] = None
    match_score: float = 0.0


class BillExtractResponse(BaseModel):
    source_image: str
    confirmation_token: str
    supplier_name: Optional[str] = None
    bill_date: Optional[str] = None
    items: list[ExtractedItemWithMatch]
    stated_total: Optional[float] = None
    calculated_total: float
    has_total_mismatch: bool = False
    discrepancy_details: Optional[str] = None


class ConfirmBillItem(BaseModel):
    product_id: Optional[int] = None
    new_product_name: Optional[str] = None
    unit: str = "pcs"
    quantity: float = Field(gt=0)
    rate: Optional[float] = None
    line_total: Optional[float] = None
    raw_text: str = ""
    confidence: Literal["high", "low"] = "high"


class ConfirmBillRequest(BaseModel):
    confirmation_token: str
    source_image: Optional[str] = None
    supplier_name: Optional[str] = None
    bill_date: Optional[dt.date] = None
    stated_total: Optional[float] = None
    calculated_total: Optional[float] = None
    items: list[ConfirmBillItem]


# --- Phase 2D: Shelf Assessment Schemas ---


class ShelfItemWithMatch(BaseModel):
    product_name: str
    stock_status: Literal["low", "medium", "full"]
    visual_evidence: str
    confidence: Literal["high", "low"] = "high"
    uncertainty: Optional[str] = None
    suggested_product_id: Optional[int] = None
    suggested_product_name: Optional[str] = None
    match_score: float = 0.0


class ShelfAssessResponse(BaseModel):
    source_image: str
    items: list[ShelfItemWithMatch]


class ConfirmShelfItem(BaseModel):
    product_id: Optional[int] = None
    new_product_name: Optional[str] = None
    stock_status: Literal["low", "medium", "full"]
    visual_evidence: str = ""
    source_image: Optional[str] = None


class ConfirmShelfRequest(BaseModel):
    items: list[ConfirmShelfItem]


# --- Endpoints ---


@router.post("/bills/extract", response_model=BillExtractResponse)
async def extract_supplier_bill(
    file: UploadFile,
    session: Session = Depends(get_session),
):
    """Read a supplier bill photo. Returns items with calculations and fuzzy product matches."""
    if file.content_type not in EXTENSIONS:
        raise HTTPException(400, "Please upload a JPG, PNG or WEBP photo.")
    image = await file.read()
    if len(image) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Photo is larger than 10 MB.")

    UPLOAD_DIR.mkdir(exist_ok=True)
    filename = f"bill_{uuid.uuid4().hex[:12]}{EXTENSIONS[file.content_type]}"
    (UPLOAD_DIR / filename).write_bytes(image)

    try:
        processed = await extract_bill(image)
    except GemmaError as e:
        raise HTTPException(502, f"Could not read the supplier bill: {e}")

    shop = get_shop(session)
    existing_products = session.exec(
        select(Product).where(Product.shop_id == shop.id)
    ).all()

    items_with_matches = []
    for item in processed.items:
        best_prod, score = match_product(item.item_name, existing_products)
        items_with_matches.append(
            ExtractedItemWithMatch(
                item_name=item.item_name,
                quantity=item.quantity,
                unit=item.unit,
                rate=item.rate,
                line_total=item.line_total,
                raw_text=item.raw_text,
                confidence=item.confidence,
                needs_confirmation=item.needs_confirmation,
                line_mismatch=item.line_mismatch,
                suggested_product_id=best_prod.id if best_prod else None,
                suggested_product_name=best_prod.name if best_prod else None,
                match_score=score,
            )
        )

    return BillExtractResponse(
        source_image=f"/uploads/{filename}",
        confirmation_token=uuid.uuid4().hex,
        supplier_name=processed.supplier_name,
        bill_date=processed.bill_date,
        items=items_with_matches,
        stated_total=processed.stated_total,
        calculated_total=processed.calculated_total,
        has_total_mismatch=processed.has_total_mismatch,
        discrepancy_details=processed.discrepancy_details,
    )


@router.post("/bills/confirm")
def confirm_supplier_bill(
    req: ConfirmBillRequest,
    session: Session = Depends(get_session),
):
    """Save the confirmed supplier bill and create StockEntry records inside a single transaction.

    Idempotency: if the confirmation_token was already confirmed, do not double-add stock.
    """
    shop = get_shop(session)

    # Idempotency check
    existing_bill = session.exec(
        select(SupplierBill).where(
            SupplierBill.shop_id == shop.id,
            SupplierBill.confirmation_token == req.confirmation_token,
        )
    ).first()
    if existing_bill:
        return {
            "status": "already_confirmed",
            "bill_id": existing_bill.id,
            "message": "This bill has already been confirmed.",
        }

    try:
        bill = SupplierBill(
            shop_id=shop.id,
            supplier_name=req.supplier_name.strip() if req.supplier_name else None,
            bill_date=req.bill_date or dt.date.today(),
            stated_total=req.stated_total,
            calculated_total=req.calculated_total,
            source_image=req.source_image,
            confirmation_token=req.confirmation_token,
            confirmed=True,
        )
        session.add(bill)
        session.flush()

        for item in req.items:
            # Resolve product
            if item.product_id:
                product = session.get(Product, item.product_id)
                if not product or product.shop_id != shop.id:
                    raise HTTPException(400, f"Product ID {item.product_id} not found in this shop.")
            elif item.new_product_name and item.new_product_name.strip():
                product = Product(
                    shop_id=shop.id,
                    name=item.new_product_name.strip(),
                    unit=item.unit or "pcs",
                )
                session.add(product)
                session.flush()
            else:
                raise HTTPException(400, "Item requires a valid product_id or new_product_name.")

            # Add confirmed stock purchase entry
            entry = StockEntry(
                shop_id=shop.id,
                product_id=product.id,
                supplier_bill_id=bill.id,
                kind=StockEntryKind.purchase,
                qty_change=item.quantity,
                rate=item.rate,
                raw_text=item.raw_text,
                source_image=req.source_image,
                confidence=Confidence(item.confidence),
                confirmed=True,
            )
            session.add(entry)

        session.commit()
    except Exception:
        session.rollback()
        raise

    return {
        "status": "success",
        "bill_id": bill.id,
        "items_confirmed": len(req.items),
    }


@router.post("/shelf/assess", response_model=ShelfAssessResponse)
async def assess_shelf_image(
    file: UploadFile,
    session: Session = Depends(get_session),
):
    """Analyze a shelf photo for qualitative stock status (low/medium/full). Does not count exact numbers."""
    if file.content_type not in EXTENSIONS:
        raise HTTPException(400, "Please upload a JPG, PNG or WEBP photo.")
    image = await file.read()
    if len(image) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Photo is larger than 10 MB.")

    UPLOAD_DIR.mkdir(exist_ok=True)
    filename = f"shelf_{uuid.uuid4().hex[:12]}{EXTENSIONS[file.content_type]}"
    (UPLOAD_DIR / filename).write_bytes(image)

    try:
        extraction = await assess_shelf(image)
    except GemmaError as e:
        raise HTTPException(502, f"Could not assess shelf photo: {e}")

    shop = get_shop(session)
    existing_products = session.exec(
        select(Product).where(Product.shop_id == shop.id)
    ).all()

    items_with_matches = []
    for item in extraction.items:
        best_prod, score = match_product(item.product_name, existing_products)
        items_with_matches.append(
            ShelfItemWithMatch(
                product_name=item.product_name,
                stock_status=item.stock_status,
                visual_evidence=item.visual_evidence,
                confidence=item.confidence,
                uncertainty=item.uncertainty,
                suggested_product_id=best_prod.id if best_prod else None,
                suggested_product_name=best_prod.name if best_prod else None,
                match_score=score,
            )
        )

    return ShelfAssessResponse(
        source_image=f"/uploads/{filename}",
        items=items_with_matches,
    )


@router.post("/shelf/confirm")
def confirm_shelf_assessment(
    req: ConfirmShelfRequest,
    session: Session = Depends(get_session),
):
    """Save confirmed shelf observations. Creates shelf_check entries with qty_change = 0 (never touches counted inventory)."""
    shop = get_shop(session)

    try:
        for item in req.items:
            if item.product_id:
                product = session.get(Product, item.product_id)
                if not product or product.shop_id != shop.id:
                    raise HTTPException(400, f"Product ID {item.product_id} not found in this shop.")
            elif item.new_product_name and item.new_product_name.strip():
                product = Product(
                    shop_id=shop.id,
                    name=item.new_product_name.strip(),
                    unit="pcs",
                )
                session.add(product)
                session.flush()
            else:
                continue

            entry = StockEntry(
                shop_id=shop.id,
                product_id=product.id,
                kind=StockEntryKind.shelf_check,
                qty_change=0.0,  # CRITICAL: shelf assessments never alter recorded quantity
                rate=None,
                shelf_status=ShelfStatus(item.stock_status),
                raw_text=item.visual_evidence,
                source_image=item.source_image,
                confidence=Confidence.high,
                confirmed=True,
            )
            session.add(entry)

        session.commit()
    except Exception:
        session.rollback()
        raise

    return {"status": "success", "saved": len(req.items)}


@router.get("/products")
def get_products(session: Session = Depends(get_session)):
    """List all products with stock totals, shelf status, and recent update info."""
    shop = get_shop(session)
    return {"products": list_shop_products(session, shop.id)}


@router.get("/products/{product_id}/history")
def get_product_history(product_id: int, session: Session = Depends(get_session)):
    """Get complete audit history of stock events for a specific product."""
    product = session.get(Product, product_id)
    if not product or product.shop_id != get_shop(session).id:
        raise HTTPException(404, "Product not found")

    return {
        "product": product,
        "history": get_product_stock_history(session, product_id),
    }
