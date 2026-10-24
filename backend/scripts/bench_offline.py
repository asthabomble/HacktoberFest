"""Benchmark Gemma providers for the offline path (Phase 7).

Runs the app's real extraction code against the test set in samples/ and reports
latency and accuracy, so cloud Gemma and a small local/on-device Gemma can be compared.

  khata  samples/khata/*.png + answer .json   (vision: photo -> udhaar rows)
  bill   samples/sample_supplier_bill.png     (vision: photo -> items + total)
  voice  samples/voice.json                   (text only: spoken entry -> rows)

Run from backend/:
  python -m scripts.bench_offline                                   # provider from .env (cloud)
  python -m scripts.bench_offline --provider ollama --model gemma3:4b
  python -m scripts.bench_offline --provider ollama --model gemma3:1b --tasks voice   # text-only model
"""

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path

from app.config import get_settings
from app.services import gemma
from app.services.bill import extract_bill
from app.services.khata import extract_from_text, extract_rows
from scripts.eval_khata import score

SAMPLES = Path(__file__).resolve().parents[2] / "samples"


def use_provider(provider: str, model: str | None) -> str:
    """Point every gemma call at the chosen provider/model; returns a label for the report."""
    s = get_settings()
    if provider == "ollama":
        chosen = gemma.Ollama(s.ollama_base_url, model or s.ollama_model, s.ai_timeout_seconds)
    else:
        chosen = gemma.GoogleAIStudio(s.google_api_key, model or s.google_model, s.ai_timeout_seconds, s.google_thinking_level)
    gemma.get_provider = lambda: chosen
    return f"{chosen.name} · {chosen.model}"


async def timed(coro):
    start = time.perf_counter()
    try:
        result = await coro
        return result, time.perf_counter() - start, None
    except Exception as e:  # report failures instead of stopping the run
        return None, time.perf_counter() - start, str(e)[:120]


async def bench_khata() -> list[dict]:
    out = []
    for img in sorted((SAMPLES / "khata").glob("*.png")):
        expected = json.loads(img.with_suffix(".json").read_text())["rows"]
        rows, secs, err = await timed(extract_rows(img.read_bytes()))
        got = [r.model_dump() for r in rows or []]
        out.append({"task": "khata", "item": img.name, "secs": secs, "correct": score(expected, got), "total": len(expected), "error": err})
    return out


async def bench_bill() -> list[dict]:
    img = SAMPLES / "sample_supplier_bill.png"
    expected = json.loads((SAMPLES / "sample_supplier_bill.json").read_text())
    bill, secs, err = await timed(extract_bill(img.read_bytes()))
    correct = 0
    if bill:
        for exp in expected["items"]:
            correct += any(
                it.quantity == exp["quantity"] and round(it.line_total) == exp["line_total"] for it in bill.items
            )
        correct += bill.stated_total == expected["bill_total"]  # the total counts as one more check
    return [{"task": "bill", "item": img.name, "secs": secs, "correct": correct, "total": len(expected["items"]) + 1, "error": err}]


async def bench_voice() -> list[dict]:
    out = []
    for case in json.loads((SAMPLES / "voice.json").read_text()):
        rows, secs, err = await timed(extract_from_text(case["text"]))
        got = [r.model_dump() for r in rows or []]
        out.append({"task": "voice", "item": case["text"][:32], "secs": secs, "correct": score(case["rows"], got), "total": len(case["rows"]), "error": err})
    return out


TASKS = {"khata": bench_khata, "bill": bench_bill, "voice": bench_voice}


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--provider", choices=["google", "ollama"], default=get_settings().ai_provider)
    parser.add_argument("--model", help="model name, e.g. gemma3:4b (default: from .env)")
    parser.add_argument("--tasks", default="khata,bill,voice", help="comma-separated: khata,bill,voice")
    args = parser.parse_args()

    label = use_provider(args.provider, args.model)
    results = []
    for task in args.tasks.split(","):
        results += await TASKS[task.strip()]()

    print(f"\n### {label}\n")
    print("| Task | Item | Time (s) | Correct | Note |")
    print("|---|---|---|---|---|")
    for r in results:
        print(f"| {r['task']} | {r['item']} | {r['secs']:.1f} | {r['correct']}/{r['total']} | {r['error'] or ''} |")
    for task in dict.fromkeys(r["task"] for r in results):
        rs = [r for r in results if r["task"] == task]
        ok, total = sum(r["correct"] for r in rs), sum(r["total"] for r in rs)
        print(f"\n**{task}:** median {statistics.median(r['secs'] for r in rs):.1f} s, accuracy {ok}/{total} ({ok / total:.0%})", end="")
    print()


if __name__ == "__main__":
    asyncio.run(main())
