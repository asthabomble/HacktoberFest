import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import CustomerTable from "../components/CustomerTable";
import ReminderSheet from "../components/ReminderSheet";
import type { ScanMode } from "./Scan";
import type { GoogleProfile } from "./Welcome";
import { StockList } from "./Stock";
import { Card, Chip, PrimaryButton, Skeleton, SkeletonRows, Tabs } from "../components/ui";
import { apiGet, type CustomerList, type CustomerSummary, type Overview } from "../lib/api";
import { formatRupees, formatToday } from "../lib/format";
import { reminderLang, useLang } from "../lib/i18n";

export type HomeTab = "overview" | "udhaar" | "stock" | "alerts";

function Stat({ label, value, tone, className = "" }: { label: string; value?: string | null; tone?: "red" | "brown"; className?: string }) {
  const color = tone === "red" ? "text-danger" : tone === "brown" ? "text-brand" : "text-ink";
  return (
    <div className={`border-line p-4 ${className}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold leading-tight ${color}`}>
        {value ?? <Skeleton className="h-7 w-24" />}
      </p>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="px-4 py-8 text-center text-muted">{children}</p>;
}

export default function Home({
  account,
  onSignOut,
  initialTab = "overview",
  onOpenCustomer,
  onOpenProduct,
  onScan,
  onViewAll,
}: {
  account: GoogleProfile | null;
  onSignOut: () => void;
  initialTab?: HomeTab;
  onOpenCustomer: (id: number) => void;
  onOpenProduct: (id: number) => void;
  onScan: (mode: ScanMode) => void;
  onViewAll: () => void;
}) {
  const { t, lang } = useLang();
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

  const loading = !data && !error;
  const owing = (all?.customers ?? []).filter((c) => c.balance > 0);
  const overdueDays = data?.overdue_days ?? 30;
  const overdue = owing.filter((c) => c.days_due >= overdueDays);
  const lowStockAlerts = data?.low_stock_alerts ?? [];

  return (
    <>
      <div className="border-b border-line bg-white">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-xl font-semibold">{data ? data.shop.name : <Skeleton className="h-6 w-44" />}</h2>
            <span className="shrink-0 text-sm text-muted">{formatToday(lang)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip>{t("{n} customers", { n: data?.customer_count ?? 0 })}</Chip>
            {loadedAt && <Chip tone="gray">{t("Updated {time}", { time: loadedAt })}</Chip>}
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 text-sm text-muted">
            <span className="min-w-0 truncate">{account ? t("Signed in as {name}", { name: account.name }) : t("Demo mode")}</span>
            <button onClick={onSignOut} className="min-h-11 shrink-0 font-medium text-brand">
              {t("Log out")}
            </button>
          </div>
        </div>
      </div>

      <Tabs<HomeTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: t("Overview") },
          { id: "udhaar", label: t("Udhaar") },
          { id: "stock", label: t("Stock") },
          { id: "alerts", label: t("Alerts"), badge: overdue.length + lowStockAlerts.length },
        ]}
      />

      <div className="mx-auto max-w-md space-y-5 px-4 py-4">
        {error && <p className="text-sm text-danger">{t("Server se data nahi mila: {error}", { error })}</p>}

        {tab === "overview" && (
          <>
            <Card className="grid grid-cols-2">
              <Stat label={t("Total outstanding")} value={data && formatRupees(data.total_outstanding)} className="border-b border-r" />
              <Stat label={t("Udhaar today")} value={data && formatRupees(data.udhaar_today)} className="border-b" />
              <Stat
                label={t("Overdue {n}+ days", { n: overdueDays })}
                value={data && String(data.overdue_count)}
                tone="red"
                className="border-r"
              />
              <Stat
                label={t("Low stock items")}
                value={data && (data.low_stock_count == null ? "—" : String(data.low_stock_count))}
                tone="brown"
              />
            </Card>

            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h3 className="text-lg font-semibold">{t("Top debtors")}</h3>
                <button onClick={onViewAll} className="font-medium text-brand">
                  {t("View all")}
                </button>
              </div>
              {loading ? (
                <SkeletonRows rows={5} />
              ) : data && data.top_debtors.length > 0 ? (
                <CustomerTable
                  customers={data.top_debtors}
                  overdueDays={data.overdue_days}
                  onOpen={onOpenCustomer}
                  onReminder={setReminderCustomer}
                />
              ) : (
                <Empty>{t("Abhi koi udhaar nahi. Pehla khata page scan karein.")}</Empty>
              )}
            </Card>

            <PrimaryButton icon={Camera} onClick={() => onScan("khata")} className="w-full">
              {t("Scan khata page")}
            </PrimaryButton>
          </>
        )}

        {tab === "udhaar" && (
          <Card>
            {loading ? (
              <SkeletonRows />
            ) : owing.length > 0 ? (
              <CustomerTable
                customers={owing}
                overdueDays={overdueDays}
                onOpen={onOpenCustomer}
                onReminder={setReminderCustomer}
                action="chevron"
              />
            ) : (
              <Empty>{t("Kisi ka udhaar baaki nahi.")}</Empty>
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
              <h3 className="text-lg font-semibold">{t("Overdue udhaar")}</h3>
              <p className="text-sm text-muted">{t("{n}+ din se koi payment nahi aaya", { n: overdueDays })}</p>
            </div>
            {loading ? (
              <SkeletonRows rows={3} />
            ) : overdue.length > 0 ? (
              <CustomerTable customers={overdue} overdueDays={overdueDays} onOpen={onOpenCustomer} onReminder={setReminderCustomer} />
            ) : (
              <Empty>{t("Koi overdue nahi. Sab theek hai.")}</Empty>
            )}
          </Card>

          <Card>
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-lg font-semibold">{t("Low stock items")}</h3>
              <p className="text-sm text-muted">{t("Threshold se kam bacha hai, ya shelf photo mein kam dikha")}</p>
            </div>
            {loading ? (
              <SkeletonRows rows={3} />
            ) : lowStockAlerts.length > 0 ? (
              <div className="divide-y divide-line">
                {lowStockAlerts.map((item) => (
                  <button
                    key={item.product_id}
                    onClick={() => onOpenProduct(item.product_id)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left active:bg-soft"
                  >
                    <span className="min-w-0 pr-3">
                      <span className="block truncate text-[15px] font-semibold">{item.product_name}</span>
                      <span className="block text-xs text-muted">
                        {item.shelf_low && item.current_stock > item.threshold
                          ? t("Shelf photo mein kam")
                          : t("Threshold: {n} {unit}", { n: item.threshold, unit: item.unit })}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-base font-semibold text-danger">
                        {item.current_stock} {item.unit}
                      </span>
                      <span className="text-xs font-medium text-danger">{t("Low stock")}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <Empty>{t("Sabhi products ka stock theek hai.")}</Empty>
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
          initialLanguage={reminderLang(lang)}
          onClose={() => setReminderCustomer(null)}
        />
      )}
    </>
  );
}
