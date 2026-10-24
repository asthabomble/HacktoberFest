"""Fuzzy product matching.

Normalizes item names, calculates explainable match scores (0.0 to 1.0),
and suggests the best existing Product candidate without auto-merging.
"""

import difflib
import re
from typing import Optional

from app.models import Product

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

# Common packaging / measurement tokens to distinguish base item vs pack size
UNIT_PATTERNS = re.compile(
    r"\b(\d+(?:\.\d+)?\s*(?:kg|g|gm|gram|grams|ltr|l|liter|litre|ml|pcs|pc|packet|pkt|pouch|box|bag|bori))\b",
    re.IGNORECASE,
)


def normalize_text(text: str) -> str:
    """Normalize item name: lowercased, Devanagari digits converted, punctuation stripped."""
    t = text.translate(DEVANAGARI_DIGITS).lower()
    # Remove punctuation
    t = re.sub(r"[^\w\s]", " ", t)
    # Collapse multiple whitespaces
    return " ".join(t.split())


def extract_base_and_units(text: str) -> tuple[str, list[str]]:
    norm = normalize_text(text)
    units = [u.strip() for u in UNIT_PATTERNS.findall(norm)]
    base = UNIT_PATTERNS.sub("", norm)
    base = " ".join(base.split())
    return base, units


def calculate_similarity(query: str, target: str) -> float:
    """Calculate an explainable similarity score between 0.0 and 1.0."""
    norm_q = normalize_text(query)
    norm_t = normalize_text(target)

    if not norm_q or not norm_t:
        return 0.0

    if norm_q == norm_t:
        return 1.0

    base_q, units_q = extract_base_and_units(query)
    base_t, units_t = extract_base_and_units(target)

    # Base sequence ratio
    seq_ratio = difflib.SequenceMatcher(None, norm_q, norm_t).ratio()
    base_ratio = difflib.SequenceMatcher(None, base_q, base_t).ratio() if base_q and base_t else 0.0

    # Token overlap
    tokens_q = set(norm_q.split())
    tokens_t = set(norm_t.split())
    intersection = tokens_q.intersection(tokens_t)
    union = tokens_q.union(tokens_t)
    jaccard = len(intersection) / len(union) if union else 0.0

    score = max(seq_ratio, 0.7 * base_ratio + 0.3 * jaccard)

    # If both specify different explicit units (e.g. 250g vs 1kg), penalize similarity
    if units_q and units_t and set(units_q) != set(units_t):
        score *= 0.65

    return round(min(score, 0.99 if norm_q != norm_t else 1.0), 2)


def match_product(
    item_name: str,
    existing_products: list[Product],
    threshold: float = 0.55,
) -> tuple[Optional[Product], float]:
    """Find the best matching existing product for an extracted item name.

    Returns (product, score) if score >= threshold, else (None, 0.0).
    """
    if not existing_products:
        return None, 0.0

    best_prod = None
    best_score = 0.0

    for prod in existing_products:
        score = calculate_similarity(item_name, prod.name)
        if score > best_score:
            best_score = score
            best_prod = prod

    if best_score >= threshold and best_prod is not None:
        return best_prod, best_score

    return None, best_score
