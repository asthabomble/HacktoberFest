import datetime as dt
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from app.db import get_session, get_shop
from app.models import Confidence, CreditEntry, CreditType, Customer, ShorthandKind
from app.services import shorthand
from app.services.gemma import GemmaError
from app.services.khata import ResolvedRow, extract_rows
from app.services.matching import normalize_text
from app.services.names import name_key

router = APIRouter(prefix="/api/khata", tags=["khata"])

UPLOAD_DIR = Path("uploads")
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def find_customer(session: Session, shop_id: int, name: str) -> Customer | None:
    """Same customer if the name matches ignoring case, spaces and punctuation."""
    exact = session.exec(
        select(Customer).where(Customer.shop_id == shop_id, func.lower(Customer.name) == name.strip().lower())
    ).first()
    if exact:
        return exact
    key = normalize_text(name)
    return next(
        (c for c in session.exec(select(Customer).where(Customer.shop_id == shop_id)).all() if normalize_text(c.name) == key),
        None,
    )


class ExtractResponse(BaseModel):
    source_image: str
    rows: list[ResolvedRow]


@router.post("/extract", response_model=ExtractResponse)
async def extract(file: UploadFile, session: Session = Depends(get_session)):
    """Read a khata photo. Nothing is saved to the ledger here; the user confirms first."""
    if file.content_type not in EXTENSIONS:
        raise HTTPException(400, "Please upload a JPG, PNG or WEBP photo.")
    image = await file.read()
    if len(image) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Photo is larger than 10 MB.")

    UPLOAD_DIR.mkdir(exist_ok=True)
    filename = f"khata_{uuid.uuid4().hex[:12]}{EXTENSIONS[file.content_type]}"
    (UPLOAD_DIR / filename).write_bytes(image)

    shop = get_shop(session)
    customers = session.exec(select(Customer.name).where(Customer.shop_id == shop.id)).all()
    try:
        rows = await extract_rows(
            image,
            shop_context=shorthand.khata_context(session, shop.id),
            customers=list(customers),
            shorthand=shorthand.lookup(session, shop.id, ShorthandKind.customer),
        )
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
    written_name: str = ""  # what the photo said; if the user changed it, we learn the shorthand


class ConfirmRequest(BaseModel):
    source_image: str | None = None
    rows: list[ConfirmRow]


@router.post("/confirm")
def confirm(req: ConfirmRequest, session: Session = Depends(get_session)):
    """Save the rows the user checked on the confirm screen, and learn from their corrections."""
    shop = get_shop(session)
    created_customers = 0
    learned = 0
    for row in req.rows:
        # "Rmsh" confirmed as "Ramesh bhau" -> remember it. Skip pure honorific differences ("Sunita" vs "Sunita tai").
        if (
            row.written_name
            and name_key(row.written_name) != name_key(row.customer_name)
            and shorthand.learn(session, shop.id, row.written_name, row.customer_name.strip(), ShorthandKind.customer)
        ):
            learned += 1
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
    return {"saved": len(req.rows), "new_customers": created_customers, "learned": learned}
