export type Tab = "home" | "scan" | "ledger";

const TABS: { id: Tab | null; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "scan", label: "Scan" },
  { id: "ledger", label: "Khata" },
  { id: null, label: "Poocho" }, // Phase 3
];

export default function Nav({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 h-14 border-t-2 border-line bg-ink/95 backdrop-blur">
      <div className="mx-auto grid h-full max-w-md grid-cols-4 font-pixel text-[11px]">
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
