import { useState } from "react";
import Nav, { type Tab } from "./components/Nav";
import Home from "./screens/Home";
import Ledger from "./screens/Ledger";
import Scan, { type ScanMode } from "./screens/Scan";
import Stock from "./screens/Stock";
import Poocho from "./screens/Poocho";

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [scanMode, setScanMode] = useState<ScanMode>("khata");
  const [toast, setToast] = useState("");

  function onSaved(target: "ledger" | "stock", msg: string) {
    setTab(target);
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  function handleNavigate(newTab: Tab, mode?: ScanMode) {
    if (mode) {
      setScanMode(mode);
    }
    setTab(newTab);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-24 pt-6">
      {tab === "home" && <Home onNavigate={handleNavigate} />}
      {tab === "scan" && <Scan key={scanMode} initialMode={scanMode} onSaved={onSaved} />}
      {tab === "stock" && (
        <Stock
          onScanBill={() => {
            setScanMode("bill");
            setTab("scan");
          }}
        />
      )}
      {tab === "ledger" && <Ledger />}
      {tab === "poocho" && <Poocho />}

      {toast && (
        <div className="fixed inset-x-4 top-4 z-30 mx-auto max-w-md border-2 border-mint bg-ink px-4 py-3 font-pixel text-xs text-mint">
          {toast}
        </div>
      )}
      <Nav tab={tab} onChange={(t) => handleNavigate(t)} />
    </div>
  );
}
