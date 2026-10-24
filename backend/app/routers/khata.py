import datetime as dt
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from app.db import get_session, get_shop
from app.models import Confidence, CreditEntry, CreditType, Customer
from app.services.gemma import GemmaError
from app.services.khata import ExtractedRow, extract_rows

router = APIRouter(prefix="/api/khata", tags=["khata"])

UPLOAD_DIR = Path("uploads")
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def find_customer(session: Session, shop_id: int, name: str) -> Customer | None:
    return session.exec(
        select(Customer).where(Customer.shop_id == shop_id, func.lower(Customer.name) == name.strip().lower())
    ).first()


class ExtractResponse(BaseModel):
    source_image: str
    rows: list[ExtractedRow]


@router.post("/extract", response_model=ExtractResponse)
async def extract(file: UploadFile):
    """Read a khata photo. Nothing is saved to the ledger here; the user confirms first."""
    if file.content_type not in EXTENSIONS:
        raise HTTPException(400, "Please upload a JPG, PNG or WEBP photo.")
    image = await file.read()
    if len(image) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Photo is larger than 10 MB.")

    UPLOAD_DIR.mkdir(exist_ok=True)
    filename = f"khata_{uuid.uuid4().hex[:12]}{EXTENSIONS[file.content_type]}"
    (UPLOAD_DIR / filename).write_bytes(image)

    try:
        rows = await extract_rows(image)
    except GemmaError as e:
        raise HTTPException(502, f"Could not read the photo: {e}")
    return ExtractResponse(source_image=f"/uploads/{filename}", rows=rows)


class ConfirmRow(BaseModel):
    customer_name: str = Field(min_length=1)
    amount: float = Field(gt=0)
    type: Literal["gave", "got"]
    date: dt.date | None = None
    raw_text: str = ""
    confidence: Literal["high", "low"] = "high"


class ConfirmRequest(BaseModel):
    source_image: str | None = None
    rows: list[ConfirmRow]


@router.post("/confirm")
def confirm(req: ConfirmRequest, session: Session = Depends(get_session)):
    """Save the rows the user checked on the confirm screen."""
    shop = get_shop(session)
    created_customers = 0
    for row in req.rows:
        customer = find_customer(session, shop.id, row.customer_name)
        if customer is None:
            customer = Customer(shop_id=shop.id, name=row.customer_name.strip())
            session.add(customer)
            session.flush()
            created_customers += 1
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer.id,
                amount=row.amount,
                type=CreditType(row.type),
                entry_date=row.date or dt.date.today(),
                raw_text=row.raw_text,
                source_image=req.source_image,
                confidence=Confidence(row.confidence),
                confirmed=True,
            )
        )
    session.commit()
    return {"saved": len(req.rows), "new_customers": created_customers}
