"""Measure khata extraction accuracy on real photos.

Put photos in a folder, each with a same-named .json answer file:

    samples/page1.jpg
    samples/page1.json   ->  {"rows": [{"customer_name": "Ramesh", "amount": 500, "type": "gave"}, ...]}

Run from backend/:  python -m scripts.eval_khata samples/

A row counts as correct when amount and type match exactly and the name is
close (fuzzy ratio >= 0.6, or one contains the other).
"""

import asyncio
import json
import sys
from difflib import SequenceMatcher
from pathlib import Path

from app.services.khata import extract_rows


def names_match(a: str, b: str) -> bool:
    a, b = a.strip().lower(), b.strip().lower()
    return a in b or b in a or SequenceMatcher(None, a, b).ratio() >= 0.6


def score(expected: list[dict], extracted: list[dict]) -> int:
    remaining = list(extracted)
    correct = 0
    for exp in expected:
        for got in remaining:
            if (
                float(got["amount"]) == float(exp["amount"])
                and got["type"] == exp["type"]
                and names_match(got["customer_name"], exp["customer_name"])
            ):
                correct += 1
                remaining.remove(got)
                break
    return correct


async def main(folder: Path) -> None:
    images = sorted(p for p in folder.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    total_expected = total_extracted = total_correct = 0
    for img in images:
        answer = img.with_suffix(".json")
        if not answer.exists():
            print(f"skip {img.name}: no {answer.name}")
            continue
        expected = json.loads(answer.read_text())["rows"]
        extracted = [r.model_dump() for r in await extract_rows(img.read_bytes())]
        correct = score(expected, extracted)
        low = sum(r["confidence"] == "low" for r in extracted)
        print(f"{img.name}: {correct}/{len(expected)} correct, {len(extracted)} extracted ({low} low-confidence)")
        total_expected += len(expected)
        total_extracted += len(extracted)
        total_correct += correct

    if total_expected:
        print(f"\nRecall    {total_correct}/{total_expected} = {total_correct / total_expected:.0%}")
    if total_extracted:
        print(f"Precision {total_correct}/{total_extracted} = {total_correct / total_extracted:.0%}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m scripts.eval_khata <folder>")
    asyncio.run(main(Path(sys.argv[1])))
