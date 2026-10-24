import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import CustomerTable from "../components/CustomerTable";
import { Card } from "../components/ui";
import { apiGet, type CustomerList } from "../lib/api";
import { formatRupees } from "../lib/format";

export default function Customers({ onOpen, focusSearch }: { onOpen: (id: number) => void; focusSearch?: boolean }) {
  const [data, setData] = useState<CustomerList | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiGet<CustomerList>("/api/customers")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  const customers = (data?.customers ?? []).filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <>
      <div className="border-b border-line bg-white">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">Customers</h2>
            <span className="text-sm text-muted">
              {data?.customers.length ?? 0} total · {formatRupees(data?.total_outstanding ?? 0)} due
            </span>
          </div>
          <div className="relative mt-3">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Naam se dhoondo"
              className="w-full border-b-2 border-line bg-soft py-2.5 pl-10 pr-3 text-[15px] outline-none placeholder:text-muted focus:border-brand"
            />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 py-4">
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <Card>
          {customers.length > 0 ? (
            <CustomerTable customers={customers} overdueDays={data!.overdue_days} onOpen={onOpen} action="chevron" />
          ) : (
            <p className="px-4 py-8 text-center text-muted">
              {data?.customers.length ? "Is naam ka koi customer nahi." : "Abhi koi customer nahi. Khata page scan karein."}
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
