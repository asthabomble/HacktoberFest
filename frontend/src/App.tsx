import { useEffect, useState } from "react";
import { apiGet, type AiHealth, type AppHealth } from "./lib/api";

type Check = { label: string; ok: boolean | null; detail: string };

function StatusRow({ label, ok, detail }: Check) {
  const color = ok === null ? "bg-muted" : ok ? "bg-mint" : "bg-rose";
  const word = ok === null ? "WAIT" : ok ? "OK" : "FAIL";
  return (
    <li className="flex items-start gap-3 border-t-2 border-line py-3 first:border-t-0">
      <span className={`mt-1.5 size-3 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{label}</span>
          <span className={`font-pixel text-xs ${ok ? "text-mint" : ok === false ? "text-rose" : "text-muted"}`}>
            {word}
          </span>
        </div>
        <p className="break-words font-mono text-xs text-muted">{detail}</p>
      </div>
    </li>
  );
}

const COMING = [
  { title: "Khata scan", hint: "फोटो से उधार", phase: 1, accent: "border-marigold" },
  { title: "Bill + shelf", hint: "स्टॉक अपडेट", phase: 2, accent: "border-mint" },
  { title: "Poocho", hint: "हिंदी / मराठी में सवाल", phase: 3, accent: "border-sky" },
  { title: "Alerts", hint: "WhatsApp याद दिलाओ", phase: 4, accent: "border-rose" },
];

export default function App() {
  const [api, setApi] = useState<Check>({ label: "API", ok: null, detail: "checking…" });
  const [db, setDb] = useState<Check>({ label: "Database", ok: null, detail: "checking…" });
  const [ai, setAi] = useState<Check>({ label: "Gemma", ok: null, detail: "checking…" });
  const [deepRunning, setDeepRunning] = useState(false);

  async function checkApp() {
    try {
      const h = await apiGet<AppHealth>("/api/health");
      setApi({ label: "API", ok: true, detail: "FastAPI reachable" });
      setDb({ label: "Database", ok: h.database, detail: h.database ? "SQLite connected" : "query failed" });
    } catch (e) {
      const msg = `backend not reachable (${(e as Error).message})`;
      setApi({ label: "API", ok: false, detail: msg });
      setDb({ label: "Database", ok: false, detail: "unknown" });
    }
  }

  async function checkAi(deep = false) {
    setAi((a) => ({ ...a, ok: null, detail: deep ? "asking Gemma to reply…" : "checking…" }));
    try {
      const h = await apiGet<AiHealth>(`/api/health/ai${deep ? "?deep=true" : ""}`);
      const extra = h.generation ? ` · replied "${h.generation}"` : "";
      setAi({ label: `Gemma (${h.provider})`, ok: h.ok, detail: `${h.model} · ${h.detail}${extra}` });
    } catch (e) {
      setAi({ label: "Gemma", ok: false, detail: (e as Error).message });
    }
  }

  useEffect(() => {
    checkApp();
    checkAi();
  }, []);

  async function runDeep() {
    setDeepRunning(true);
    await checkAi(true);
    setDeepRunning(false);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-24 pt-6">
      <header className="mb-6">
        <p className="font-pixel text-xs tracking-widest text-mint">&gt; kirana_os v0.1</p>
        <h1 className="font-pixel text-3xl leading-tight text-marigold">
          Hisaab<span className="text-paper">Kitaab</span>
        </h1>
        <p className="mt-1 text-muted">Photo se khata, khata se hisaab.</p>
      </header>

      <section className="block-shadow border-2 border-line bg-panel p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-pixel text-sm text-paper">System check</h2>
          <button
            onClick={() => {
              checkApp();
              checkAi();
            }}
            className="font-mono text-xs text-muted underline-offset-4 hover:text-paper hover:underline"
          >
            refresh
          </button>
        </div>
        <ul>
          <StatusRow {...api} />
          <StatusRow {...db} />
          <StatusRow {...ai} />
        </ul>
        <button
          onClick={runDeep}
          disabled={deepRunning}
          className="block-shadow-marigold press mt-3 w-full border-2 border-marigold bg-ink py-3 font-pixel text-sm text-marigold disabled:opacity-50"
        >
          {deepRunning ? "Gemma soch raha hai…" : "Test Gemma reply"}
        </button>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-pixel text-sm text-muted">Coming up</h2>
        <div className="grid grid-cols-2 gap-3">
          {COMING.map((c) => (
            <div key={c.title} className={`border-2 border-l-8 ${c.accent} bg-panel p-3`}>
              <p className="font-mono text-[10px] text-muted">PHASE {c.phase}</p>
              <p className="font-semibold leading-tight">{c.title}</p>
              <p className="text-sm text-muted">{c.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <nav className="fixed inset-x-0 bottom-0 border-t-2 border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-4 font-pixel text-[11px]">
          {["Home", "Khata", "Stock", "Poocho"].map((t, i) => (
            <span
              key={t}
              className={`py-4 text-center ${i === 0 ? "bg-panel text-marigold" : "text-line"}`}
            >
              {t}
            </span>
          ))}
        </div>
      </nav>
    </div>
  );
}
