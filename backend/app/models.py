"""Database tables.

Money is stored in rupees as float to keep the demo simple.
Every AI-extracted row carries `confidence` and `confirmed`; only
confirmed rows count toward balances and stock levels.
"""

from datetime import date, datetime, timezone
from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


def now() -> datetime:
    return datetime.now(timezone.utc)


class Confidence(str, Enum):
    high = "high"
    low = "low"


class CreditType(str, Enum):
    gave = "gave"  # shopkeeper gave goods/money on credit -> customer owes more
    got = "got"  # shopkeeper got payment back -> customer owes less


class StockEntryKind(str, Enum):
    purchase = "purchase"  # from a supplier bill
    sale = "sale"
    adjust = "adjust"  # manual correction
    shelf_check = "shelf_check"  # shelf photo, status only, no exact qty


class ShelfStatus(str, Enum):
    low = "low"
    medium = "medium"
    full = "full"


class ShorthandKind(str, Enum):
    customer = "customer"
    product = "product"
    other = "other"


class Shop(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    owner_name: Optional[str] = None
    phone: Optional[str] = None
    language: str = "hi"  # hi / mr / en
    created_at: datetime = Field(default_factory=now)


class Customer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    shop_id: int = Field(foreign_key="shop.id", index=True)
    name: str = Field(index=True)
    phone: Optional[str] = None
    language: str = "hi"
    created_at: datetime = Field(default_factory=now)


class CreditEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    shop_id: int = Field(foreign_key="shop.id", index=True)
    customer_id: int = Field(foreign_key="customer.id", index=True)
    amount: float
    type: CreditType
    entry_date: date = Field(default_factory=date.today)
    raw_text: Optional[str] = None  # what the model read off the page
    source_image: Optional[str] = None  # path of the uploaded photo
    confidence: Confidence = Confidence.high
    confirmed: bool = False
    created_at: datetime = Field(default_factory=now)


class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    shop_id: int = Field(foreign_key="shop.id", index=True)
    name: str = Field(index=True)
    unit: str = "pcs"  # kg / litre / pcs / packet
    low_stock_threshold: float = 0
    created_at: datetime = Field(default_factory=now)


class StockEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    shop_id: int = Field(foreign_key="shop.id", index=True)
    product_id: int = Field(foreign_key="product.id", index=True)
    supplier_bill_id: Optional[int] = Field(default=None, foreign_key="supplierbill.id", index=True)
    kind: StockEntryKind
    qty_change: float = 0  # + for purchase, - for sale; 0 for shelf checks
    rate: Optional[float] = None
    shelf_status: Optional[ShelfStatus] = None
    raw_text: Optional[str] = None
    source_image: Optional[str] = None
    confidence: Confidence = Confidence.high
    confirmed: bool = False
    created_at: datetime = Field(default_factory=now)


class SupplierBill(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    shop_id: int = Field(foreign_key="shop.id", index=True)
    supplier_name: Optional[str] = None
    bill_date: Optional[date] = None
    stated_total: Optional[float] = None
    calculated_total: Optional[float] = None
    source_image: Optional[str] = None
    confirmation_token: Optional[str] = Field(default=None, index=True, unique=True)
    confirmed: bool = True
    created_at: datetime = Field(default_factory=now)


class ShorthandMap(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    shop_id: int = Field(foreign_key="shop.id", index=True)
    token: str = Field(index=True)  # e.g. "Rmsh", "ch"
    meaning: str  # e.g. "Ramesh", "cheeni"
    kind: ShorthandKind = ShorthandKind.other
    created_at: datetime = Field(default_factory=now)
