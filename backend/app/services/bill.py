"""Supplier bill photo -> structured items.

Gemma extracts raw bill rows, supplier name, and dates.
Calculations, Devanagari digit conversion, line-total verification,
and mismatch flagging happen purely in Python business logic.
"""

import re
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, field_validator

from app.services import gemma

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def to_ascii_digits(text: str) -> str:
    return text.translate(DEVANAGARI_DIGITS)


def clean_number(v: any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        cleaned = re.sub(r"[^\d.]", "", to_ascii_digits(v).strip())
        if cleaned:
            try:
                return float(cleaned)
            except ValueError:
                return None
    return None


class ExtractedBillItem(BaseModel):
    item_name: str
    quantity: Optional[float] = None
    unit: Optional[str] = "pcs"
    rate: Optional[float] = None
    line_total: Optional[float] = None
    raw_text: str = ""
    confidence: Literal["high", "low"] = "low"

    @field_validator("quantity", mode="before")
    @classmethod
    def parse_qty(cls, v):
        return clean_number(v)

    @field_validator("rate", mode="before")
    @classmethod
    def parse_rate(cls, v):
        return clean_number(v)

    @field_validator("line_total", mode="before")
    @classmethod
    def parse_total(cls, v):
        return clean_number(v)


class BillExtraction(BaseModel):
    supplier_name: Optional[str] = None
    bill_date: Optional[str] = None
    items: list[ExtractedBillItem] = []
    bill_total: Optional[float] = None

    @field_validator("bill_total", mode="before")
    @classmethod
    def parse_bill_total(cls, v):
        return clean_number(v)

    @field_validator("bill_date", mode="before")
    @classmethod
    def parse_bill_date(cls, v):
        if not v:
            return None
        text = to_ascii_digits(str(v)).strip()
        # Accept YYYY-MM-DD
        try:
            return date.fromisoformat(text).isoformat()
        except ValueError:
            pass
        # Try DD/MM/YYYY or DD-MM-YYYY
        dmy = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$", text)
        if dmy:
            d, m, y = dmy.groups()
            if len(y) == 2:
                y = f"20{y}"
            try:
                return date(int(y), int(m), int(d)).isoformat()
            except ValueError:
                return None
        return None


class ProcessedBillItem(BaseModel):
    item_name: str
    quantity: float
    unit: str
    rate: Optional[float] = None
    line_total: float
    raw_text: str = ""
    confidence: Literal["high", "low"] = "high"
    needs_confirmation: bool = False
    line_mismatch: bool = False


class ProcessedBill(BaseModel):
    supplier_name: Optional[str] = None
    bill_date: Optional[str] = None
    items: list[ProcessedBillItem]
    stated_total: Optional[float] = None
    calculated_total: float
    has_total_mismatch: bool = False
    discrepancy_details: Optional[str] = None


PROMPT = """You are reading a photo of a printed or handwritten supplier/wholesaler bill, invoice, parcha, or cash memo from an Indian kirana wholesale purchase.
The text may be English, Hindi, Marathi, or mixed scripts, with Devanagari numerals (०-९) or Western digits.

Extract:
- supplier_name: name of the wholesaler, distributor, agency, or trader, if printed or written at the top.
- bill_date: date of the bill in YYYY-MM-DD format if visible, else null.
- items: list of all purchase line items:
  - item_name: product name as written on the bill (e.g., "Sugar M30", "Fortune Oil 1L", "टाटा नमक", "चना दाल").
  - quantity: number of units/weight (convert Devanagari digits to standard numbers).
  - unit: unit of measurement (kg, g, litre, packet, piece, box, bag, bori, etc.). Default to "pcs" if unspecified.
  - rate: price per unit if listed.
  - line_total: total price for this line item if listed.
  - raw_text: the line exactly as read from the bill.
  - confidence: "high" if item name, quantity, and line total or rate are clearly legible; otherwise "low".
- bill_total: total amount stated on the bill (e.g. Grand Total, Net Amount, कुल योग), if visible.

Skip bank details, tax breakup rows, signatures, and terms.
If not a supplier bill or unreadable, return {{"supplier_name": null, "bill_date": null, "items": [], "bill_total": null}}."""


def process_bill_extraction(extraction: BillExtraction) -> ProcessedBill:
    """Enforce pure Python business logic: calculate line totals and detect discrepancies."""
    processed_items: list[ProcessedBillItem] = []

    for item in extraction.items:
        name = item.item_name.strip()
        qty = item.quantity if item.quantity is not None else 0.0
        unit = (item.unit or "pcs").strip().lower()
        rate = item.rate
        stated_line_total = item.line_total

        confidence = item.confidence
        needs_confirmation = False
        line_mismatch = False

        if not name or qty <= 0:
            confidence = "low"
            needs_confirmation = True

        if rate is not None and qty > 0:
            calc_line = round(qty * rate, 2)
            if stated_line_total is not None and abs(calc_line - stated_line_total) > 1.0:
                line_mismatch = True
                confidence = "low"
                needs_confirmation = True
            # Prefer calculated line total if both available, but flag if differed
            final_line = calc_line
        elif stated_line_total is not None:
            final_line = round(stated_line_total, 2)
            if rate is None and qty > 0:
                rate = round(final_line / qty, 2)
        else:
            final_line = 0.0
            confidence = "low"
            needs_confirmation = True

        processed_items.append(
            ProcessedBillItem(
                item_name=name,
                quantity=qty,
                unit=unit,
                rate=rate,
                line_total=final_line,
                raw_text=item.raw_text,
                confidence=confidence,
                needs_confirmation=needs_confirmation,
                line_mismatch=line_mismatch,
            )
        )

    calc_total = round(sum(it.line_total for it in processed_items), 2)
    has_mismatch = False
    details = None

    if extraction.bill_total is not None:
        stated = round(extraction.bill_total, 2)
        if abs(stated - calc_total) > 1.0:
            has_mismatch = True
            diff = round(abs(stated - calc_total), 2)
            details = (
                f"Bill states ₹{stated:,.2f}, but sum of item totals is ₹{calc_total:,.2f} "
                f"(difference of ₹{diff:,.2f}). Please review."
            )
    else:
        stated = None

    return ProcessedBill(
        supplier_name=extraction.supplier_name.strip() if extraction.supplier_name else None,
        bill_date=extraction.bill_date,
        items=processed_items,
        stated_total=stated,
        calculated_total=calc_total,
        has_total_mismatch=has_mismatch,
        discrepancy_details=details,
    )


async def extract_bill(image: bytes, shop_context: str = "") -> ProcessedBill:
    """Send bill image to Gemma service and apply Python calculation checks."""
    prompt = f"{PROMPT}\n\n{shop_context}" if shop_context else PROMPT
    result = await gemma.generate_json(prompt, BillExtraction, images=[image])
    return process_bill_extraction(result)
