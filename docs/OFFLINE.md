# HisaabKitaab offline: on-device Gemma (Phase 7)

Kirana shops often have patchy mobile data. Today every khata photo, bill and Pucho question goes to
Gemma in the cloud. This doc describes how the core flow can keep working **with no internet** by running a
small Gemma model on the shopkeeper's phone, and reports what we measured.

**Status:** design + benchmark prototype. The extraction code, prompts and validation are already
provider-agnostic (`backend/app/services/gemma.py`), and `scripts/bench_offline.py` measures any Gemma
provider on the same test set. An Android build is the next step (see the end).

---

## 1. What should work offline

| Feature | Offline? | How |
|---|---|---|
| Snap khata → udhaar rows | **Yes** (core) | Small multimodal Gemma on the phone reads the photo |
| Voice / typed entry ("Ramesh ko 500 udhaar diya") | **Yes** | Text-only, so even a ~1B Gemma is enough |
| Review screen, ledger, balances, alerts | **Yes** | Plain code + local database; no model needed |
| Learned shorthand ("Rmsh" = Ramesh bhau) | **Yes** | Cached on the phone and added to the on-device prompt |
| Supplier bill / shelf photo | Later | Same approach as khata, larger prompts |
| Pucho (questions) | Partly | Question → structured query works on-device; phrasing can fall back to the rule-based templates already in `services/chat.py` |
| WhatsApp reminders, Google sign-in, sync | Needs internet | Queued and sent when back online |

Because business logic (totals, balances, overdue rules, low stock) is plain code and **never** in the model,
moving the model on-device doesn't change any numbers the shopkeeper sees.

---

## 2. Model choice

| Model | Inputs | Approx. size (4-bit) | Use |
|---|---|---|---|
| **Gemma 3n E2B** (built for phones) | text + image + audio | ~2–3 GB | Khata photos on mid-range Android phones |
| Gemma 3n E4B | text + image + audio | ~4 GB | Better accuracy on high-end phones |
| Gemma 3 1B | text | ~0.5–0.8 GB | Voice/typed entries and Pucho query parsing on low-end phones |
| Gemma 3 4B | text + image | ~3.3 GB | What we could run locally on the laptop as a stand-in (via Ollama) |

On Android these run through **Google AI Edge** (MediaPipe LLM Inference / LiteRT), fully on-device. Google's
*AI Edge Gallery* app runs the same Gemma 3n models with image input, which gives a no-code way to measure
real phone latency (section 5).

---

## 3. Offline architecture

```
 Phone (offline)                                         Laptop/cloud backend (when online)
 ┌───────────────────────────────────────────────┐       ┌──────────────────────────────┐
 │ Camera/photo ─► on-device Gemma 3n            │       │ FastAPI                      │
 │   prompt = khata prompt + cached customers    │       │  /api/khata/confirm  (sync)  │
 │            + learned shorthand                │       │  shorthand learning, alerts  │
 │   output = same JSON schema, validated        │       │  WhatsApp reminders, Pucho   │
 │ ► Review screen (same as online)              │──────►│  cloud Gemma (fallback)      │
 │ ► local outbox (confirmed rows + photo)       │ sync  └──────────────────────────────┘
 └───────────────────────────────────────────────┘
```

1. **Same contract both ways.** The on-device model gets the same prompt and must return the same JSON
   (`KhataExtraction`: name, written name, amount, gave/got, date, raw text, confidence). The same cleanup
   rules run on the result: Devanagari digits, sanity checks that force low confidence, invalid-escape repair.
2. **Nothing is saved without review**, exactly like online.
3. **Outbox + sync.** Confirmed rows are stored locally and sent to `POST /api/khata/confirm` when the phone is
   online. The server is the source of truth for balances and learning; corrections made offline are learned
   on sync (the `written_name` already travels with each row).
4. **Context cache.** On each sync the phone downloads the customer list and learned shorthand, so offline
   extraction still knows "Rmsh = Ramesh bhau".
5. **Cloud fallback.** If the on-device result has low confidence everywhere, the app can offer
   "re-read with cloud Gemma" once back online.

---

## 4. Prototype and measurements

`backend/scripts/bench_offline.py` runs the app's real extraction code on the test set and reports latency and
accuracy for any provider:

- `samples/khata/page1–3.png` — 3 khata pages with answer keys: Hindi, Marathi and English, Devanagari digits,
  shorthand ("Rmsh", "Iqbl"), payment lines and total lines that must be skipped (12 rows)
- `samples/sample_supplier_bill.png` — 4 items + bill total (5 checks)
- `samples/voice.json` — 3 spoken entries incl. "पाँच सौ" and "dedh hazaar" (4 rows)

```bash
cd backend
python -m scripts.bench_offline                                         # cloud Gemma (from .env)
python -m scripts.bench_offline --provider ollama --model gemma3:4b     # local, image-capable
python -m scripts.bench_offline --provider ollama --model gemma3:1b --tasks voice   # local, text-only
```

### Results

Measured on 24 Oct 2026.

LOCAL_RESULTS_PLACEHOLDER

### What the benchmark already fixed

The first cloud run failed khata page 1 twice with "invalid JSON". Gemma wrote every Hindi letter as a `\uXXXX`
escape and occasionally produced a broken one (`\u092`) or an escape JSON doesn't allow (`\+`), so a correctly
read page was thrown away. The app now asks for Hindi/Marathi text as plain UTF-8 and repairs invalid escapes
before validating (`tests/test_json_repair.py`). Page 1 went from 0/4 rows (24 s with retries) to 4/4 (9 s).
On-device models, which are smaller, benefit from this repair even more.

---

## 5. Measuring on a real phone (no app build needed)

1. Install **Google AI Edge Gallery** on an Android phone and download **Gemma 3n E2B** inside the app.
2. Switch the phone to **airplane mode** to prove it's offline.
3. Open *Ask Image*, pick `samples/khata/page1.png`, and paste the khata prompt from
   `backend/app/services/khata.py` (`PROMPT`, with `{year}` = 2026 and `{shop_context}` removed).
4. Record the stats the app shows (time to first token, decode speed, total time) and compare the rows with
   `samples/khata/page1.json`. Repeat for pages 2–3 and add a row to the results table above.

---

## 6. Risks and next steps

- **Accuracy gap.** Small models misread more; the Review screen and confidence flags exist for exactly this,
  and learned shorthand narrows the gap per shop over time.
- **Model download (~2–3 GB).** Download once on Wi-Fi, with a progress screen; keep the cloud path for phones
  that are too small.
- **Memory/heat on low-end phones.** Use Gemma 3 1B for text-only flows (voice entry, Pucho parsing) and the
  multimodal model only for photos.
- **Next steps:** wrap the PWA in an Android shell (Capacitor/TWA) with a native MediaPipe LLM Inference bridge,
  add the IndexedDB outbox + sync, then run section 5's measurements on 2–3 real phones.
