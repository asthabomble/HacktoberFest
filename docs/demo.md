# Running HisaabKitaab (laptop + phone)

This guide gets the app running on your laptop and opens it on your phone over the same Wi-Fi.
The phone talks only to the laptop, and the laptop talks to Gemma (Google AI Studio).

```
 Phone (browser)  ──Wi-Fi──▶  Laptop :5173 (Vite frontend)  ──▶  Laptop :8000 (FastAPI)  ──▶  Gemma API
```

---

## 1. What you need

| Tool | Version | Check |
|---|---|---|
| Python | 3.11+ | `python3 --version` |
| Node.js | 20+ | `node --version` |
| Google AI Studio API key | — | https://aistudio.google.com/apikey |

---

## 2. One-time setup

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Open `backend/.env` and set at least:

```
GOOGLE_API_KEY=your_key_here
GOOGLE_MODEL=gemma-4-26b-a4b-it
GOOGLE_THINKING_LEVEL=minimal
```

> **Model note:** `gemma-3-27b-it` has been retired (404) and `gemma-4-31b-it` was returning
> errors (500) on our key. `gemma-4-26b-a4b-it` works. To see which models your key can use:
> ```bash
> curl -s -H "x-goog-api-key: YOUR_KEY" \
>   "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" | grep '"name": "models/gemma'
> ```

### Frontend

```bash
cd frontend
npm install
```

---

## 3. Start the app (two terminals)

**Terminal 1 — backend**

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — frontend** (`--host` makes it reachable from your phone)

```bash
cd frontend
npm run dev -- --host
```

