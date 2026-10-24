"""Seed script with realistic kirana demo data for HisaabKitaab.

Populates (dates are relative to today, so the demo always looks fresh):
- Shop "Sharma Kirana Store"
- 10 customers: 3 overdue (30+ days since last payment), udhaar today, one fully paid
- Credit entries with real-looking khata notes in Hindi/Marathi/English
- 7 products from a supplier bill + sales; 4 are low (by count or by shelf photo)
- Learned shorthand ("Rmsh" = Ramesh bhau, "ch" = Sugar / Cheeni) so Phase 5 shows up in the demo

Usage (from backend/):
    DATABASE_URL=sqlite:///./data/demo.db python -m scripts.seed_demo     # separate demo DB (recommended)
    python -m scripts.seed_demo --yes                                     # replace data in the main DB

It deletes existing customers, entries, products and shorthand first. Without --yes it refuses
to touch a database that already has customers.
"""

import datetime as dt
import sys

from sqlmodel import Session, select

from app.db import engine, init_db
from app.models import (
    Confidence,
    CreditEntry,
    CreditType,
    Customer,
    Product,
    ShelfStatus,
    ShorthandKind,
    ShorthandMap,
    Shop,
    StockEntry,
    StockEntryKind,
    SupplierBill,
)

GAVE, GOT = CreditType.gave, CreditType.got

# name, language, [(days ago, type, amount, khata note)]
CUSTOMERS = [
    ("Ramesh bhau", "hi", [
        (57, GAVE, 3350, "Opening balance"),
        (49, GAVE, 310, "Doodh, biscuit"),
        (42, GOT, 1000, "Payment (cash)"),
        (22, GAVE, 640, "Toor dal, chawal"),
        (13, GAVE, 2180, "Monthly ration"),
        (5, GAVE, 520, "Atta 10kg"),
        (0, GAVE, 450, "Rmsh 450 ch+tel"),
    ]),
    ("Sunita tai", "mr", [
        (18, GAVE, 3800, "किराणा महिना"),
        (0, GAVE, 320, "सुनीता ३२०"),
    ]),
    ("Iqbal chacha", "hi", [
        (50, GAVE, 3500, "Ration + tel"),
        (35, GOT, 1000, "Iqbl jama 1000"),
        (20, GAVE, 1380, "Chawal 10kg, dal"),
    ]),
    ("Suresh Patil", "mr", [
        (14, GAVE, 3500, "राशन + तेल उधारी 3500"),
        (1, GOT, 300, "रोख जमा 300"),
    ]),
    ("Pappu (dhaba)", "hi", [
        (9, GAVE, 1900, "Chai patti, cheeni, doodh"),
        (3, GAVE, 860, "Pp 860 tel"),
    ]),
    ("Meena didi", "hi", [
        (31, GAVE, 2300, "Sabun, masala, tel"),
    ]),
    ("Priya Sharma", "hi", [
        (6, GAVE, 1300, "किराना सामान 1300"),
        (2, GOT, 400, "GPay jama 400"),
    ]),
    ("Amit Shinde", "mr", [
        (0, GAVE, 850, "गहू पीठ + साबण 850"),
    ]),
    ("Deepak Verma", "hi", [
        (1, GAVE, 150, "बिस्किट + नमकीन 150"),
    ]),
    ("Ganesh bhau", "mr", [
        (20, GAVE, 500, "उधारी 500"),
        (10, GOT, 500, "पूर्ण भरपाई 500"),
    ]),
]

# name, unit, low-stock threshold, bought on the supplier bill (qty, rate), sold since
PRODUCTS = [
    ("Tata Salt 1kg", "packet", 10, (20, 24), 16),            # 4 left  -> low
    ("Aashirvaad Atta 5kg", "packet", 5, (10, 245), 8),       # 2 left  -> low
    ("Fortune Oil 1L", "pouch", 8, (25, 145), 13),            # 12 left -> ok
    ("Sugar / Cheeni", "kg", 25, (50, 42), 42),               # 8 left  -> low
    ("Maggi Noodles", "packet", 20, (60, 14), 25),            # 35 left -> ok
    ("Parle-G Biscuits", "packet", 15, (40, 10), 15),         # 25 left, but shelf photo says low
    ("Toor Dal Premium", "kg", 10, (30, 128), 12),            # 18 left -> ok
]

