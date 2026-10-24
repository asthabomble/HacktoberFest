import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { setDateLanguage } from "./format";
import { EN, HI, HINGLISH, MR, type TKey } from "./translations";

/*
  UI language: English, Hindi, Marathi or Hinglish (dropdown in every header).
  Screens call t("English text"); translations live in ./translations.ts.
  {name} placeholders are filled from the vars argument: t("{n} customers", { n: 5 }).
*/

export type { TKey };
export type Lang = "en" | "hi" | "mr" | "hinglish";

export const LANGUAGES: { code: Lang; label: string; short: string }[] = [
  { code: "en", label: "English", short: "English" },
  { code: "hi", label: "Hindi (हिन्दी)", short: "हिन्दी" },
  { code: "mr", label: "Marathi (मराठी)", short: "मराठी" },
  { code: "hinglish", label: "Hinglish", short: "Hinglish" },
];

/** Browser speech-recognition language for the current UI language */
export function speechLang(lang: Lang): string {
  return lang === "mr" ? "mr-IN" : lang === "en" ? "en-IN" : "hi-IN";
}

/** Reminder drafts support hi / mr / en; Hinglish users get Hindi */
export function reminderLang(lang: Lang): "hi" | "mr" | "en" {
  return lang === "hinglish" ? "hi" : lang;
}

type Vars = Record<string, string | number>;

type LangContext = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TKey, vars?: Vars) => string;
};

const Ctx = createContext<LangContext | null>(null);

const isLang = (v: string | null): v is Lang => v === "en" || v === "hi" || v === "mr" || v === "hinglish";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("lang") ?? localStorage.getItem("hisaab_lang"); // older key from the onboarding branch
    if (isLang(saved)) return saved;
  } catch {
    // storage blocked (private mode): fall back to English
  }
  return "en";
}

function lookup(lang: Lang, key: TKey): string {
  switch (lang) {
    case "hi":
      return HI[key];
    case "mr":
      return MR[key];
    case "en":
      return EN[key] ?? key;
    case "hinglish":
      return HINGLISH[key] ?? key;
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  setDateLanguage(lang === "hi" || lang === "mr" ? lang : "en"); // before children render, so their dates match

  useEffect(() => {
    document.documentElement.lang = lang === "hinglish" ? "hi-Latn" : lang;
  }, [lang]);

  function setLang(next: Lang) {
    setLangState(next);
    try {
      localStorage.setItem("lang", next);
    } catch {
      // not persisted, still switches for this visit
    }
  }

  function t(key: TKey, vars?: Vars) {
    let text = lookup(lang, key);
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useLang(): LangContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLang must be used inside <LanguageProvider>");
  return ctx;
}

/** Language dropdown for the header (from the onboarding branch) */
export function LanguageDropdown({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (container.current && !container.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={container} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("Switch language")}
        className="flex h-9 items-center gap-1.5 border-2 border-logo px-2 text-sm font-semibold text-logo"
      >
        <Globe size={15} className="shrink-0" />
        <span className="max-w-[72px] truncate">{current.short}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1.5 w-48 border border-line bg-white py-1 shadow-lg">
          <div className="border-b border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Language / भाषा
          </div>
          {LANGUAGES.map((opt) => (
            <button
              key={opt.code}
              role="menuitemradio"
              aria-checked={opt.code === lang}
              onClick={() => {
                setLang(opt.code);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm ${
                opt.code === lang ? "bg-chip font-semibold text-ink" : "text-ink hover:bg-soft"
              }`}
            >
              {opt.label}
              {opt.code === lang && <Check size={15} className="shrink-0 text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
