# HisaabKitaab — Architecture

Kirana shopkeepers keep a paper khata. HisaabKitaab turns photos of khata pages, supplier bills and
shelves, plus spoken or typed entries, into a digital ledger and stock book they can question in
Hindi, Marathi or English.

**One rule runs through the design: Gemma reads, code decides.** The model turns messy handwriting and
speech into structured JSON. Every total, balance, threshold, alert and query result is computed in
plain Python, and nothing is saved until the shopkeeper confirms it.

```
┌──────────────── Phone / laptop browser ────────────────┐
│  React + TypeScript PWA (Vite, Tailwind)               │
│  Home · Customers · Scan/Review · Customer · Pucho     │
│  हिं/EN toggle · browser speech recognition            │
└───────────────┬────────────────────────────────────────┘
                │  /api/*  (Vite proxy in dev)
┌───────────────▼────────────────────────────────────────┐
│  FastAPI                                               │
│  routers/   khata · customers · stock · chat           │
│  services/  khata · bill · shelf · ledger · stock      │
│             chat · names · shorthand · matching        │
│             gemma  ◄── the only place that calls a model│
└───────┬───────────────────────────────┬────────────────┘
        │ SQLModel                      │ HTTPS (JSON prompts + images)
┌───────▼────────┐             ┌────────▼─────────────────┐
│ SQLite         │             │ Gemma 4 (Google AI Studio)│
│ (Postgres-ready)│            │  or Ollama locally        │
└────────────────┘             └───────────────────────────┘
```

## Data model (`backend/app/models.py`)

| Table | Holds |
|---|---|
| `Shop` | The store (single shop in the demo) |
| `Customer` | Name, phone, language |
| `CreditEntry` | Amount, `gave`/`got`, date, raw text read from the page, source photo, `confidence`, `confirmed` |
| `Product` | Name, unit, low-stock threshold |
| `StockEntry` | Purchase / sale / adjust / shelf check, qty change, rate, shelf status, source photo |
| `SupplierBill` | Supplier, date, stated vs calculated total, confirmation token (idempotent saves) |
| `ShorthandMap` | Learned shop shorthand: `"Rmsh" → Ramesh bhau`, `"ch" → Sugar / Cheeni` |

Only `confirmed` rows count toward balances and stock.

## The Gemma boundary (`services/gemma.py`)

- One module wraps every model call; `AI_PROVIDER=google|ollama` switches provider.
- `generate_json(prompt, Schema, images)` asks for JSON, validates it with Pydantic, **retries once**
  with the validation error, then fails with a clear message.
- Google AI Studio quirks handled here: Gemma 4 "thought" parts are dropped, transient 429/5xx are
  retried, and `GOOGLE_THINKING_LEVEL=minimal` keeps calls at ~2 s.

## Flows

### Khata photo → udhaar (Phases 1, 5)
1. Phone shrinks the photo to 1600 px → `POST /api/khata/extract`.
2. Prompt = khata instructions + **this shop's customers and learned shorthand**.
3. Gemma returns rows: `written_name`, `customer_name`, amount, gave/got, date, raw text, confidence.
4. Code cleans up: Devanagari digits, "₹1,200/-", sanity rules that force `low` confidence
   (no name, zero/huge amount, paise).
5. Code resolves names: learned shorthand → the model's pick from the customer list → fuzzy match
   (`services/names.py`: honorifics ignored, consonant skeleton for "Rmsh" ↔ "Ramesh", no guess on ties).
6. Review screen: edit anything, low-confidence rows highlighted. **Confirm** saves the rows and
   **learns** any name the shopkeeper corrected into `ShorthandMap`.

### Voice / typed entry (Phase 6)
Browser speech recognition (or typing) → `POST /api/khata/voice` → same row schema, same name
resolution, same Review screen. Numbers in words ("paanch sau", "dedh hazaar") are handled by the prompt.

### Supplier bill + shelf → stock (Phase 2)
- Bill: Gemma reads items/qty/rate/totals; code recomputes line and bill totals and flags mismatches;
  items are fuzzy-matched to products (learned item shorthand first). Confirm is one transaction,
  idempotent via a confirmation token.
- Shelf: Gemma gives only `low / medium / full` with visual evidence; it never changes counted stock.
- Low stock = latest shelf check says low, or counted stock ≤ product threshold.

### Pucho — questions in Hindi/Marathi/Hinglish (Phase 3)
1. Gemma converts the question into a **whitelisted** `StructuredQuery`
   (who owes > X, total udhaar today/month, a customer's balance, low stock, top debtors).
   A rule-based parser is the fallback.
2. Plain Python runs that query. Model output is never executed as SQL.
3. Gemma phrases the numbers in the user's language; the UI also shows the rows and the query
   (`filter: balance > 500 · sort: desc`) so answers are checkable.

### Ledger logic (`services/ledger.py`)
Balance = Σ gave − Σ got. Days due = days since last payment (or first entry if never paid).
Overdue = 30+ days. Home overview, alerts, customer pages and Pucho all use these same functions.

## Frontend (`frontend/src`)

| Path | Role |
|---|---|
| `App.tsx` | Simple route state (no router library) |
| `components/ui.tsx` | Design-system pieces from the mockups: headers, tabs, buttons, chips, skeletons, nav |
| `screens/` | Home, Customers, CustomerDetail, Scan (capture + 3 review flows + voice), Stock, Poocho |
| `lib/i18n.tsx` | हिं/EN: English text is the key; TypeScript forces a Hindi entry for every key |
| `lib/speech.ts` | Shared speech-recognition hook (Hindi `hi-IN` / English `en-IN`) |
| `lib/api.ts` | Fetch helpers + response types |

## Testing

- `backend/tests/` — 23 tests with Gemma mocked: extraction cleanup, retries, bill math, idempotency,
  learning/re-upload, fuzzy names, merge, voice entry, seed data.
- `scripts/test_poocho.py` — 10 real questions in Hindi/Marathi/Hinglish against real Gemma.
- `scripts/eval_khata.py` — accuracy on your own khata photos with answer files.

## Known limits

- Single shop, no login (the demo's `get_shop()` is the seam for multi-tenant auth).
- Phone mic, live camera preview and Google sign-in need https: use `npm run dev:https` and the nip.io
  link (see demo.md). Over plain Wi-Fi the app falls back to the phone's camera app and typed voice entry.
- Cross-script names ("रमेश" vs "Ramesh") rely on the model plus learned shorthand, not transliteration.
- Offline: designed and benchmarked, not yet in an Android build. See [OFFLINE.md](OFFLINE.md).
