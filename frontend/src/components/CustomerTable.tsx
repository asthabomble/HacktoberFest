import { ChevronRight, MessageCircle } from "lucide-react";
import type { CustomerSummary } from "../lib/api";
import { formatRupees } from "../lib/format";
import { useLang } from "../lib/i18n";

/** CUSTOMER / DUE / DAYS table from the design. Days turn red once overdue. */
export default function CustomerTable({
  customers,
  overdueDays,
  onOpen,
  onReminder,
  action = "message",
}: {
  customers: CustomerSummary[];
  overdueDays: number;
  onOpen: (id: number) => void;
  onReminder?: (customer: CustomerSummary) => void;
  action?: "message" | "chevron";
}) {
  const { t } = useLang();
  return (
    <table className="w-full table-fixed text-left">
      <thead>
        <tr className="border-b border-line bg-soft text-xs font-medium uppercase tracking-wider text-muted">
          <th className="py-2.5 pl-4 font-medium">{t("Customer")}</th>
          <th className="w-24 py-2.5 text-right font-medium">{t("Due")}</th>
          <th className="w-14 py-2.5 text-right font-medium">{t("Days")}</th>
          <th className="w-11" />
        </tr>
      </thead>
      <tbody>
        {customers.map((c) => (
          <tr key={c.id} onClick={() => onOpen(c.id)} className="cursor-pointer border-b border-line last:border-b-0 active:bg-soft">
            <td className="truncate py-3.5 pl-4 text-[15px]">{c.name}</td>
            <td className={`py-3.5 text-right font-mono text-[15px] ${c.balance < 0 ? "text-brand" : ""}`}>
              {c.balance < 0 ? "−" : ""}
              {formatRupees(Math.abs(c.balance))}
            </td>
            <td className={`py-3.5 text-right font-mono text-[15px] ${c.days_due >= overdueDays ? "text-danger" : "text-muted"}`}>
              {c.balance > 0 ? c.days_due : "—"}
            </td>
            <td className="py-3.5 pr-3 text-right text-brand">
              {action === "message" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    if (onReminder) {
                      e.stopPropagation();
                      onReminder(c);
                    }
                  }}
                  aria-label={t("Send reminder to {name}", { name: c.name })}
                  className="ml-auto flex items-center justify-center p-1 text-brand hover:text-logo"
                >
                  <MessageCircle size={20} />
                </button>
              ) : (
                <ChevronRight size={20} className="ml-auto text-muted" />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
