from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.db import get_session, get_shop
from app.models import Customer
from app.services.ledger import customer_balances, ledger_with_running_balance

router = APIRouter(prefix="/api/customers", tags=["customers"])


@router.get("")
def list_customers(session: Session = Depends(get_session)):
    shop = get_shop(session)
    customers = customer_balances(session, shop.id)
    outstanding = sum(c["balance"] for c in customers if c["balance"] > 0)
    return {"total_outstanding": round(outstanding, 2), "customers": customers}


@router.get("/{customer_id}/ledger")
def customer_ledger(customer_id: int, session: Session = Depends(get_session)):
    customer = session.get(Customer, customer_id)
    if customer is None or customer.shop_id != get_shop(session).id:
        raise HTTPException(404, "Customer not found")
    entries = ledger_with_running_balance(session, customer_id)
    balance = entries[-1]["running_balance"] if entries else 0
    return {"customer": customer, "balance": balance, "entries": entries}
