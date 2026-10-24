"""Shelf photo visual stock assessment.

Gemma inspects shelf photos and reports qualitative stock status:
low / medium / full, with visual evidence and noted uncertainties.
Never claims exact inventory counts or directly alters counted quantity.
"""

from typing import Literal, Optional

from pydantic import BaseModel, field_validator

from app.models import ShelfStatus
from app.services import gemma


class ShelfItemAssessment(BaseModel):
    product_name: str
    stock_status: Literal["low", "medium", "full"]
    visual_evidence: str
    confidence: Literal["high", "low"] = "high"
    uncertainty: Optional[str] = None

    @field_validator("stock_status", mode="before")
    @classmethod
    def validate_status(cls, v):
        if isinstance(v, str):
            s = v.strip().lower()
            if s in ("low", "medium", "full"):
                return s
            if any(w in s for w in ("empty", "out", "almost", "low", "kam", "khatam")):
                return "low"
            if any(w in s for w in ("half", "mid", "some", "theek")):
                return "medium"
            if any(w in s for w in ("full", "lot", "plenty", "bhara")):
                return "full"
        return "medium"


class ShelfExtraction(BaseModel):
    items: list[ShelfItemAssessment] = []


PROMPT = """You are inspecting a photo of shelves or product displays in an Indian kirana store.
Assess visual shelf stock status qualitatively.

CRITICAL INSTRUCTIONS:
- Do NOT provide exact numerical inventory counts (do NOT guess numbers like "7 packets").
- For each visible product or brand cluster, return:
  - product_name: identify the item or brand as best as possible (e.g., "Parle-G 100g", "Maggi 2-Minute Noodles", "Fortune Sunlite Oil").
  - stock_status: MUST be strictly one of:
      "low": shelf or tray is nearly empty, only 1-2 items remaining, gap visible, or out of stock.
      "medium": partially stocked, about half full, reasonable quantity visible.
      "full": well-stocked, shelf is packed, multiple rows or stack visible.
  - visual_evidence: brief note explaining what you see (e.g., "Front row almost bare with large empty gap", "Two full columns of packets stacked").
  - confidence: "high" if product brand and shelf fullness are clearly visible; "low" if blurry, dim, or occluded.
  - uncertainty: describe any ambiguity, e.g. "Lower shelf partially in shadow", "Product label partially turned away", or null.

If no recognizable store products or shelves are visible, return {{"items": []}}."""


async def assess_shelf(image: bytes) -> ShelfExtraction:
    """Analyze shelf photo for qualitative stock status."""
    return await gemma.generate_json(PROMPT, ShelfExtraction, images=[image])
