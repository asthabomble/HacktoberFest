"""Rule-based alerts for HisaabKitaab.

Calculates:
1. Low-stock alerts: products where current quantity is below the configured threshold.
2. Overdue-udhaar alerts: customers with a positive outstanding balance and unpaid credit
   older than a configurable number of days (default 30).
"""

from typing import Any

from sqlmodel import Session, select

from app.models import Product
from app.services.ledger import OVERDUE_DAYS, customer_summaries
from app.services.stock import calculate_product_stock


def get_low_stock_alerts(session: Session, shop_id: int) -> list[dict[str, Any]]:
    """Find products whose recorded stock is below their configured low-stock threshold."""
    products = session.exec(
        select(Product).where(Product.shop_id == shop_id).order_by(Product.name)
    ).all()

    alerts = []
    for p in products:
        threshold = p.low_stock_threshold or 0
        if threshold <= 0:
            continue
        stock = calculate_product_stock(session, p.id)
        if stock < threshold:
            alerts.append(
                {
                    "product_id": p.id,
                    "product_name": p.name,
                    "unit": p.unit,
                    "current_stock": stock,
                    "threshold": threshold,
                    "shortage": round(threshold - stock, 2),
                    "message": f"{p.name}: {stock} {p.unit} remaining (threshold: {threshold} {p.unit})",
                }
            )
    return sorted(alerts, key=lambda a: (a["current_stock"] / a["threshold"] if a["threshold"] else 0))


def get_overdue_udhaar_alerts(
    session: Session,
    shop_id: int,
    overdue_days: int = OVERDUE_DAYS,
) -> list[dict[str, Any]]:
    """Find customers who owe money (balance > 0) with unpaid credit older than overdue_days."""
    summaries = customer_summaries(session, shop_id)
    alerts = []
    for c in summaries:
        if c["balance"] <= 0:
            continue
        if c["days_due"] >= overdue_days:
            alerts.append(
                {
                    "customer_id": c["id"],
                    "customer_name": c["name"],
                    "phone": c["phone"],
                    "balance": c["balance"],
                    "days_due": c["days_due"],
                    "overdue_days_threshold": overdue_days,
                    "last_payment": c["last_payment"],
                    "last_entry": c["last_entry"],
                    "message": f"{c['name']}: ₹{c['balance']:,.2f} pending for {c['days_due']} days",
                }
            )
    return sorted(alerts, key=lambda a: a["balance"], reverse=True)


def get_all_alerts(
    session: Session,
    shop_id: int,
    overdue_days: int = OVERDUE_DAYS,
) -> dict[str, Any]:
    """Combined alerts report for the shop."""
    low_stock = get_low_stock_alerts(session, shop_id)
    overdue_udhaar = get_overdue_udhaar_alerts(session, shop_id, overdue_days)
    return {
        "low_stock_alerts": low_stock,
        "overdue_udhaar_alerts": overdue_udhaar,
        "total_alerts": len(low_stock) + len(overdue_udhaar),
        "low_stock_count": len(low_stock),
        "overdue_count": len(overdue_udhaar),
        "overdue_days": overdue_days,
    }
