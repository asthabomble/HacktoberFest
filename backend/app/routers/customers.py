from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session, get_shop
from app.models import CreditEntry, Customer, ShorthandKind, ShorthandMap
from app.services import shorthand
from app.services.names import name_key, name_score
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


SIMILAR_MIN_SCORE = 0.75


def get_customer(session: Session, customer_id: int) -> Customer:
    customer = session.get(Customer, customer_id)
    if customer is None or customer.shop_id != get_shop(session).id:
        raise HTTPException(404, "Customer not found")
    return customer


@router.get("/customers/{customer_id}/similar")
def similar_customers(customer_id: int, session: Session = Depends(get_session)):
    """Other customers that are probably the same person ("Ramesh" vs "Ramesh bhau" vs "Rmsh")."""
    customer = get_customer(session, customer_id)
    result = []
    for c in customer_summaries(session, customer.shop_id):
        if c["id"] == customer.id:
            continue
        score = name_score(customer.name, c["name"])
        if score >= SIMILAR_MIN_SCORE:
            result.append({**c, "score": score})
    return {"customers": sorted(result, key=lambda c: c["score"], reverse=True)}


class MergeRequest(BaseModel):
    from_id: int  # this customer disappears; their entries move over


@router.post("/customers/{customer_id}/merge")
def merge_customers(customer_id: int, req: MergeRequest, session: Session = Depends(get_session)):
    """Merge a duplicate into this customer and remember the old name as shorthand."""
    target = get_customer(session, customer_id)
    source = get_customer(session, req.from_id)
    if source.id == target.id:
        raise HTTPException(400, "Cannot merge a customer into itself")

    entries = session.exec(select(CreditEntry).where(CreditEntry.customer_id == source.id)).all()
    for e in entries:
        e.customer_id = target.id
        session.add(e)
    shorthand.rename_meaning(session, target.shop_id, source.name, target.name)
    if name_key(source.name) != name_key(target.name):  # "Iqbl" -> learn; "Ramesh" vs "Ramesh bhau" -> nothing new
        shorthand.learn(session, target.shop_id, source.name, target.name, ShorthandKind.customer)
    if not target.phone and source.phone:
        target.phone = source.phone
        session.add(target)
    session.flush()
    session.delete(source)
    session.commit()
    return {"merged": len(entries), "into": target.id}
