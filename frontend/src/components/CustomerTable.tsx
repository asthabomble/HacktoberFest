import { ChevronRight, MessageCircle } from "lucide-react";
import type { CustomerSummary } from "../lib/api";
import { formatRupees } from "../lib/format";

/** CUSTOMER / DUE / DAYS table from the design. Days turn red once overdue. */
export default function CustomerTable({
  customers,
  overdueDays,
  onOpen,
  action = "message",
}: {
  customers: CustomerSummary[];
  overdueDays: number;
  onOpen: (id: number) => void;
  action?: "message" | "chevron";
}) {
  return (
    <table className="w-full table-fixed text-left">
      <thead>
        <tr className="border-b border-line bg-soft text-xs font-medium uppercase tracking-wider text-muted">
          <th className="py-2.5 pl-4 font-medium">Customer</th>
          <th className="w-28 py-2.5 text-right font-medium">Due</th>
          <th className="w-16 py-2.5 text-right font-medium">Days</th>
          <th className="w-12" />
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
                <MessageCircle size={20} className="ml-auto" />
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