Vite prints something like:

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.23:5173/     ← use this one on the phone
```

> The backend can stay on `localhost`. The phone never calls port 8000 directly;
> Vite forwards `/api` and `/uploads` to it.

> After changing `backend/.env`, stop the backend (Ctrl+C) and start it again.
> `--reload` only picks up code changes, not `.env`.

---

## 4. Open it

### On the laptop

http://localhost:5173

### On the phone (same Wi-Fi)

1. Connect the phone to the **same Wi-Fi network** as the laptop.
2. Find the laptop's Wi-Fi IP address:

   | OS | Command | Look for |
   |---|---|---|
   | Linux | `hostname -I` | first address, usually `192.168.x.x` |
   | macOS | `ipconfig getifaddr en0` | `192.168.x.x` |
   | Windows | `ipconfig` | "IPv4 Address" under Wi-Fi |

   Or just copy the **Network:** URL that Vite prints.
3. On the phone's browser open `http://<laptop-ip>:5173`, e.g. `http://192.168.1.23:5173`.
   Data, scanning (via the phone's camera app), Pucho and typed voice entries all work here.
4. Optional: browser menu → **Add to Home screen** to open it like an app.

#### Full features on the phone: the https link

Phone browsers only allow **Google sign-in, the live camera preview and the mic** on https. Start a second,
https copy of the frontend (keep the normal one running for the laptop):

```bash
cd frontend
npm run dev:https          # https on port 5174, self-signed certificate
```

On the phone open **`https://<laptop-ip-with-dashes>.nip.io:5174`**, e.g. for `192.168.1.23`:
`https://192-168-1-23.nip.io:5174`. ([nip.io](https://nip.io) is a public name that points back to that IP,
so nothing leaves your Wi-Fi.)

- The first time, the browser warns that the certificate isn't trusted (it's self-signed):
  tap **Advanced → Proceed**.
- The login page on the plain `http://192.168…` address shows this https link for you.

#### Google sign-in

1. In Google Cloud Console → APIs & Services → Credentials, open (or create) the **OAuth client ID**
   (*Web application*). Under **Authorized JavaScript origins** add:
   - `http://localhost:5173` (laptop)
   - `https://<laptop-ip-with-dashes>.nip.io:5174` (phone), e.g. `https://192-168-1-23.nip.io:5174`

   Changes can take a few minutes to apply. If the laptop's Wi-Fi IP changes, add the new address too.
2. Put the client ID in `backend/.env` as `GOOGLE_OAUTH_CLIENT_ID=…` and restart the backend.
   The frontend reads it from the backend (`/api/auth/config`), so `frontend/.env` is optional.
3. Laptop: http://localhost:5173 → **Log in** → **Continue with Google**.
   Phone: the https link above → **Log in** → **Continue with Google**.

Google never accepts `http://192.168…`. On that address the login page explains this and links to the https
version or **Explore the demo**.

The email/password form on the login page isn't connected to accounts yet.

#### Language

The language dropdown in the header switches every screen between English, Hindi, Marathi and Hinglish; the choice is remembered.

---

## 5. Check that it works

| Check | URL | Expected |
|---|---|---|
| App + database | http://localhost:8000/api/health | `{"status":"ok","database":true}` |
| Gemma reachable | http://localhost:8000/api/health/ai | `"ok": true` |
| Gemma really answers | http://localhost:8000/api/health/ai?deep=true | `"generation": "pong"` (~2 s) |
| API docs | http://localhost:8000/docs | Swagger page |

The **New scan** screen in the app also shows `Gemma · online / offline`.

Typical timings with `gemma-4-26b-a4b-it` + `GOOGLE_THINKING_LEVEL=minimal`:

| Action | Time |
|---|---|
| Pucho question | ~4–6 s |
| Khata / bill / shelf photo | ~10–20 s |

---

## 6. Demo data (optional)

`scripts/seed_demo.py` fills the app with realistic sample data: 10 customers (3 overdue, udhaar today,
one fully paid), 7 products (4 low on stock) from a supplier bill, and learned shorthand
("Rmsh" = Ramesh bhau, "ch" = Sugar / Cheeni). Dates are relative to today, so it always looks fresh.

> ⚠️ It **replaces all customers, entries, products and shorthand**. It refuses to run on a database
> that already has customers unless you add `--yes`. To keep your real data, use a separate demo database:

```bash
cd backend
source .venv/bin/activate

# separate demo database (safe)
DATABASE_URL=sqlite:///./data/demo.db python -m scripts.seed_demo
DATABASE_URL=sqlite:///./data/demo.db uvicorn app.main:app --reload --port 8000

# or replace the data in the main database on purpose
python -m scripts.seed_demo --yes
```

Use the same `DATABASE_URL=...` prefix every time you start the backend for the demo.
Without the prefix, the backend uses your real database (`data/hisaabkitaab.db`) again.

---

## 7. Tests

```bash
cd backend
source .venv/bin/activate
pip install pytest
python -m pytest -q tests                    # backend tests (no Gemma calls)
python -m scripts.test_poocho                # 10 Pucho questions, calls Gemma, wipes data like seed_demo
python -m scripts.eval_khata samples/        # khata accuracy on your own photos (see README)
```

`test_poocho` uses `seed_demo` internally, so run it with the demo `DATABASE_URL` prefix too.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| Phone: page doesn't load / times out | Same Wi-Fi? (not a guest network; guest Wi-Fi usually blocks devices from seeing each other). Frontend started with `--host`? Using the laptop's `192.168…` IP, not `localhost`? |
| Phone still can't connect | Laptop firewall is blocking port 5173. Linux: `sudo ufw allow 5173/tcp`. Windows: allow Node.js on "Private networks" when prompted. macOS: System Settings → Network → Firewall → allow `node`. |
| Laptop IP changed | It can change after reconnecting to Wi-Fi. Re-run `hostname -I` and use the new address. |
| `Gemma · offline` / health says `GOOGLE_API_KEY is not set` | Add the key to `backend/.env`, restart the backend. |
| `Google AI Studio error 404` | Model retired. Use `GOOGLE_MODEL=gemma-4-26b-a4b-it` (see model note above). |
| `Google AI Studio error 500` now and then | Google-side hiccup; the app retries automatically. If every call fails, switch model. |
| Scans are slow (30 s+) | Set `GOOGLE_THINKING_LEVEL=minimal` in `backend/.env` and restart the backend. |
| `Address already in use` | Something is still running on the port. Linux/macOS: `fuser -k 8000/tcp` (or `5173/tcp`). |
| Frontend shows "Server se data nahi mila" | Backend isn't running. Start Terminal 1. |
| Mic button greyed out | Browser has no speech recognition (e.g. Firefox). Use Chrome, or type in the voice box. |
| "Mic ki permission nahi mili" on the phone | Phones need `https` for the mic. Type instead, or use the laptop at `localhost`. |
| Google button does nothing / "origin is not allowed" | On the phone use the https nip.io link (`npm run dev:https`) and add it to the OAuth client's Authorized JavaScript origins; wait a few minutes after adding. |
| Phone shows no numbers / "Server se data nahi mila" | The backend or Vite isn't running on the laptop (or the laptop slept). Start both terminals again; check the IP with `hostname -I`. |
| Login says Google sign-in isn't set up | Add `GOOGLE_OAUTH_CLIENT_ID` to `backend/.env` and restart the backend. |
| `seed_demo` says the database already has customers | That's the safety check. Use `DATABASE_URL=sqlite:///./data/demo.db …` or add `--yes`. |

---

## 9. Stop

Press **Ctrl+C** in both terminals.