SHELF_CHECKS = [
    ("Parle-G Biscuits", ShelfStatus.low, "Front rack almost empty, 2-3 packets visible"),
    ("Maggi Noodles", ShelfStatus.full, "Top shelf fully stacked"),
]

SHORTHAND = [
    ("Rmsh", "Ramesh bhau", ShorthandKind.customer),
    ("Iqbl", "Iqbal chacha", ShorthandKind.customer),
    ("Pp", "Pappu (dhaba)", ShorthandKind.customer),
    ("सुनीता", "Sunita tai", ShorthandKind.customer),
    ("ch", "Sugar / Cheeni", ShorthandKind.product),
    ("tel", "Fortune Oil 1L", ShorthandKind.product),
]


def seed(force: bool = True) -> bool:
    """Replace demo data. Returns False (and changes nothing) if data exists and force is False."""
    init_db()
    with Session(engine) as session:
        shop = session.exec(select(Shop)).first()
        if not shop:
            shop = Shop(name="Sharma Kirana Store", owner_name="Sharma ji", language="hi")
            session.add(shop)
            session.commit()
            session.refresh(shop)

        if not force and session.exec(select(Customer)).first():
            return False

        # Children before parents (foreign keys)
        for model in (StockEntry, SupplierBill, ShorthandMap, CreditEntry, Product, Customer):
            for row in session.exec(select(model)).all():
                session.delete(row)
        session.commit()

        today = dt.date.today()
        now = dt.datetime.now(dt.timezone.utc)

        for name, language, entries in CUSTOMERS:
            customer = Customer(shop_id=shop.id, name=name, language=language)
            session.add(customer)
            session.flush()
            for days_ago, kind, amount, note in entries:
                session.add(
                    CreditEntry(
                        shop_id=shop.id,
                        customer_id=customer.id,
                        amount=amount,
                        type=kind,
                        entry_date=today - dt.timedelta(days=days_ago),
                        raw_text=note,
                        confidence=Confidence.high,
                        confirmed=True,
                    )
                )

        bill_date = today - dt.timedelta(days=12)
        bill = SupplierBill(
            shop_id=shop.id,
            supplier_name="Gupta Traders",
            bill_date=bill_date,
            stated_total=sum(qty * rate for _, _, _, (qty, rate), _ in PRODUCTS),
            calculated_total=sum(qty * rate for _, _, _, (qty, rate), _ in PRODUCTS),
            confirmed=True,
        )
        session.add(bill)
        session.flush()

        products = {}
        for name, unit, threshold, (qty, rate), sold in PRODUCTS:
            product = Product(shop_id=shop.id, name=name, unit=unit, low_stock_threshold=threshold)
            session.add(product)
            session.flush()
            products[name] = product
            session.add(StockEntry(
                shop_id=shop.id, product_id=product.id, supplier_bill_id=bill.id, kind=StockEntryKind.purchase,
                qty_change=qty, rate=rate, raw_text=f"{name} {qty} x {rate}", confirmed=True,
                created_at=now - dt.timedelta(days=12),
            ))
            session.add(StockEntry(
                shop_id=shop.id, product_id=product.id, kind=StockEntryKind.sale,
                qty_change=-sold, confirmed=True, created_at=now - dt.timedelta(days=2),
            ))

        for name, status, evidence in SHELF_CHECKS:
            session.add(StockEntry(
                shop_id=shop.id, product_id=products[name].id, kind=StockEntryKind.shelf_check,
                qty_change=0, shelf_status=status, raw_text=evidence, confirmed=True,
                created_at=now - dt.timedelta(hours=3),
            ))

        for token, meaning, kind in SHORTHAND:
            session.add(ShorthandMap(shop_id=shop.id, token=token, meaning=meaning, kind=kind))

        session.commit()
        print("Demo data seeded successfully:")
        print(f"  Customers: {len(CUSTOMERS)}")
        print(f"  Products: {len(PRODUCTS)}")
        print(f"  Shorthand: {len(SHORTHAND)}")
        return True


if __name__ == "__main__":
    if not seed(force="--yes" in sys.argv):
        sys.exit(
            "This database already has customers. Seeding would DELETE them.\n"
            "Use a separate demo database:\n"
            "  DATABASE_URL=sqlite:///./data/demo.db python -m scripts.seed_demo\n"
            "or replace the data on purpose:\n"
            "  python -m scripts.seed_demo --yes"
        )
