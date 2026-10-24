"""Khata page photo -> udhaar rows.

Gemma only reads the page. Cleanup (digits, dates, sanity checks that
downgrade confidence) happens here in plain code.
"""

import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, field_validator

from app.services import gemma

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def to_ascii_digits(text: str) -> str:
    return text.translate(DEVANAGARI_DIGITS)


class ExtractedRow(BaseModel):
    customer_name: str
    amount: float
    type: Literal["gave", "got"]
    date: str | None = None  # YYYY-MM-DD
    raw_text: str = ""
    confidence: Literal["high", "low"] = "low"

    @field_validator("amount", mode="before")
    @classmethod
    def parse_amount(cls, v):
        # Accept "५००", "₹1,200/-", "Rs 50" etc.
        if isinstance(v, str):
            cleaned = re.sub(r"[^\d.]", "", to_ascii_digits(v))
            return float(cleaned) if cleaned else 0
        return v

    @field_validator("date", mode="before")
    @classmethod
    def parse_date(cls, v):
        if not v:
            return None
        try:
            return date.fromisoformat(to_ascii_digits(str(v)).strip()).isoformat()
        except ValueError:
            return None  # unreadable date -> user fills it on the confirm screen


class KhataExtraction(BaseModel):
    rows: list[ExtractedRow]


PROMPT = """You are reading a photo of a handwritten "khata" (credit ledger) page from a small Indian kirana shop.
The writing may be Hindi, Marathi, English or mixed, in Devanagari or Latin script, with Devanagari (०-९) or Western digits.

Extract every credit/payment line as a row:
- customer_name: the person's name exactly as written (keep the original script, do not translate).
  If the page has one name as a heading and the lines below are that person's items, use that name for every row.
- amount: the rupee amount as a number (convert Devanagari digits to Western digits).
- type:
    "gave" = shopkeeper gave goods/money on credit (udhaar, baaki, diya, नावे, उधार, बाकी, दिया, or an item purchase).
    "got"  = shopkeeper received payment (jama, mila, aaya, जमा, मिला, आया, "paid", "rcvd").
    If there are two columns, the left/"नावे" column is usually "gave" and the "जमा" column is "got".
- date: YYYY-MM-DD if a date is written on the line or as a heading above it, else null.
  Assume day/month order. If the year is missing, use {year}.
- raw_text: the line exactly as you read it, including item names.
- confidence: "high" only if name, amount and type are all clearly legible; otherwise "low".

Skip total/summary lines (कुल, टोटल, एकूण, total), headings with no amount, and lines that are crossed out.
If the image is not a khata page or nothing is readable, return {{"rows": []}}."""


def apply_sanity_checks(row: ExtractedRow) -> ExtractedRow:
    """Business rules that force a row to low confidence, regardless of what the model said."""
    row.customer_name = row.customer_name.strip()
    if not row.customer_name or row.amount <= 0 or row.amount > 1_00_000:
        row.confidence = "low"
    if row.amount != round(row.amount):  # paise in a khata usually means a misread
        row.confidence = "low"
    return row


async def extract_rows(image: bytes) -> list[ExtractedRow]:
    result = await gemma.generate_json(PROMPT.format(year=date.today().year), KhataExtraction, images=[image])
    return [apply_sanity_checks(r) for r in result.rows]
