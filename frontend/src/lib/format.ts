const rupee = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const plain = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const formatRupees = (n: number) => rupee.format(n);

/** 1,000 without the ₹ sign, for table columns */
export const formatNumber = (n: number) => plain.format(n);

const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  hi: ["जन", "फ़र", "मार्च", "अप्रै", "मई", "जून", "जुला", "अग", "सित", "अक्टू", "नव", "दिस"],
  mr: ["जाने", "फेब्रु", "मार्च", "एप्रि", "मे", "जून", "जुलै", "ऑग", "सप्टें", "ऑक्टो", "नोव्हें", "डिसें"],
};

// Set by the language provider so dates follow the हिं / EN toggle without threading lang everywhere
let dateLang: "en" | "hi" | "mr" = "en";
export function setDateLanguage(lang: "en" | "hi" | "mr") {
  dateLang = lang;
}

/** "05 Sep" / "05 सित" — fixed short months (en-IN would print "Sept") */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${MONTHS[dateLang][Number(m) - 1]}`;
}

export function formatToday(lang: string = "en"): string {
  const locale = lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN";
  return new Date().toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

export const today = () => new Date().toISOString().slice(0, 10);

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => [...p][0]).join("").toUpperCase() || "?";
}
