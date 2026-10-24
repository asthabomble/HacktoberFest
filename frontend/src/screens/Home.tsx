import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import CustomerTable from "../components/CustomerTable";
import type { ScanMode } from "./Scan";
import { StockList } from "./Stock";
import { Card, Chip, PrimaryButton, Tabs } from "../components/ui";
import { apiGet, type CustomerList, type Overview } from "../lib/api";
import { formatRupees, formatToday } from "../lib/format";

export type HomeTab = "overview" | "udhaar" | "stock" | "alerts";

function Stat({ label, value, tone, className = "" }: { label: string; value: string; tone?: "red" | "brown"; className?: string }) {
  const color = tone === "red" ? "text-danger" : tone === "brown" ? "text-brand" : "text-ink";
  return (
    <div className={`border-line p-4 ${className}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold leading-tight ${color}`}>{value}</p>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="px-4 py-8 text-center text-muted">{children}</p>;
}

export default function Home({
  initialTab = "overview",
  onOpenCustomer,
  onOpenProduct,
  onScan,
  onViewAll,
}: {
  initialTab?: HomeTab;
  onOpenCustomer: (id: number) => void;
  onOpenProduct: (id: number) => void;
  onScan: (mode: ScanMode) => void;
  onViewAll: () => void;
}) {
  const [tab, setTab] = useState<HomeTab>(initialTab);
  const [data, setData] = useState<Overview | null>(null);
  const [all, setAll] = useState<CustomerList | null>(null);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState("");

  useEffect(() => {
    Promise.all([apiGet<Overview>("/api/overview"), apiGet<CustomerList>("/api/customers")])
      .then(([o, c]) => {
        setData(o);
        setAll(c);
        setLoadedAt(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }));
      })
      .catch((e) => setError(e.message));
  }, []);

  const owing = (all?.customers ?? []).filter((c) => c.balance > 0);
  const overdue = owing.filter((c) => c.days_due >= (data?.overdue_days ?? 30));

  return (
    <>
      <div className="border-b border-line bg-white">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-xl font-semibold">{data?.shop.name ?? "…"}</h2>
            <span className="shrink-0 text-sm text-muted">{formatToday()}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip>{data?.customer_count ?? 0} customers</Chip>
            {loadedAt && <Chip tone="gray">Updated {loadedAt}</Chip>}
          </div>
        </div>
      </div>

      <Tabs<HomeTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "udhaar", label: "Udhaar" },
          { id: "stock", label: "Stock" },
          { id: "alerts", label: "Alerts", badge: overdue.length },
        ]}
      />

      <div className="mx-auto max-w-md space-y-5 px-4 py-4">
        {error && <p className="text-sm text-danger">Server se data nahi mila: {error}</p>}

        {tab === "overview" && (
          <>
            <Card className="grid grid-cols-2">
              <Stat label="Total outstanding" value={formatRupees(data?.total_outstanding ?? 0)} className="border-b border-r" />
              <Stat label="Udhaar today" value={formatRupees(data?.udhaar_today ?? 0)} className="border-b" />
              <Stat label={`Overdue ${data?.overdue_days ?? 30}+ days`} value={String(data?.overdue_count ?? 0)} tone="red" className="border-r" />
              <Stat label="Low stock items" value={data?.low_stock_count == null ? "—" : String(data.low_stock_count)} tone="brown" />
            </Card>

            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h3 className="text-lg font-semibold">Top debtors</h3>
                <button onClick={onViewAll} className="font-medium text-brand">
                  View all
                </button>
              </div>
              {data && data.top_debtors.length > 0 ? (
                <CustomerTable customers={data.top_debtors} overdueDays={data.overdue_days} onOpen={onOpenCustomer} />
              ) : (
                <Empty>Abhi koi udhaar nahi. Pehla khata page scan karein.</Empty>
              )}
            </Card>

            <PrimaryButton icon={Camera} onClick={() => onScan("khata")} className="w-full">
              Scan khata page
            </PrimaryButton>
          </>
        )}

        {tab === "udhaar" && (
          <Card>
            {owing.length > 0 ? (
              <CustomerTable customers={owing} overdueDays={all!.overdue_days} onOpen={onOpenCustomer} action="chevron" />
            ) : (
              <Empty>Kisi ka udhaar baaki nahi.</Empty>
            )}
          </Card>
        )}

        {tab === "stock" && (
          <StockList onOpen={onOpenProduct} onScanBill={() => onScan("bill")} onScanShelf={() => onScan("shelf")} />
        )}

        {tab === "alerts" && (
          <Card>
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-lg font-semibold">Overdue udhaar</h3>
              <p className="text-sm text-muted">
                {data?.overdue_days ?? 30}+ din se koi payment nahi aaya
              </p>
            </div>
            {overdue.length > 0 ? (
              <CustomerTable customers={overdue} overdueDays={all!.overdue_days} onOpen={onOpenCustomer} />
            ) : (
              <Empty>Koi overdue nahi. Sab theek hai.</Empty>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
