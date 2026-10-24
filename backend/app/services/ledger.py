"""Balances and running totals. Plain code, never the LLM.

Balance = what the customer owes the shop = sum(gave) - sum(got),
counting confirmed entries only.
"""

from sqlmodel import Session, case, func, select

from app.models import CreditEntry, CreditType, Customer


def signed(entry: CreditEntry) -> float:
    return entry.amount if entry.type == CreditType.gave else -entry.amount


def customer_balances(session: Session, shop_id: int) -> list[dict]:
    signed_amount = case((CreditEntry.type == CreditType.gave, CreditEntry.amount), else_=-CreditEntry.amount)
    rows = session.exec(
        select(
            Customer,
            func.coalesce(func.sum(signed_amount), 0),
            func.max(CreditEntry.entry_date),
        )
        .join(
            CreditEntry,
            (CreditEntry.customer_id == Customer.id) & (CreditEntry.confirmed == True),  # noqa: E712
            isouter=True,
        )
        .where(Customer.shop_id == shop_id)
        .group_by(Customer.id)
    ).all()
    result = [
        {"id": c.id, "name": c.name, "phone": c.phone, "balance": round(bal, 2), "last_entry": last}
        for c, bal, last in rows
    ]
    return sorted(result, key=lambda r: r["balance"], reverse=True)


def ledger_with_running_balance(session: Session, customer_id: int) -> list[dict]:
    entries = session.exec(
        select(CreditEntry)
        .where(CreditEntry.customer_id == customer_id, CreditEntry.confirmed == True)  # noqa: E712
        .order_by(CreditEntry.entry_date, CreditEntry.id)
    ).all()
    running = 0.0
    out = []
    for e in entries:
        running += signed(e)
        out.append({**e.model_dump(), "running_balance": round(running, 2)})
    return out
