# HisaabKitaab

Kirana stores keep writing in their paper khata. HisaabKitaab lets them photograph
khata pages, supplier bills and shelves, and uses **Gemma** (vision + text) to turn
them into udhaar (credit) and stock records. They can ask questions in Hindi or
Marathi, get alerts, and send WhatsApp reminders.

```
/backend    FastAPI + SQLModel (SQLite) + Gemma service
/frontend   React + TypeScript + Tailwind (mobile-first PWA)
```

## Prerequisites

- Python 3.11+
- Node 20+
- One of:
  - a **Google AI Studio** API key (https://aistudio.google.com/apikey), or
  - **Ollama** running locally with a vision Gemma model: `ollama pull gemma3:4b`

## Run the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then set GOOGLE_API_KEY, or AI_PROVIDER=ollama
uvicorn app.main:app --reload --port 8000
```

The SQLite database is created at `backend/data/hisaabkitaab.db` on first start,
with one demo shop.

API docs: http://localhost:8000/docs

## Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the backend,
so the app works on a phone on the same Wi-Fi too (`npm run dev -- --host`).

## Health checks

| Endpoint | What it checks |
| --- | --- |
| `GET /api/health` | API is up and the database answers |
| `GET /api/health/ai` | Gemma provider is reachable and the model exists |
| `GET /api/health/ai?deep=true` | Also runs a tiny JSON generation through Gemma |

The home screen shows all three.

## Features

### Snap khata → udhaar entries (Phase 1)

1. **Scan** tab → take a photo of a khata page (or pick from gallery).
   The photo is shrunk to 1600px on the phone before upload.
2. Gemma reads each line: customer name, amount, gave/got, date, raw text, confidence.
   Devanagari digits and "₹1,200/-" style amounts are cleaned up in code, and rows
   with a missing name, zero/huge amount or paise are forced to low confidence.
3. **Confirm screen**: every row is editable; low-confidence rows are yellow.
   Untick rows you don't want. Only rows you confirm are saved.
4. **Khata** tab: customers with balance (gave − got), tap one for the ledger with
   running balance and a link to the source photo.

API: `POST /api/khata/extract` (photo → rows, nothing saved), `POST /api/khata/confirm`,
`GET /api/customers`, `GET /api/customers/{id}/ledger`.

### Ask in Hindi/Marathi/Hinglish (Phase 3 – Poocho)

Use the Poocho tab to ask natural language questions about customer balances, totals, and low stock. The backend validates a structured intent and runs only whitelisted Python queries against the database; model output is never executed as SQL.

Run the sample suite with `cd backend` then `python -m scripts.test_poocho`.

### Supplier Bill + Shelf → Stock (Phase 2)

1. **Scan** tab → select **Supplier Bill** mode:
   - Photograph a printed or handwritten supplier bill / wholesaler parcha.
   - Gemma extracts supplier name, bill date, items, quantities, units, rates, and totals.
   - Ordinary Python logic verifies `quantity × rate = line_total` and compares sum of items against stated bill total.
   - Any total mismatch is flagged with a warning banner; low confidence rows are highlighted in yellow.
   - Explainable fuzzy matching suggests existing product candidates with match percentages (e.g. `Tata Salt (85% match)`) or allows creating a new product.
   - On confirmation, an atomic database transaction creates `SupplierBill` and `StockEntry` (kind=`purchase`) records.
   - Idempotency token prevents double-adding stock on duplicate confirmation.
2. **Scan** tab → select **Shelf Photo** mode:
   - Take a photo of a shelf, rack, or display tray.
   - Gemma visually assesses stock fullness returning strictly `low`, `medium`, or `full` with visual evidence and uncertainty notes (never claims exact inventory counts).
   - Confirmation saves a `StockEntry` with kind=`shelf_check` and `qty_change = 0`, keeping recorded inventory quantities accurate while displaying visual shelf alerts.
3. **Stock** tab:
   - Search products, view current counted stock balances, latest supplier bill additions, and visual shelf status tags (`SHELF: LOW` in yellow/rose).
   - Tap any product to view its complete chronological stock and shelf check history.

API endpoints:
- `POST /api/stock/bills/extract` (bill photo → items, line totals, total mismatch check, fuzzy product matches)
- `POST /api/stock/bills/confirm` (idempotent, atomic transaction creating stock entries)
- `POST /api/stock/shelf/assess` (shelf photo → low/medium/full status, visual evidence)
- `POST /api/stock/shelf/confirm` (saves visual check with zero quantity change)
- `GET /api/stock/products` (list products with stock balance, shelf status, and update source)
- `GET /api/stock/products/{id}/history` (audit history of purchases and shelf checks)

#### Running Backend Tests

```bash
cd backend
PYTHONPATH=. .venv/bin/pytest tests/ -v
```

Tests verify all 10 Phase 2 requirements (mocked Gemma responses, retry logic, mismatch detection, editable values, fuzzy matching, stock additions, idempotency, transaction rollback, qualitative shelf status, and Phase 1 preservation).

## Switching the AI provider

All model calls go through `backend/app/services/gemma.py`. Set `AI_PROVIDER` in
`backend/.env`:

- `google`: Google AI Studio (`GOOGLE_MODEL`, default `gemma-3-27b-it`)
- `ollama`: local Ollama (`OLLAMA_MODEL`, default `gemma3:4b`)

Every structured model output is validated with Pydantic. If the JSON is invalid,
the service retries once with the error message, then returns a clear error.
