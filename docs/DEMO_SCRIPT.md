# HisaabKitaab — 3-minute demo script

For whoever presents. Uses the seeded demo data, so the numbers below are what you'll see.

## Before you go on (5 minutes earlier)

- [ ] Backend on the demo database, frontend with `--host` (see [demo.md](demo.md)):
  ```bash
  cd backend && DATABASE_URL=sqlite:///./data/demo.db python -m scripts.seed_demo --yes
  DATABASE_URL=sqlite:///./data/demo.db uvicorn app.main:app --port 8000
  cd frontend && npm run dev -- --host
  ```
- [ ] http://localhost:8000/api/health/ai?deep=true shows `"generation": "pong"`.
- [ ] Phone on the same Wi-Fi, app open at `http://<laptop-ip>:5173`, language set to **EN**.
- [ ] A real khata page photo on the phone (or printed), with at least one shorthand name like "Rmsh".
- [ ] Laptop Chrome at `localhost:5173` as backup. The mic works there; on the phone, type instead.

---

## 0:00 – 0:20 · The problem

> "Crores of kirana stores still run on a paper khata: udhaar written in Hindi, Marathi, English,
> in the shopkeeper's own shorthand. No app gets used if it means typing everything again.
> HisaabKitaab lets them keep writing, and just take a photo."

**Show:** Home screen.
> "Total outstanding ₹24,610, ₹1,620 given on credit today, 3 customers overdue more than 30 days,
> 4 items running low. Every number here is calculated in code, not by the AI."

## 0:20 – 1:10 · Snap the khata (the core)

**Do:** tap **Scan khata page** → **Capture** (or Gallery) → photo of the khata page.
> "Gemma reads the handwriting, mixed scripts, Devanagari numbers…"

**Show** Review entries while it loads (~10–15 s), then:
> "Every line, editable. Orange rows are the ones the AI isn't sure about. 'Needs review' filters to
> just those, so the shopkeeper checks two lines, not twenty."

**Point at** a name filled in from shorthand (e.g. `Rmsh → Ramesh bhau · seekha hua`):
> "It wrote 'Rmsh'. The app knows that's Ramesh bhau, because this shop corrected it once before.
> It learns each shop's handwriting."

**Do:** correct one name, show the "Save karne par yaad rakhenge" hint, tap **Confirm all**.
> "Nothing is saved until the shopkeeper confirms. And that correction is now remembered."

## 1:10 – 1:40 · Voice entry

**Do:** Scan → 🎤 → say or type: *"Iqbal chacha le gaye dedh hazaar ka saaman, Sunita ne 200 jama kiye"* → **Entries banao**.
> "Busy counter, no time to write? Just say it. 'Dedh hazaar' becomes ₹1,500, 'le gaye' is udhaar,
> 'jama' is a payment. Same review screen, same safety."

## 1:40 – 2:20 · Ask in Hindi

**Do:** bottom nav **Ask** → tap *"किसने 500 से ज़्यादा उधार लिया है?"* (or speak it on the laptop).
> "Ask in Hindi, Marathi or Hinglish."

**Point at** the answer card and the `filter: balance > 500 · sort: desc` line:
> "Gemma only turns the question into a safe, whitelisted query. Our code runs it, so it can't make up
> numbers or run arbitrary SQL. Then Gemma says the answer in the shopkeeper's language."

## 2:20 – 2:45 · Follow up the money

**Do:** Home → tap **Ramesh bhau** (₹6,450, 42 days in red).
> "Full ledger with running balance, the photos each entry came from, and 'aka Rmsh', the shorthand
> it learned. One tap sends a polite WhatsApp reminder."

**Do:** open the language dropdown (top right) → **हिन्दी** or **मराठी**.
> "And the whole app works in Hindi, Marathi or Hinglish with one tap."

## 2:45 – 3:00 · Close

> "Shopkeepers keep their habit of writing in the khata. They get a digital ledger, stock alerts and
> reminders, in their own language, and the app gets better at reading their handwriting every week.
> Built on Gemma, with the money maths kept in plain code."

---

## If something goes wrong

| Problem | Say / do |
|---|---|
| Photo reading is slow | "It's reading handwriting in three scripts." If it's over 30 s, switch to voice entry (typed). |
| `Gemma · offline` / error 500 | Google hiccup; the app retries. Retake once, otherwise demo voice entry or Pucho, which use shorter calls. |
| Mic denied on the phone | Type in the voice box. Phones only allow the mic on https. Or use the laptop. |
| Wrong row extracted | Good moment: edit it, confirm, and say "and now it's learned." |
