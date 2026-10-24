"""Rule-based alerts for HisaabKitaab.

Calculates:
1. Low-stock alerts: same rule as the rest of the app (count at/below threshold, or shelf photo says low).
2. Overdue-udhaar alerts: customers with a positive outstanding balance and unpaid credit
   older than a configurable number of days (default 30).
"""

from typing import Any

from sqlmodel import Session, select

from app.models import ShelfStatus
from app.services.ledger import OVERDUE_DAYS, customer_summaries
from app.services.stock import list_shop_products


def get_low_stock_alerts(session: Session, shop_id: int) -> list[dict[str, Any]]:
    """Products that are low by the app-wide rule (stock.is_low_stock): counted stock at/below the
    threshold, or the latest shelf photo said "low". Same rule as the Home "Low stock items" count."""
    alerts = []
    for p in list_shop_products(session, shop_id):
        if not p["is_low"]:
            continue
        threshold = p["low_stock_threshold"] or 0
        stock = p["current_stock"]
        shelf_low = p["shelf_status"] == ShelfStatus.low
        alerts.append(
            {
                "product_id": p["id"],
                "product_name": p["name"],
                "unit": p["unit"],
                "current_stock": stock,
                "threshold": threshold,
                "shortage": round(max(threshold - stock, 0), 2),
                "shelf_low": shelf_low,
                "message": (
                    f"{p['name']}: shelf photo shows low stock ({stock} {p['unit']} counted)"
                    if shelf_low and stock > threshold
                    else f"{p['name']}: {stock} {p['unit']} remaining (threshold: {threshold} {p['unit']})"
                ),
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
