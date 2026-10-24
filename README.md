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

#### Measuring accuracy on real photos

Put photos in a folder with a same-named answer file per photo:

```
samples/page1.jpg
samples/page1.json   {"rows": [{"customer_name": "Ramesh", "amount": 500, "type": "gave"}]}
```

```bash
cd backend && python -m scripts.eval_khata samples/
```

It prints correct/expected per photo plus overall recall and precision.

## Switching the AI provider

All model calls go through `backend/app/services/gemma.py`. Set `AI_PROVIDER` in
`backend/.env`:

- `google`: Google AI Studio (`GOOGLE_MODEL`, default `gemma-3-27b-it`)
- `ollama`: local Ollama (`OLLAMA_MODEL`, default `gemma3:4b`)

Every structured model output is validated with Pydantic. If the JSON is invalid,
the service retries once with the error message, then returns a clear error.
