"""Alerts and Reminders API router.

Endpoints:
- GET /api/alerts: rule-based low-stock and overdue-udhaar alerts
- POST /api/reminders/draft: generate Gemma/fallback WhatsApp reminder
- GET /api/customers/{customer_id}/reminder: generate reminder for customer
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session

from app.db import get_session, get_shop
from app.models import Customer
from app.services.alerts import (
    OVERDUE_DAYS,
    get_all_alerts,
    get_low_stock_alerts,
    get_overdue_udhaar_alerts,
)
from app.services.ledger import customer_summaries
from app.services.reminders import (
    build_whatsapp_url,
    draft_reminder_message,
    normalize_indian_phone,
)

router = APIRouter(prefix="/api", tags=["alerts", "reminders"])


class DraftReminderRequest(BaseModel):
    customer_id: int
    language: Optional[str] = None


class DraftReminderResponse(BaseModel):
    customer_id: int
    customer_name: str
    phone: Optional[str] = None
    normalized_phone: Optional[str] = None
    is_phone_valid: bool
    balance: float
    language: str
    message: str
    whatsapp_url: Optional[str] = None
    is_fallback: bool


@router.get("/alerts")
def list_alerts(
    overdue_days: int = Query(default=OVERDUE_DAYS, ge=1),
    session: Session = Depends(get_session),
):
    """Return all low-stock and overdue udhaar alerts."""
    shop = get_shop(session)
    return get_all_alerts(session, shop.id, overdue_days=overdue_days)


@router.post("/reminders/draft", response_model=DraftReminderResponse)
async def draft_reminder(
    req: DraftReminderRequest,
    session: Session = Depends(get_session),
):
    """Draft a polite WhatsApp reminder via Gemma in the customer's language."""
    shop = get_shop(session)
    customer = session.get(Customer, req.customer_id)
    if not customer or customer.shop_id != shop.id:
        raise HTTPException(404, "Customer not found")

    summaries = customer_summaries(session, shop.id)
    cust_summary = next((c for c in summaries if c["id"] == customer.id), None)
    balance = cust_summary["balance"] if cust_summary else 0.0

    if balance <= 0:
        raise HTTPException(400, "Customer does not have a positive outstanding balance.")

    lang = req.language or getattr(customer, "language", None) or getattr(shop, "language", "hi") or "hi"
    draft, is_fallback = await draft_reminder_message(customer.name, balance, lang)
    normalized = normalize_indian_phone(customer.phone)
    wa_url = build_whatsapp_url(customer.phone, draft)

    return DraftReminderResponse(
        customer_id=customer.id,
        customer_name=customer.name,
        phone=customer.phone,
        normalized_phone=normalized,
        is_phone_valid=bool(normalized),
        balance=balance,
        language=lang,
        message=draft,
        whatsapp_url=wa_url,
        is_fallback=is_fallback,
    )


@router.get("/customers/{customer_id}/reminder", response_model=DraftReminderResponse)
async def get_customer_reminder(
    customer_id: int,
    language: Optional[str] = None,
    session: Session = Depends(get_session),
):
    """Convenience GET endpoint to draft a reminder for a specific customer."""
    return await draft_reminder(DraftReminderRequest(customer_id=customer_id, language=language), session)
