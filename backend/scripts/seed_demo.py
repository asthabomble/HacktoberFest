"""Seed script with realistic kirana demo data for HisaabKitaab.

Populates:
- Shop ("Sharma Kirana Store")
- Customers with varied credit balances (some > 500, some < 500, one zero)
- Credit entries spanning today, this month, and previous transactions
- Products with stock entries (some below threshold, some healthy)
"""

import datetime as dt
from sqlmodel import Session, select

from app.db import engine, init_db
from app.models import (
    Confidence,
    CreditEntry,
    CreditType,
    Customer,
    Product,
    ShelfStatus,
    Shop,
    StockEntry,
    StockEntryKind,
)


def seed():
    init_db()
    with Session(engine) as session:
        shop = session.exec(select(Shop)).first()
        if not shop:
            shop = Shop(name="Sharma Kirana Store", owner_name="Sharma ji", language="hi")
            session.add(shop)
            session.commit()
            session.refresh(shop)

        # Clear existing entries for fresh demo seed
        for model in (StockEntry, Product, CreditEntry, Customer):
            for row in session.exec(select(model)).all():
                session.delete(row)
        session.commit()

        today = dt.date.today()
        yesterday = today - dt.timedelta(days=1)
        last_week = today - dt.timedelta(days=7)
        first_of_month = today.replace(day=1)
        two_weeks_ago = today - dt.timedelta(days=14)
        forty_days_ago = today - dt.timedelta(days=40)

        # 1. Customers
        customers_data = [
            {"name": "Suresh Patil", "phone": "9876543211", "lang": "mr"},
            {"name": "Priya Sharma", "phone": "9876543214", "lang": "hi"},
            {"name": "Ramesh Kumar", "phone": "9876543210", "lang": "hi"},
            {"name": "Amit Shinde", "phone": "9876543213", "lang": "mr"},
            {"name": "Sunita Bai", "phone": "9876543212", "lang": "hi"},
            {"name": "Deepak Verma", "phone": "9876543215", "lang": "hi"},
            {"name": "Ganesh Bhau", "phone": "9876543216", "lang": "mr"},
        ]

        customer_map = {}
        for c in customers_data:
            cust = Customer(shop_id=shop.id, name=c["name"], phone=c["phone"], language=c["lang"])
            session.add(cust)
            session.flush()
            customer_map[c["name"]] = cust

        # 2. Credit Entries
        # Suresh: gave 3500, got 300 -> net owes 3200
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Suresh Patil"].id,
                amount=3500.0,
                type=CreditType.gave,
                entry_date=two_weeks_ago,
                raw_text="राशन + तेल उधारी 3500",
                confidence=Confidence.high,
                confirmed=True,
            )
        )
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Suresh Patil"].id,
                amount=300.0,
                type=CreditType.got,
                entry_date=yesterday,
                raw_text="रोख जमा 300",
                confidence=Confidence.high,
                confirmed=True,
            )
        )

        # Priya: gave 2500, got 400 -> net owes 2100
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Priya Sharma"].id,
                amount=2500.0,
                type=CreditType.gave,
                entry_date=last_week,
                raw_text="किराना सामान 2500",
                confidence=Confidence.high,
                confirmed=True,
            )
        )
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Priya Sharma"].id,
                amount=400.0,
                type=CreditType.got,
                entry_date=yesterday,
                raw_text="GPay jama 400",
                confidence=Confidence.high,
                confirmed=True,
            )
        )

        # Ramesh: gave 1200 (first of month), gave 650 (today), got 400 (today) -> net owes 1450
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Ramesh Kumar"].id,
                amount=1200.0,
                type=CreditType.gave,
                entry_date=first_of_month,
                raw_text="दाल चावल 1200",
                confidence=Confidence.high,
                confirmed=True,
            )
        )
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Ramesh Kumar"].id,
                amount=650.0,
                type=CreditType.gave,
                entry_date=today,
                raw_text="रिफाइंड तेल + चीनी 650",
                confidence=Confidence.high,
                confirmed=True,
            )
        )
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Ramesh Kumar"].id,
                amount=400.0,
                type=CreditType.got,
                entry_date=today,
                raw_text="रोकड़ दिया 400",
                confidence=Confidence.high,
                confirmed=True,
            )
        )

        # Amit: gave 850 (today) -> net owes 850
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Amit Shinde"].id,
                amount=850.0,
                type=CreditType.gave,
                entry_date=today,
                raw_text="गहू पीठ + साबण 850",
                confidence=Confidence.high,
                confirmed=True,
            )
        )

        # Sunita Bai: gave 450 (40 days ago) -> net owes 450 (overdue)
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Sunita Bai"].id,
                amount=450.0,
                type=CreditType.gave,
                entry_date=forty_days_ago,
                raw_text="मसाला + चायपत्ती 450",
                confidence=Confidence.high,
                confirmed=True,
            )
        )

        # Deepak Verma: gave 150 (yesterday) -> net owes 150
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Deepak Verma"].id,
                amount=150.0,
                type=CreditType.gave,
                entry_date=yesterday,
                raw_text="बिस्किट + नमकीन 150",
                confidence=Confidence.high,
                confirmed=True,
            )
        )

        # Ganesh Bhau: gave 500, got 500 -> net owes 0
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Ganesh Bhau"].id,
                amount=500.0,
                type=CreditType.gave,
                entry_date=two_weeks_ago,
                raw_text="उधारी 500",
                confidence=Confidence.high,
                confirmed=True,
            )
        )
        session.add(
            CreditEntry(
                shop_id=shop.id,
                customer_id=customer_map["Ganesh Bhau"].id,
                amount=500.0,
                type=CreditType.got,
                entry_date=last_week,
                raw_text="पूर्ण भरपाई 500",
                confidence=Confidence.high,
                confirmed=True,
            )
        )

        # 3. Products and Stock
        products_data = [
            {"name": "Tata Salt 1kg", "unit": "packet", "threshold": 10.0, "purchased": 20.0, "sold": 16.0},  # stock: 4 (LOW)
            {"name": "Aashirvaad Atta 5kg", "unit": "packet", "threshold": 5.0, "purchased": 10.0, "sold": 8.0},  # stock: 2 (LOW)
            {"name": "Fortune Oil 1L", "unit": "pouch", "threshold": 8.0, "purchased": 25.0, "sold": 13.0},  # stock: 12 (OK)
            {"name": "Sugar / Cheeni", "unit": "kg", "threshold": 25.0, "purchased": 50.0, "sold": 42.0},  # stock: 8 (LOW)
            {"name": "Maggi Noodles", "unit": "packet", "threshold": 20.0, "purchased": 60.0, "sold": 25.0},  # stock: 35 (OK)
            {"name": "Parle-G Biscuits", "unit": "packet", "threshold": 15.0, "purchased": 30.0, "sold": 25.0},  # stock: 5 (LOW)
            {"name": "Toor Dal Premium", "unit": "kg", "threshold": 10.0, "purchased": 30.0, "sold": 12.0},  # stock: 18 (OK)
        ]

        for p in products_data:
            prod = Product(shop_id=shop.id, name=p["name"], unit=p["unit"], low_stock_threshold=p["threshold"])
            session.add(prod)
            session.flush()

            # Purchase entry
            session.add(
                StockEntry(
                    shop_id=shop.id,
                    product_id=prod.id,
                    kind=StockEntryKind.purchase,
                    qty_change=p["purchased"],
                    confirmed=True,
                )
            )
            # Sale entry
            session.add(
                StockEntry(
                    shop_id=shop.id,
                    product_id=prod.id,
                    kind=StockEntryKind.sale,
                    qty_change=-p["sold"],
                    confirmed=True,
                )
            )

        session.commit()
        print("Demo data seeded successfully:")
        print(f"  Customers: {len(customers_data)}")
        print(f"  Products: {len(products_data)}")


if __name__ == "__main__":
    seed()
