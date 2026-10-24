import type { ReactNode } from "react";
import { BookOpen, ChevronLeft, FileText, House, MessageSquare, ScanLine, Search, type LucideIcon } from "lucide-react";
import { LanguageDropdown, useLang, type TKey } from "../lib/i18n";

/* ---------- Headers ---------- */

export function MainHeader({ onSearch }: { onSearch: () => void }) {
  const { t } = useLang();
  return (
    <header className="sticky top-0 z-20 bg-bar">
      <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-4">
        <span className="grid size-8 place-items-center rounded-md bg-logo text-bar">
          <BookOpen size={18} strokeWidth={2.2} />
        </span>
        <span className="flex-1 text-xl text-logo">
          <span className="font-bold">Hisaab</span>Kitaab
        </span>
        <button onClick={onSearch} aria-label={t("Search customers")} className="grid size-9 place-items-center text-logo">
          <Search size={22} />
        </button>
        <LanguageDropdown />
      </div>
    </header>
  );
}

export function SubHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  const { t } = useLang();
  return (
    <header className="sticky top-0 z-20 bg-bar">
      <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-2">
        <button onClick={onBack} aria-label={t("Back")} className="grid size-10 place-items-center text-logo">
          <ChevronLeft size={24} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-logo">{title}</h1>
        {right ?? <LanguageDropdown className="mr-2" />}
      </div>
    </header>
  );
}

/* ---------- Tabs ---------- */

export type TabItem<T extends string> = {
  id: T;
  label: string;
  badge?: number;
  badgeTone?: "red" | "orange";
  disabled?: boolean;
};

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  stretch,
}: {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  stretch?: boolean;
}) {
  return (
    <div className="border-b border-line bg-white">
      <div className={`mx-auto flex max-w-md px-1 ${stretch ? "" : "gap-1"}`}>
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              disabled={t.disabled}
              onClick={() => onChange(t.id)}
              className={`relative flex items-center justify-center gap-1.5 px-3 py-3 text-[15px] ${stretch ? "flex-1" : ""} ${
                isActive ? "font-semibold text-ink" : "text-muted"
              } disabled:opacity-45`}
            >
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span
                  className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs font-semibold ${
                    t.badgeTone === "orange" ? "bg-warn text-ink" : "bg-danger text-white"
                  }`}
                >
                  {t.badge}
                </span>
              )}
              {isActive && <span className="absolute inset-x-0 -bottom-px h-[3px] bg-brand" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Buttons ---------- */

export function PrimaryButton({
  children,
  icon: Icon,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-12 items-center justify-between gap-3 bg-bar px-4 text-left text-base font-medium text-logo active:bg-bar-strong disabled:opacity-50 ${className}`}
    >
      <span>{children}</span>
      {Icon && <Icon size={22} />}
    </button>
  );
}

export function OutlineButton({
  children,
  icon: Icon,
  onClick,
  className = "",
}: {
  children: ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-12 items-center justify-center gap-2 border-2 border-brand bg-white px-4 font-medium text-brand active:bg-chip ${className}`}
    >
      {Icon && <Icon size={20} />}
      {children}
    </button>
  );
}

/** Fixed bar at the bottom of sub-screens (Retake / Confirm, + Entry / Reminder, …) */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-page pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md gap-3 px-4 py-3">{children}</div>
    </div>
  );
}

/* ---------- Small pieces ---------- */

export function Chip({ children, tone = "yellow" }: { children: ReactNode; tone?: "yellow" | "gray" | "red" }) {
  const tones = {
    yellow: "bg-chip text-info-text",
    gray: "bg-soft text-muted",
    red: "bg-danger-soft text-danger font-medium",
  };
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm ${tones[tone]}`}>{children}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border border-line bg-white ${className}`}>{children}</section>;
}

/** Grey placeholder shown while data loads */
export function Skeleton({ className = "h-4 w-24" }: { className?: string }) {
  return <span className={`inline-block animate-pulse rounded-sm bg-line/70 align-middle ${className}`} />;
}

/** Placeholder rows for a table/list card while it loads */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 border-b border-line px-4 py-4 last:border-b-0">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Bottom navigation ---------- */

export type NavId = "home" | "customers" | "scan" | "ask";

const NAV: { id: NavId; label: TKey; icon: LucideIcon; disabled?: boolean }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "customers", label: "Customers", icon: FileText },
  { id: "scan", label: "Scan", icon: ScanLine },
  { id: "ask", label: "Ask", icon: MessageSquare },
];

export function BottomNav({ active, onChange }: { active: NavId; onChange: (id: NavId) => void }) {
  const { t } = useLang();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid h-16 max-w-md grid-cols-4">
        {NAV.map(({ id, label, icon: Icon, disabled }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              disabled={disabled}
              onClick={() => onChange(id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[13px] font-medium ${
                isActive ? "text-brand" : "text-muted"
              } disabled:opacity-40`}
            >
              {isActive && <span className="absolute inset-x-0 -top-px h-[3px] bg-brand" />}
              <Icon size={24} strokeWidth={1.8} />
              {t(label)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
