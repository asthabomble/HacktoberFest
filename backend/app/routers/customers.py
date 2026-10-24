from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db import get_session, get_shop
from app.models import Customer, ShorthandMap
from app.services.ledger import OVERDUE_DAYS, confirmed_entries, customer_summaries, overview, summarize, with_running_balance

router = APIRouter(prefix="/api", tags=["customers"])


@router.get("/overview")
def get_overview(session: Session = Depends(get_session)):
    """Everything the home screen needs in one call."""
    shop = get_shop(session)
    return {"shop": shop, **overview(session, shop.id)}


@router.get("/customers")
def list_customers(session: Session = Depends(get_session)):
    shop = get_shop(session)
    customers = customer_summaries(session, shop.id)
    outstanding = sum(c["balance"] for c in customers if c["balance"] > 0)
    return {"total_outstanding": round(outstanding, 2), "overdue_days": OVERDUE_DAYS, "customers": customers}


@router.get("/customers/{customer_id}/ledger")
def customer_ledger(customer_id: int, session: Session = Depends(get_session)):
    shop = get_shop(session)
    customer = session.get(Customer, customer_id)
    if customer is None or customer.shop_id != shop.id:
        raise HTTPException(404, "Customer not found")
    entries = confirmed_entries(session, shop.id, customer_id)
    # Shorthand the shop uses for this customer, e.g. "Rmsh" -> "Ramesh bhau" (filled in Phase 5)
    aliases = session.exec(
        select(ShorthandMap.token).where(ShorthandMap.shop_id == shop.id, ShorthandMap.meaning == customer.name)
    ).all()
    summary = summarize(customer, entries)
    return {
        "customer": summary,
        "balance": summary["balance"],  # kept at top level for Phase 1 clients
        "aliases": aliases,
        "overdue_days": OVERDUE_DAYS,
        "entries": with_running_balance(entries),
    }
