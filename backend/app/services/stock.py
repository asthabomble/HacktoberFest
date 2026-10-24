"""Stock tracking and calculation service.

Inventory calculations are pure Python and SQL:
- Current stock = sum(qty_change) of confirmed entries.
- Visual shelf status comes from the latest confirmed shelf_check entry.
- History provides an audit trail of all purchases and shelf observations.
"""

from datetime import datetime
from typing import Any, Optional

from sqlmodel import Session, desc, func, select

from app.models import Product, ShelfStatus, StockEntry, StockEntryKind


def calculate_product_stock(session: Session, product_id: int) -> float:
    """Sum confirmed quantity changes for a product."""
    qty = session.exec(
        select(func.coalesce(func.sum(StockEntry.qty_change), 0.0)).where(
            StockEntry.product_id == product_id,
            StockEntry.confirmed == True,  # noqa: E712
        )
    ).one()
    return round(float(qty), 2)


def get_latest_shelf_status(session: Session, product_id: int) -> Optional[dict[str, Any]]:
    """Get the most recent confirmed visual shelf assessment for a product."""
    entry = session.exec(
        select(StockEntry)
        .where(
            StockEntry.product_id == product_id,
            StockEntry.kind == StockEntryKind.shelf_check,
            StockEntry.confirmed == True,  # noqa: E712
        )
        .order_by(desc(StockEntry.created_at), desc(StockEntry.id))
    ).first()

    if not entry or not entry.shelf_status:
        return None

    return {
        "status": entry.shelf_status.value if hasattr(entry.shelf_status, "value") else str(entry.shelf_status),
        "visual_evidence": entry.raw_text,
        "checked_at": entry.created_at,
        "source_image": entry.source_image,
    }


def get_latest_purchase(session: Session, product_id: int) -> Optional[dict[str, Any]]:
    """Get the most recent confirmed purchase entry for a product."""
    entry = session.exec(
        select(StockEntry)
        .where(
            StockEntry.product_id == product_id,
            StockEntry.kind == StockEntryKind.purchase,
            StockEntry.confirmed == True,  # noqa: E712
        )
        .order_by(desc(StockEntry.created_at), desc(StockEntry.id))
    ).first()

    if not entry:
        return None

    return {
        "qty_added": entry.qty_change,
        "rate": entry.rate,
        "date": entry.created_at,
        "source_image": entry.source_image,
    }


def list_shop_products(session: Session, shop_id: int) -> list[dict[str, Any]]:
    """List all products in a shop with stock totals, shelf status, and update metadata."""
    products = session.exec(
        select(Product).where(Product.shop_id == shop_id).order_by(Product.name)
    ).all()

    result = []
    for p in products:
        stock = calculate_product_stock(session, p.id)
        shelf = get_latest_shelf_status(session, p.id)
        purchase = get_latest_purchase(session, p.id)

        # Determine last update
        latest_entry = session.exec(
            select(StockEntry)
            .where(
                StockEntry.product_id == p.id,
                StockEntry.confirmed == True,  # noqa: E712
            )
            .order_by(desc(StockEntry.created_at), desc(StockEntry.id))
        ).first()

        last_updated_at = latest_entry.created_at if latest_entry else p.created_at
        last_source = (
            "bill"
            if latest_entry and latest_entry.kind == StockEntryKind.purchase
            else "shelf_assessment"
            if latest_entry and latest_entry.kind == StockEntryKind.shelf_check
            else "manual"
        )

        result.append(
            {
                "id": p.id,
                "name": p.name,
                "unit": p.unit,
                "low_stock_threshold": p.low_stock_threshold,
                "current_stock": stock,
                "shelf_status": shelf["status"] if shelf else None,
                "shelf_evidence": shelf["visual_evidence"] if shelf else None,
                "shelf_checked_at": shelf["checked_at"] if shelf else None,
                "last_purchase_qty": purchase["qty_added"] if purchase else None,
                "last_purchase_rate": purchase["rate"] if purchase else None,
                "last_purchase_date": purchase["date"] if purchase else None,
                "last_updated_at": last_updated_at,
                "last_source": last_source,
            }
        )
        result[-1]["is_low"] = is_low_stock(result[-1])

    return result


def is_low_stock(product: dict[str, Any]) -> bool:
    """Low if the latest shelf check said low, or counted stock is at/below the product's threshold."""
    if product["shelf_status"] == ShelfStatus.low:
        return True
    threshold = product["low_stock_threshold"]
    return threshold > 0 and product["current_stock"] <= threshold


def get_product_stock_history(session: Session, product_id: int) -> list[dict[str, Any]]:
    """Return the chronological audit history of all confirmed stock events."""
    entries = session.exec(
        select(StockEntry)
        .where(
            StockEntry.product_id == product_id,
            StockEntry.confirmed == True,  # noqa: E712
        )
        .order_by(desc(StockEntry.created_at), desc(StockEntry.id))
    ).all()

    return [
        {
            "id": e.id,
            "kind": e.kind.value if hasattr(e.kind, "value") else str(e.kind),
            "qty_change": e.qty_change,
            "rate": e.rate,
            "shelf_status": e.shelf_status.value if hasattr(e.shelf_status, "value") and e.shelf_status else (str(e.shelf_status) if e.shelf_status else None),
            "raw_text": e.raw_text,
            "source_image": e.source_image,
            "created_at": e.created_at,
        }
        for e in entries
    ]
