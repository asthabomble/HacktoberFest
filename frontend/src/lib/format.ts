const rupee = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const plain = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const formatRupees = (n: number) => rupee.format(n);

/** 1,000 without the ₹ sign, for table columns */
export const formatNumber = (n: number) => plain.format(n);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "05 Sep" — fixed 3-letter months (en-IN would print "Sept") */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1]}`;
}

export function formatToday(): string {
  return new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export const today = () => new Date().toISOString().slice(0, 10);

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => [...p][0]).join("").toUpperCase() || "?";
}
