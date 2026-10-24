import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";

export type Language = "en" | "hi" | "mr" | "hinglish";

export interface LanguageOption {
  code: Language;
  label: string;
  nativeName: string;
  shortLabel: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English", nativeName: "English", shortLabel: "English" },
  { code: "hi", label: "Hindi (हिन्दी)", nativeName: "हिन्दी", shortLabel: "हिन्दी" },
  { code: "mr", label: "Marathi (मराठी)", nativeName: "मराठी", shortLabel: "मराठी" },
  { code: "hinglish", label: "Hinglish", nativeName: "Hinglish", shortLabel: "Hinglish" },
];

const TRANSLATIONS: Record<string, Record<Language, string>> = {
  // Navigation
  nav_home: { en: "Home", hi: "होम", mr: "होम", hinglish: "Home" },
  nav_customers: { en: "Customers", hi: "ग्राहक", mr: "ग्राहक", hinglish: "Customers" },
  nav_scan: { en: "Scan", hi: "स्कैन", mr: "स्कॅन", hinglish: "Scan" },
  nav_ask: { en: "Ask AI", hi: "पूछो AI", mr: "विचारा AI", hinglish: "Poocho AI" },

  // Home Tabs
  tab_overview: { en: "Overview", hi: "ओवरव्यू", mr: "आढावा", hinglish: "Overview" },
  tab_udhaar: { en: "Credit", hi: "उधार", mr: "उधारी", hinglish: "Udhaar" },
  tab_stock: { en: "Stock", hi: "स्टॉक", mr: "स्टॉक", hinglish: "Stock" },
  tab_alerts: { en: "Alerts", hi: "अलर्ट", mr: "अलर्ट", hinglish: "Alerts" },

  // Stats
  total_outstanding: { en: "Total outstanding", hi: "कुल बकाया", mr: "एकूण येणे", hinglish: "Total outstanding" },
  udhaar_today: { en: "Credit today", hi: "आज का उधार", mr: "आजची उधारी", hinglish: "Aaj ka udhaar" },
  overdue_label: { en: "Overdue {days}+ days", hi: "बकाया {days}+ दिन", mr: "थकीत {days}+ दिवस", hinglish: "Overdue {days}+ din" },
  low_stock_items: { en: "Low stock items", hi: "कम स्टॉक सामान", mr: "कमी साठा माल", hinglish: "Low stock items" },
  top_debtors: { en: "Top debtors", hi: "शीर्ष बकायेदार", mr: "सर्वात जास्त उधारी", hinglish: "Top debtors" },
  view_all: { en: "View all", hi: "सभी देखें", mr: "सर्व पहा", hinglish: "View all" },
  scan_khata_btn: { en: "Scan khata page", hi: "खाता पेज स्कैन करें", mr: "खाते पान स्कॅन करा", hinglish: "Khata page scan karein" },
  customers_chip: { en: "{count} customers", hi: "{count} ग्राहक", mr: "{count} ग्राहक", hinglish: "{count} customers" },
  updated_chip: { en: "Updated {time}", hi: "अपडेट {time}", mr: "अद्यतनित {time}", hinglish: "Updated {time}" },

  // Empty states
  empty_no_debtors: {
    en: "No credit yet. Scan your first khata page.",
    hi: "अभी कोई उधार नहीं। पहला खाता पेज स्कैन करें।",
    mr: "अद्याप कोणतीही उधारी नाही. पहिले खाते पान स्कॅन करा.",
    hinglish: "Abhi koi udhaar nahi. Pehla khata page scan karein.",
  },
  empty_all_settled: {
    en: "All accounts are settled. No pending credit.",
    hi: "किसी का उधार बाकी नहीं है। सब चुकता है।",
    mr: "कोणाचीही उधारी बाकी नाही. सर्व खाते पूर्ण आहे.",
    hinglish: "Kisi ka udhaar baaki nahi. Sab accounts clear hain.",
  },
  empty_no_overdue: {
    en: "No overdue accounts. All good.",
    hi: "कोई बकाया नहीं। सब ठीक है।",
    mr: "काहीही थकीत नाही. सर्व सुरळीत आहे.",
    hinglish: "Koi overdue nahi. Sab theek hai.",
  },
  overdue_subtext: {
    en: "No payment received in {days}+ days",
    hi: "{days}+ दिनों से कोई भुगतान नहीं आया",
    mr: "{days}+ दिवसांपासून कोणतीही जमा नाही",
    hinglish: "{days}+ din se koi payment nahi aaya",
  },

  // Customers screen
  customers_title: { en: "Customers", hi: "ग्राहक", mr: "ग्राहक", hinglish: "Customers" },
  search_placeholder: {
    en: "Search by customer name...",
    hi: "ग्राहक के नाम से खोजें...",
    mr: "ग्राहकाच्या नावाने शोधा...",
    hinglish: "Customer naam se dhoondo...",
  },
  customers_summary: {
    en: "{count} total · {due} due",
    hi: "{count} कुल · {due} बकाया",
    mr: "{count} एकूण · {due} बाकी",
    hinglish: "{count} total · {due} due",
  },
  no_customer_found: {
    en: "No customer found with this name.",
    hi: "इस नाम का कोई ग्राहक नहीं मिला।",
    mr: "या नावाचा ग्राहक आढळला नाही.",
    hinglish: "Is naam ka koi customer nahi mila.",
  },
  no_customers_start: {
    en: "No customers yet. Scan a khata page to begin.",
    hi: "अभी कोई ग्राहक नहीं। खाता पेज स्कैन करें।",
    mr: "अद्याप ग्राहक नाहीत. खाते पान स्कॅन करा.",
    hinglish: "Abhi koi customer nahi. Khata page scan karein.",
  },

  // Ask / Poocho Screen
  pucho_title: { en: "Ask AI", hi: "पूछो AI", mr: "विचारा AI", hinglish: "Poocho AI" },
  pucho_tab_chat: { en: "Chat", hi: "चैट", mr: "चर्चा", hinglish: "Chat" },
  pucho_tab_history: { en: "History", hi: "इतिहास", mr: "इतिहास", hinglish: "History" },
  pucho_hint: {
    en: "Ask about credit or stock in English, Hindi, or Marathi.",
    hi: "उधार या स्टॉक के बारे में English, हिन्दी या मराठी में पूछिए।",
    mr: "उधारी किंवा साठ्याबद्दल English, मराठी किंवा हिंदीत विचारा.",
    hinglish: "Udhaar ya stock ke baare mein English, Hindi ya Marathi mein puchiye.",
  },
  pucho_placeholder: {
    en: "Ask in English, Hindi, Marathi, or Hinglish...",
    hi: "English, हिन्दी, मराठी या Hinglish में पूछें...",
    mr: "English, मराठी, हिंदी किंवा Hinglish मध्ये विचारा...",
    hinglish: "English, Hindi, Marathi ya Hinglish mein puchiye...",
  },
  try_asking: { en: "Try asking", hi: "यह पूछकर देखें", mr: "हे विचारून पहा", hinglish: "Try poochhein" },
  gemma_thinking: {
    en: "Gemma is calculating records...",
    hi: "Gemma हिसाब जोड़ रहा है…",
    mr: "Gemma हिशोब जोडत आहे…",
    hinglish: "Gemma hisaab jod raha hai…",
  },
  no_questions_yet: {
    en: "No questions asked yet.",
    hi: "अभी तक कोई सवाल नहीं पूछा गया।",
    mr: "अद्याप कोणताही प्रश्न विचारलेला नाही.",
    hinglish: "Abhi koi sawaal nahi pucha gaya.",
  },
  diya_udhaar: { en: "Gave (credit)", hi: "दिया (उधार)", mr: "दिली (उधारी)", hinglish: "Diya (udhaar)" },
  jama_mila: { en: "Got (received)", hi: "जमा (मिला)", mr: "मिळाले (जमा)", hinglish: "Jama (mila)" },
};

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem("hisaab_lang");
    if (saved === "en" || saved === "hi" || saved === "mr" || saved === "hinglish") {
      return saved;
    }
    return "en"; // Default is English
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem("hisaab_lang", newLang);
  };

  const t = (key: string, replacements?: Record<string, string | number>): string => {
    const row = TRANSLATIONS[key];
    let text = row ? row[lang] || row.en || key : key;
    if (replacements) {
      for (const [rKey, rVal] of Object.entries(replacements)) {
        text = text.replace(new RegExp(`\\{${rKey}\\}`, "g"), String(rVal));
      }
    }
    return text;
  };

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

/**
 * Clean interactive language dropdown for top right corner.
 * English is selected by default.
 */
export function LanguageDropdown({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentOpt = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Select language"
        className="flex items-center gap-1.5 rounded border border-logo/40 bg-white/10 px-2.5 py-1 text-xs font-semibold text-logo hover:bg-white/20 active:scale-95 transition"
      >
        <Globe size={13} className="shrink-0 text-logo opacity-90" />
        <span className="truncate max-w-[70px] sm:max-w-none">{currentOpt.shortLabel}</span>
        <ChevronDown size={13} className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-md border border-line bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          <div className="border-b border-line/60 px-3 py-1.5 text-[11px] font-semibold text-muted uppercase tracking-wider">
            Language / भाषा
          </div>
          {LANGUAGES.map((opt) => {
            const isSelected = opt.code === lang;
            return (
              <button
                key={opt.code}
                role="menuitem"
                onClick={() => {
                  setLang(opt.code);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition ${
                  isSelected ? "bg-chip font-bold text-ink" : "text-ink hover:bg-soft"
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && <Check size={14} className="text-brand shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
