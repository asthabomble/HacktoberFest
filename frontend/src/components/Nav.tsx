export type Tab = "home" | "scan" | "stock" | "ledger" | "poocho";

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "scan", label: "Scan" },
  { id: "stock", label: "Stock" },
  { id: "ledger", label: "Khata" },
  { id: "poocho", label: "Poocho" },
];

export default function Nav({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 h-14 border-t-2 border-line bg-ink/95 backdrop-blur">
      <div className="mx-auto grid h-full max-w-md grid-cols-5 font-pixel text-[11px]">
        {TABS.map((t) =>
          t.id ? (
            <button
              key={t.label}
              onClick={() => onChange(t.id!)}
              className={tab === t.id ? "bg-panel text-marigold" : "text-muted hover:text-paper"}
            >
              {t.label}
            </button>
          ) : (
            <span key={t.label} className="grid place-items-center text-line">
              {t.label}
            </span>
          ),
        )}
      </div>
    </nav>
  );
}
