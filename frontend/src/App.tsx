import { useState } from "react";
import Nav, { type Tab } from "./components/Nav";
import Home from "./screens/Home";
import Ledger from "./screens/Ledger";
import Scan from "./screens/Scan";

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [toast, setToast] = useState("");

  function onSaved() {
    setTab("ledger");
    setToast("Khate mein save ho gaya ✓");
    setTimeout(() => setToast(""), 2500);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-24 pt-6">
      {tab === "home" && <Home onNavigate={setTab} />}
      {tab === "scan" && <Scan onSaved={onSaved} />}
      {tab === "ledger" && <Ledger />}

      {toast && (
        <div className="fixed inset-x-4 top-4 z-30 mx-auto max-w-md border-2 border-mint bg-ink px-4 py-3 font-pixel text-xs text-mint">
          {toast}
        </div>
      )}
      <Nav tab={tab} onChange={setTab} />
    </div>
  );
}
