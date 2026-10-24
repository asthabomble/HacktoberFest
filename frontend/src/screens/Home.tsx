import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import CustomerTable from "../components/CustomerTable";
import ReminderSheet from "../components/ReminderSheet";
import type { ScanMode } from "./Scan";
import { StockList } from "./Stock";
import { Card, Chip, PrimaryButton, Tabs } from "../components/ui";
import { apiGet, type CustomerList, type CustomerSummary, type Overview } from "../lib/api";
import { formatRupees, formatToday } from "../lib/format";
import { useLanguage } from "../lib/language";

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
  const { t } = useLanguage();
  const [tab, setTab] = useState<HomeTab>(initialTab);
  const [data, setData] = useState<Overview | null>(null);
  const [all, setAll] = useState<CustomerList | null>(null);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState("");
  const [reminderCustomer, setReminderCustomer] = useState<CustomerSummary | null>(null);

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
  const lowStockAlerts = data?.low_stock_alerts ?? [];
  const totalAlertsCount = overdue.length + lowStockAlerts.length;

  return (
    <>
      <div className="border-b border-line bg-white">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-xl font-semibold">{data?.shop.name ?? "…"}</h2>
            <span className="shrink-0 text-sm text-muted">{formatToday()}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip>{t("customers_chip", { count: data?.customer_count ?? 0 })}</Chip>
            {loadedAt && <Chip tone="gray">{t("updated_chip", { time: loadedAt })}</Chip>}
          </div>
        </div>
      </div>

      <Tabs<HomeTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: t("tab_overview") },
          { id: "udhaar", label: t("tab_udhaar") },
          { id: "stock", label: t("tab_stock") },
          { id: "alerts", label: t("tab_alerts"), badge: totalAlertsCount },
        ]}
      />

      <div className="mx-auto max-w-md space-y-5 px-4 py-4">
        {error && <p className="text-sm text-danger">Server error: {error}</p>}

        {tab === "overview" && (
          <>
            <Card className="grid grid-cols-2">
              <Stat label={t("total_outstanding")} value={formatRupees(data?.total_outstanding ?? 0)} className="border-b border-r" />
              <Stat label={t("udhaar_today")} value={formatRupees(data?.udhaar_today ?? 0)} className="border-b" />
              <Stat label={t("overdue_label", { days: data?.overdue_days ?? 30 })} value={String(data?.overdue_count ?? 0)} tone="red" className="border-r" />
              <Stat label={t("low_stock_items")} value={data?.low_stock_count == null ? "—" : String(data.low_stock_count)} tone="brown" />
            </Card>

            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h3 className="text-lg font-semibold">{t("top_debtors")}</h3>
                <button onClick={onViewAll} className="font-medium text-brand">
                  {t("view_all")}
                </button>
              </div>
              {data && data.top_debtors.length > 0 ? (
                <CustomerTable
                  customers={data.top_debtors}
                  overdueDays={data.overdue_days}
                  onOpen={onOpenCustomer}
                  onReminder={(c) => setReminderCustomer(c)}
                />
              ) : (
                <Empty>{t("empty_no_debtors")}</Empty>
              )}
            </Card>

            <PrimaryButton icon={Camera} onClick={() => onScan("khata")} className="w-full">
              {t("scan_khata_btn")}
            </PrimaryButton>
          </>
        )}

        {tab === "udhaar" && (
          <Card>
            {owing.length > 0 ? (
              <CustomerTable
                customers={owing}
                overdueDays={all!.overdue_days}
                onOpen={onOpenCustomer}
                onReminder={(c) => setReminderCustomer(c)}
                action="chevron"
              />
            ) : (
              <Empty>{t("empty_all_settled")}</Empty>
            )}
          </Card>
        )}

        {tab === "stock" && (
          <StockList onOpen={onOpenProduct} onScanBill={() => onScan("bill")} onScanShelf={() => onScan("shelf")} />
        )}

        {tab === "alerts" && (
          <>
            <Card>
              <div className="border-b border-line px-4 py-3">
                <h3 className="text-lg font-semibold">{t("tab_alerts")}</h3>
                <p className="text-sm text-muted">
                  {t("overdue_subtext", { days: data?.overdue_days ?? 30 })}
                </p>
              </div>
              {overdue.length > 0 ? (
                <CustomerTable
                  customers={overdue}
                  overdueDays={all!.overdue_days}
                  onOpen={onOpenCustomer}
                  onReminder={(c) => setReminderCustomer(c)}
                />
              ) : (
                <Empty>{t("empty_no_overdue")}</Empty>
              )}
            </Card>

            <Card>
              <div className="border-b border-line px-4 py-3">
                <h3 className="text-lg font-semibold">Low stock items</h3>
                <p className="text-sm text-muted">Configured threshold se kam quantity bachi hai</p>
              </div>
              {lowStockAlerts.length > 0 ? (
                <div className="divide-y divide-line">
                  {lowStockAlerts.map((item) => (
                    <div
                      key={item.product_id}
                      onClick={() => onOpenProduct(item.product_id)}
                      className="flex cursor-pointer items-center justify-between px-4 py-3 active:bg-soft"
                    >
                      <div className="min-w-0 pr-3">
                        <p className="truncate font-semibold text-ink text-[15px]">{item.product_name}</p>
                        <p className="text-xs text-muted">
                          Threshold: {item.threshold} {item.unit}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-base font-semibold text-danger">
                          {item.current_stock} {item.unit}
                        </p>
                        <span className="text-xs font-medium text-danger">Low stock</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>Sabhi products ka stock theek hai.</Empty>
              )}
            </Card>
          </>
        )}
      </div>

      {reminderCustomer && (
        <ReminderSheet
          customerId={reminderCustomer.id}
          customerName={reminderCustomer.name}
          balance={reminderCustomer.balance}
          phone={reminderCustomer.phone}
          initialLanguage={data?.shop.language || "hi"}
          onClose={() => setReminderCustomer(null)}
        />
      )}
    </>
  );
}
