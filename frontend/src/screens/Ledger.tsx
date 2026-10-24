import { useEffect, useState } from "react";
import { apiGet, imageUrl, type CustomerList, type Ledger as LedgerData } from "../lib/api";
import { formatDate, formatRupees } from "../lib/format";

function balanceColor(n: number) {
  return n > 0 ? "text-rose" : n < 0 ? "text-mint" : "text-muted";
}

function CustomerLedger({ id, onBack }: { id: number; onBack: () => void }) {
  const [data, setData] = useState<LedgerData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<LedgerData>(`/api/customers/${id}/ledger`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  return (
    <>
      <button onClick={onBack} className="mb-4 font-pixel text-xs text-muted hover:text-paper">
        &lt; Sab grahak
      </button>
      {error && <p className="font-mono text-sm text-rose">{error}</p>}
      {!data && !error && <p className="font-pixel text-sm text-muted">Loading…</p>}
      {data && (
        <>
          <div className="block-shadow mb-5 border-2 border-line bg-panel p-4">
            <h1 className="text-2xl font-semibold">{data.customer.name}</h1>
            <p className="text-sm text-muted">{data.balance >= 0 ? "Baaki (dena hai)" : "Advance (jama zyada)"}</p>
            <p className={`font-mono text-3xl font-extrabold ${balanceColor(data.balance)}`}>
              {formatRupees(Math.abs(data.balance))}
            </p>
          </div>

          <div className="grid grid-cols-[3.5rem_1fr_5rem_5rem] gap-x-2 border-b-2 border-line pb-2 font-pixel text-[10px] text-muted">
            <span>Date</span>
            <span>Detail</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Baaki</span>
          </div>
          <ul>
            {data.entries.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[3.5rem_1fr_5rem_5rem] items-baseline gap-x-2 border-b border-line py-2.5 text-sm"
              >
                <span className="font-mono text-xs text-muted">{formatDate(e.entry_date)}</span>
                <span className="min-w-0 break-words">
                  {e.raw_text || (e.type === "gave" ? "Udhaar" : "Jama")}
                  {e.source_image && (
                    <a
                      href={imageUrl(e.source_image)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 font-mono text-[10px] text-sky"
                    >
                      [photo]
                    </a>
                  )}
                </span>
                <span className={`text-right font-mono ${e.type === "gave" ? "text-rose" : "text-mint"}`}>
                  {e.type === "gave" ? "+" : "−"}
                  {formatRupees(e.amount).replace("₹", "")}
                </span>
                <span className="text-right font-mono">{formatRupees(e.running_balance).replace("₹", "")}</span>
              </li>
            ))}
          </ul>
          {data.entries.length === 0 && <p className="py-6 text-center text-muted">Koi entry nahi.</p>}
        </>
      )}
    </>
  );
}

export default function Ledger() {
  const [data, setData] = useState<CustomerList | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (selected !== null) return;
    apiGet<CustomerList>("/api/customers")
      .then(setData)
      .catch((e) => setError(e.message));
  }, [selected]);

  if (selected !== null) return <CustomerLedger id={selected} onBack={() => setSelected(null)} />;

  const customers = (data?.customers ?? []).filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <h1 className="font-pixel text-xl text-marigold">Khata</h1>
      <div className="block-shadow mb-5 mt-3 border-2 border-line bg-panel p-4">
        <p className="font-pixel text-[10px] text-muted">KUL BAAKI · TOTAL OUTSTANDING</p>
        <p className="font-mono text-3xl font-extrabold text-rose">{formatRupees(data?.total_outstanding ?? 0)}</p>
        <p className="text-sm text-muted">{data?.customers.length ?? 0} grahak</p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Naam dhoondo…"
        className="mb-3 w-full border-2 border-line bg-ink px-3 py-2 outline-none focus:border-marigold"
      />

      {error && <p className="font-mono text-sm text-rose">{error}</p>}
      <ul className="space-y-2">
        {customers.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => setSelected(c.id)}
              className="press flex w-full items-center justify-between border-2 border-line bg-panel px-3 py-3 text-left hover:border-marigold"
            >
              <span>
                <span className="block font-semibold">{c.name}</span>
                <span className="block font-mono text-xs text-muted">last: {formatDate(c.last_entry)}</span>
              </span>
              <span className="text-right">
                <span className={`block font-mono text-lg font-semibold ${balanceColor(c.balance)}`}>
                  {formatRupees(Math.abs(c.balance))}
                </span>
                <span className="block font-pixel text-[9px] text-muted">
                  {c.balance > 0 ? "baaki" : c.balance < 0 ? "advance" : "clear"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {data && data.customers.length === 0 && (
        <p className="py-10 text-center text-muted">Abhi koi grahak nahi. Pehle khata scan karo.</p>
      )}
    </>
  );
}
