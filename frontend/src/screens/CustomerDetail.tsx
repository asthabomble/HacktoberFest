import { useEffect, useState } from "react";
import { Combine, MessageCircle, Mic, X } from "lucide-react";
import ReminderSheet from "../components/ReminderSheet";
import { BottomBar, Card, Chip, OutlineButton, PrimaryButton, Skeleton, SkeletonRows, SubHeader, Tabs } from "../components/ui";
import { apiGet, apiPost, imageUrl, type CreditType, type ExtractResponse, type Ledger, type SimilarCustomer } from "../lib/api";
import { formatDate, formatNumber, formatRupees, initials, today } from "../lib/format";
import { reminderLang, speechLang, useLang } from "../lib/i18n";
import { useSpeech } from "../lib/speech";

type DetailTab = "entries" | "summary" | "reminders" | "photos";

function AddEntrySheet({ customerName, onClose, onSaved }: { customerName: string; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = useLang();
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<CreditType>("gave");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [understanding, setUnderstanding] = useState(false);

  // "paanch sau udhaar, cheeni tel" -> Gemma fills amount / Diya-Jama / note for this customer
  const speech = useSpeech(speechLang(lang), async (heard) => {
    setUnderstanding(true);
    setError("");
    try {
      const res = await apiPost<ExtractResponse>("/api/khata/voice", { text: `${customerName}: ${heard}` });
      const row = res.rows[0];
      if (row) {
        setAmount(String(row.amount || ""));
        setType(row.type);
        setNote(heard);
      } else {
        setNote(heard);
      }
    } catch (e) {
      setNote(heard);
      setError((e as Error).message);
    } finally {
      setUnderstanding(false);
    }
  });

  async function save() {
    setSaving(true);
    setError("");
    try {
      await apiPost("/api/khata/confirm", {
        rows: [{ customer_name: customerName, amount: Number(amount), type, date, raw_text: note }],
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const input = "w-full border-b-2 border-line bg-soft px-3 py-2.5 text-[15px] outline-none focus:border-brand";

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div className="mx-auto w-full max-w-md bg-page" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-bar px-4 py-3">
          <h2 className="text-lg font-semibold text-logo">{t("New entry")} · {customerName}</h2>
          <button onClick={onClose} aria-label={t("Close")} className="text-logo">
            <X size={22} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          {speech.supported && (
            <button
              onClick={speech.listening ? speech.stop : speech.start}
              disabled={understanding}
              className={`flex h-12 w-full items-center justify-center gap-2 border-2 border-brand font-medium text-brand ${
                speech.listening ? "animate-pulse bg-chip" : "bg-white"
              } disabled:opacity-50`}
            >
              <Mic size={20} />
              {understanding ? t("Samajh rahe hain…") : speech.listening ? t("Sun rahe hain… (rokne ke liye dabayein)") : t("Bol kar bharein")}
            </button>
          )}
          {speech.error === "denied" && <p className="text-sm text-danger">{t("Mic ki permission nahi mili (phone par https chahiye). Neeche likh dijiye.")}</p>}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder={t("Amount ₹")}
              autoFocus
              className={`${input} font-mono font-semibold`}
            />
            <DiyaJama value={type} onChange={setType} />
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Item / note (optional)")} className={input} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <PrimaryButton onClick={save} disabled={saving || !(Number(amount) > 0)} className="w-full">
            {saving ? t("Saving…") : t("Save entry")}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/** Diya / Jama segmented toggle from the design */
export function DiyaJama({ value, onChange }: { value: CreditType; onChange: (v: CreditType) => void }) {
  const { t } = useLang();
  const seg = (active: boolean) => `px-2.5 py-2 text-sm ${active ? "bg-bar font-medium text-logo" : "bg-white text-muted"}`;
  return (
    <div className="flex border border-muted/50">
      <button type="button" onClick={() => onChange("gave")} className={seg(value === "gave")}>
        {t("Diya")}
      </button>
      <button type="button" onClick={() => onChange("got")} className={seg(value === "got")}>
        {t("Jama")}
      </button>
    </div>
  );
}

export default function CustomerDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { t, lang } = useLang();
  const [data, setData] = useState<Ledger | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<DetailTab>("entries");
  const [adding, setAdding] = useState(false);
  const [similar, setSimilar] = useState<SimilarCustomer[]>([]);
  const [reminderOpen, setReminderOpen] = useState(false);

  function load() {
    apiGet<Ledger>(`/api/customers/${id}/ledger`)
      .then(setData)
      .catch((e) => setError(e.message));
    apiGet<{ customers: SimilarCustomer[] }>(`/api/customers/${id}/similar`)
      .then((r) => setSimilar(r.customers))
      .catch(() => setSimilar([]));
  }
  useEffect(load, [id]);

  async function merge(other: SimilarCustomer) {
    if (!data || !window.confirm(t('"{from}" ki saari entries "{to}" mein jod dein?', { from: other.name, to: data.customer.name }))) return;
    try {
      await apiPost(`/api/customers/${id}/merge`, { from_id: other.id });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const c = data?.customer;
  const photos = [...new Set((data?.entries ?? []).map((e) => e.source_image).filter((p): p is string => !!p))];

  return (
    <>
      <SubHeader title={t("Customer")} onBack={onBack} />

      {error && <p className="p-4 text-sm text-danger">{error}</p>}

      {!data && !error && (
        <div className="mx-auto max-w-md space-y-4 px-4 py-4" aria-busy="true">
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-full" />
            <Skeleton className="h-6 w-40" />
          </div>
          <Card>
            <SkeletonRows rows={5} />
          </Card>
        </div>
      )}

      {c && data && (
        <>
          <div className="border-b border-line bg-white">
            <div className="mx-auto flex max-w-md items-center gap-4 px-4 py-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-bar text-lg font-semibold text-logo">
                {initials(c.name)}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold">{c.name}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  {c.phone && <span>{c.phone}</span>}
                  {c.days_due >= data.overdue_days && <Chip tone="red">{t("Overdue {n} days", { n: c.days_due })}</Chip>}
                  {data.aliases.map((a) => (
                    <Chip key={a} tone="gray">
                      {t("aka")} {a}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <Tabs<DetailTab>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "entries", label: t("Entries") },
              { id: "summary", label: t("Summary"), disabled: true },
              { id: "reminders", label: t("Reminders") },
              { id: "photos", label: t("Photos") },
            ]}
          />

          <div className="mx-auto max-w-md space-y-4 px-4 py-4 pb-28">
            {tab === "entries" && (
              <>
                {similar.length > 0 && (
                  <Card className="border-info-line bg-info-soft">
                    <p className="flex items-center gap-2 px-4 pt-3 font-medium text-info-text">
                      <Combine size={18} /> {t("Ye same customer ho sakte hain")}
                    </p>
                    <p className="px-4 pb-2 text-sm text-muted">{t("Jodne par entries ek khate mein aa jayengi aur naam yaad rahega.")}</p>
                    {similar.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 border-t border-info-line px-4 py-2.5">
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        <span className="font-mono text-sm text-muted">{formatRupees(s.balance)}</span>
                        <button onClick={() => merge(s)} className="border-2 border-brand bg-white px-3 py-1 text-sm font-medium text-brand">
                          {t("Jodo")}
                        </button>
                      </div>
                    ))}
                  </Card>
                )}
                <Card className="flex items-end justify-between p-4">
                  <div>
                    <p className="text-sm text-muted">{t(c.balance >= 0 ? "Balance due" : "Advance")}</p>
                    <p className={`font-mono text-[30px] font-semibold leading-tight ${c.balance < 0 ? "text-brand" : ""}`}>
                      {formatRupees(Math.abs(c.balance))}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted">{t("Last payment")}</p>
                    <p className="text-sm font-medium">
                      {c.last_payment ? `${formatRupees(c.last_payment.amount)} · ${formatDate(c.last_payment.date)}` : "—"}
                    </p>
                  </div>
                </Card>

                <Card>
                  <table className="w-full table-fixed text-left">
                    <thead>
                      <tr className="border-b border-line bg-soft text-xs font-medium uppercase tracking-wider text-muted">
                        <th className="w-[5.25rem] py-2.5 pl-4 font-medium">{t("Date")}</th>
                        <th className="py-2.5 font-medium">{t("Item / note")}</th>
                        <th className="w-20 py-2.5 text-right font-medium">{t("Amount")}</th>
                        <th className="w-[5.5rem] py-2.5 pr-4 text-right font-medium">{t("Balance")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.entries
                        .slice()
                        .reverse()
                        .map((e) => (
                          <tr key={e.id} className="border-b border-line last:border-b-0">
                            <td className="py-3 pl-4 align-top text-muted">{formatDate(e.entry_date)}</td>
                            <td className="break-words py-3 pr-2 align-top">
                              {e.raw_text || t(e.type === "gave" ? "Udhaar" : "Payment")}
                            </td>
                            <td className={`py-3 text-right align-top font-mono ${e.type === "got" ? "text-brand" : ""}`}>
                              {e.type === "gave" ? "+" : "−"}
                              {formatNumber(e.amount)}
                            </td>
                            <td className="py-3 pr-4 text-right align-top font-mono">{formatNumber(e.running_balance)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {data.entries.length === 0 && <p className="py-8 text-center text-muted">{t("Koi entry nahi.")}</p>}
                </Card>
              </>
            )}

            {tab === "reminders" && (
              <Card className="space-y-4 p-4">
                <div className="border-b border-line pb-3">
                  <h3 className="text-lg font-semibold">{t("WhatsApp reminders")}</h3>
                  <p className="text-sm text-muted">{t("Gemma vinamra reminder likhta hai, aap bhejte hain")}</p>
                </div>
                <div className="border border-line bg-soft p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted">{t("Current outstanding")}</p>
                  <p className="font-mono text-2xl font-semibold text-brand">{formatRupees(c.balance)}</p>
                  <p className="mt-1 text-sm text-muted">
                    {t("Phone:")}{" "}
                    {c.phone ? <span className="font-mono font-medium text-ink">{c.phone}</span> : <span className="font-medium text-danger">{t("Nahi hai")}</span>}
                  </p>
                </div>
                {c.balance > 0 ? (
                  <PrimaryButton icon={MessageCircle} onClick={() => setReminderOpen(true)} className="w-full">
                    {t("Reminder banao aur bhejo")}
                  </PrimaryButton>
                ) : (
                  <p className="py-4 text-center text-sm text-muted">{t("Is customer ka koi baaki hisaab nahi hai.")}</p>
                )}
              </Card>
            )}

            {tab === "photos" && (
              <div className="grid grid-cols-2 gap-3">
                {photos.map((p) => (
                  <a key={p} href={imageUrl(p)} target="_blank" rel="noreferrer" className="border border-line bg-white p-1">
                    <img src={imageUrl(p)} alt="Khata page" className="aspect-[3/4] w-full object-cover" />
                  </a>
                ))}
                {photos.length === 0 && <p className="col-span-2 py-8 text-center text-muted">{t("Koi photo nahi.")}</p>}
              </div>
            )}
          </div>

          <BottomBar>
            <OutlineButton onClick={() => setAdding(true)} className="w-24 shrink-0">
              {t("+ Entry")}
            </OutlineButton>
            {c.balance > 0 ? (
              <PrimaryButton
                icon={MessageCircle}
                onClick={() => setReminderOpen(true)}
                className="flex-1 whitespace-nowrap px-3! text-[15px]!"
              >
                {t("Send WhatsApp reminder")}
              </PrimaryButton>
            ) : (
              <PrimaryButton disabled className="flex-1">
                {t("Koi baaki nahi")}
              </PrimaryButton>
            )}
          </BottomBar>

          {adding && (
            <AddEntrySheet
              customerName={c.name}
              onClose={() => setAdding(false)}
              onSaved={() => {
                setAdding(false);
                load();
              }}
            />
          )}

          {reminderOpen && (
            <ReminderSheet
              customerId={c.id}
              customerName={c.name}
              balance={c.balance}
              phone={c.phone}
              initialLanguage={reminderLang(lang)}
              onClose={() => setReminderOpen(false)}
            />
          )}
        </>
      )}
    </>
  );
}
