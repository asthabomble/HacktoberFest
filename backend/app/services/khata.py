"""Khata page photo -> udhaar rows.

Gemma only reads the page. Cleanup (digits, dates, sanity checks that
downgrade confidence) and name resolution (learned shorthand, fuzzy match
against existing customers) happen here in plain code.
"""

import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, field_validator

from app.services import gemma
from app.services.matching import normalize_text
from app.services.names import best_match

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def to_ascii_digits(text: str) -> str:
    return text.translate(DEVANAGARI_DIGITS)


class ExtractedRow(BaseModel):
    customer_name: str
    written_name: str = ""  # the name exactly as written on the page, e.g. "Rmsh"
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


class ResolvedRow(ExtractedRow):
    """What the confirm screen gets: customer_name may be replaced by a known customer."""

    matched_by: Literal["shorthand", "customer", "fuzzy"] | None = None


PROMPT = """You are reading a photo of a handwritten "khata" (credit ledger) page from a small Indian kirana shop.
The writing may be Hindi, Marathi, English or mixed, in Devanagari or Latin script, with Devanagari (०-९) or Western digits.

Extract every credit/payment line as a row:
- written_name: ONLY the person's name exactly as written, e.g. "Rmsh" or "सुनीता" (keep the original
  script, do not translate). No items, no amounts, no words like jama/udhaar.
  If the page has one name as a heading and the lines below are that person's items, use that name for every row.
- customer_name: if the written name (or its shorthand below) clearly refers to one of this shop's existing
  customers, that customer's exact name from the list; otherwise the same as written_name.
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
If the image is not a khata page or nothing is readable, return {{"rows": []}}.

{shop_context}"""


def apply_sanity_checks(row: ExtractedRow) -> ExtractedRow:
    """Business rules that force a row to low confidence, regardless of what the model said."""
    row.customer_name = row.customer_name.strip()
    if not row.customer_name or row.amount <= 0 or row.amount > 1_00_000:
        row.confidence = "low"
    if row.amount != round(row.amount):  # paise in a khata usually means a misread
        row.confidence = "low"
    return row


def clean_written_name(row: ExtractedRow) -> str:
    """The model sometimes puts the whole line in written_name; fall back to the name if it isn't just a name."""
    written = row.written_name.strip()
    if not written or re.search(r"\d|[०-९]", written) or len(written.split()) > 4:
        return row.customer_name.strip()
    return written


def resolve_name(row: ExtractedRow, customers: list[str], shorthand: dict[str, str]) -> ResolvedRow:
    """Map the written name to a known customer: learned shorthand > model's pick from the list > fuzzy."""
    written = clean_written_name(row)
    resolved = ResolvedRow(**row.model_dump(), matched_by=None)
    resolved.written_name = written
    by_key = {normalize_text(c): c for c in customers}

    if normalize_text(written) in shorthand:
        resolved.customer_name, resolved.matched_by = shorthand[normalize_text(written)], "shorthand"
    elif normalize_text(row.customer_name) in by_key:
        resolved.customer_name = by_key[normalize_text(row.customer_name)]
        resolved.matched_by = "customer" if normalize_text(row.customer_name) != normalize_text(written) else None
    else:
        match, _ = best_match(written, customers)
        if match:
            resolved.customer_name, resolved.matched_by = match, "fuzzy"
    return resolved


async def extract_rows(
    image: bytes,
    shop_context: str = "",
    customers: list[str] | None = None,
    shorthand: dict[str, str] | None = None,
) -> list[ResolvedRow]:
    prompt = PROMPT.format(year=date.today().year, shop_context=shop_context)
    result = await gemma.generate_json(prompt, KhataExtraction, images=[image])
    return [resolve_name(apply_sanity_checks(r), customers or [], shorthand or {}) for r in result.rows]
