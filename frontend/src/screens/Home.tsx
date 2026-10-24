import { useEffect, useState } from "react";
import { apiGet, type AiHealth, type AppHealth } from "../lib/api";
import type { Tab } from "../components/Nav";
import type { ScanMode } from "./Scan";

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
  { title: "Alerts", hint: "WhatsApp याद दिलाओ", phase: 4, accent: "border-rose" },
  { title: "Seekhta hai", hint: "आपकी लिखावट समझे", phase: 5, accent: "border-marigold" },
];

export default function Home({
  onNavigate,
}: {
  onNavigate: (tab: Tab, mode?: ScanMode) => void;
}) {
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
    <>
      <header className="mb-6">
        <p className="font-pixel text-xs tracking-widest text-mint">&gt; kirana_os v0.2</p>
        <h1 className="font-pixel text-3xl leading-tight text-marigold">
          Hisaab<span className="text-paper">Kitaab</span>
        </h1>
        <p className="mt-1 text-muted">Photo se khata, supplier bill se stock.</p>
      </header>

      {/* Action Cards */}
      <div className="mb-8 space-y-3">
        <button
          onClick={() => onNavigate("scan", "khata")}
          className="block-shadow-marigold press flex w-full items-center justify-between border-2 border-marigold bg-marigold px-4 py-3.5 text-left text-ink"
        >
          <span>
            <span className="block font-pixel text-base">Scan khata</span>
            <span className="block text-xs font-medium">खाते के पन्ने की फोटो लो (Udhaar)</span>
          </span>
          <span className="font-pixel text-2xl">&gt;</span>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onNavigate("scan", "bill")}
            className="press flex flex-col justify-between border-2 border-mint bg-panel p-3 text-left hover:border-mint"
          >
            <div>
              <span className="font-pixel text-[10px] text-mint">PHASE 2</span>
              <span className="block font-pixel text-sm text-paper mt-0.5">Supplier Bill</span>
              <span className="block text-xs text-muted mt-1">बिल से स्टॉक अपडेट</span>
            </div>
            <span className="font-pixel text-mint text-sm mt-3">&gt; Scan bill</span>
          </button>

          <button
            onClick={() => onNavigate("scan", "shelf")}
            className="press flex flex-col justify-between border-2 border-sky bg-panel p-3 text-left hover:border-sky"
          >
            <div>
              <span className="font-pixel text-[10px] text-sky">PHASE 2</span>
              <span className="block font-pixel text-sm text-paper mt-0.5">Shelf Check</span>
              <span className="block text-xs text-muted mt-1">शेल्फ की फोटो लो</span>
            </div>
            <span className="font-pixel text-sky text-sm mt-3">&gt; Check status</span>
          </button>
        </div>
        <button
          onClick={() => onNavigate("poocho")}
          className="press flex w-full items-center justify-between border-2 border-sky bg-panel p-3 text-left hover:border-sky"
        >
          <span>
            <span className="block font-pixel text-sm text-sky">Poocho AI</span>
            <span className="block text-xs text-muted">हिंदी/मराठी में सवाल पूछें</span>
          </span>
          <span className="font-pixel text-sky">&gt;</span>
        </button>
      </div>

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
        <div className="grid grid-cols-3 gap-2">
          {COMING.map((c) => (
            <div key={c.title} className={`border-2 border-t-4 ${c.accent} bg-panel p-2.5`}>
              <p className="font-mono text-[9px] text-muted">PHASE {c.phase}</p>
              <p className="font-semibold text-xs leading-tight text-paper">{c.title}</p>
              <p className="text-[11px] text-muted mt-0.5">{c.hint}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
