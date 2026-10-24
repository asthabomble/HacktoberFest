"""Balances, running totals and overdue logic. Plain code, never the LLM.

Balance  = what the customer owes the shop = sum(gave) - sum(got).
Days due = for a customer who owes money, days since their last payment
           (or since their first entry if they never paid).
Only confirmed entries count.
"""

from collections import defaultdict
from datetime import date

from sqlmodel import Session, func, select

from app.models import CreditEntry, CreditType, Customer, ShorthandMap
from app.services.stock import list_shop_products

OVERDUE_DAYS = 30


def signed(entry: CreditEntry) -> float:
    return entry.amount if entry.type == CreditType.gave else -entry.amount


def confirmed_entries(session: Session, shop_id: int, customer_id: int | None = None) -> list[CreditEntry]:
    query = select(CreditEntry).where(CreditEntry.shop_id == shop_id, CreditEntry.confirmed == True)  # noqa: E712
    if customer_id is not None:
        query = query.where(CreditEntry.customer_id == customer_id)
    return list(session.exec(query.order_by(CreditEntry.entry_date, CreditEntry.id)).all())


def summarize(customer: Customer, entries: list[CreditEntry]) -> dict:
    """`entries` must be this customer's confirmed entries, oldest first."""
    balance = round(sum(signed(e) for e in entries), 2)
    payments = [e for e in entries if e.type == CreditType.got]
    last_payment = payments[-1] if payments else None

    days_due = 0
    if balance > 0 and entries:
        since = last_payment.entry_date if last_payment else entries[0].entry_date
        days_due = (date.today() - since).days

    return {
        "id": customer.id,
        "name": customer.name,
        "phone": customer.phone,
        "balance": balance,
        "days_due": days_due,
        "last_entry": entries[-1].entry_date if entries else None,
        "last_payment": {"amount": last_payment.amount, "date": last_payment.entry_date} if last_payment else None,
    }


def customer_summaries(session: Session, shop_id: int) -> list[dict]:
    customers = session.exec(select(Customer).where(Customer.shop_id == shop_id)).all()
    by_customer: dict[int, list[CreditEntry]] = defaultdict(list)
    for e in confirmed_entries(session, shop_id):
        by_customer[e.customer_id].append(e)
    result = [summarize(c, by_customer[c.id]) for c in customers]
    return sorted(result, key=lambda r: r["balance"], reverse=True)


def overview(session: Session, shop_id: int) -> dict:
    customers = customer_summaries(session, shop_id)
    udhaar_today = session.exec(
        select(func.coalesce(func.sum(CreditEntry.amount), 0)).where(
            CreditEntry.shop_id == shop_id,
            CreditEntry.confirmed == True,  # noqa: E712
            CreditEntry.type == CreditType.gave,
            CreditEntry.entry_date == date.today(),
        )
    ).one()
    shorthand_count = session.exec(
        select(func.count()).select_from(ShorthandMap).where(ShorthandMap.shop_id == shop_id)
    ).one()
    return {
        "customer_count": len(customers),
        "total_outstanding": round(sum(c["balance"] for c in customers if c["balance"] > 0), 2),
        "udhaar_today": round(udhaar_today, 2),
        "overdue_count": sum(1 for c in customers if c["days_due"] >= OVERDUE_DAYS),
        "overdue_days": OVERDUE_DAYS,
        "low_stock_count": sum(1 for p in list_shop_products(session, shop_id) if p["is_low"]),
        "shorthand_count": shorthand_count,
        "top_debtors": [c for c in customers if c["balance"] > 0][:5],
    }


def with_running_balance(entries: list[CreditEntry]) -> list[dict]:
    running = 0.0
    out = []
    for e in entries:
        running += signed(e)
        out.append({**e.model_dump(), "running_balance": round(running, 2)})
    return out


# Phase 1 names, still used by the Poocho chat service
def customer_balances(session: Session, shop_id: int) -> list[dict]:
    return customer_summaries(session, shop_id)


def ledger_with_running_balance(session: Session, customer_id: int) -> list[dict]:
    customer = session.get(Customer, customer_id)
    return with_running_balance(confirmed_entries(session, customer.shop_id, customer_id)) if customer else []
