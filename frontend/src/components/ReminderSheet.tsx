import { useEffect, useState } from "react";
import { Copy, MessageCircle, RefreshCw, X } from "lucide-react";
import { Chip, PrimaryButton } from "./ui";
import { apiPost, type DraftReminderResponse } from "../lib/api";
import { formatRupees } from "../lib/format";
import { useLang } from "../lib/i18n";

export default function ReminderSheet({
  customerId,
  customerName,
  balance,
  phone,
  initialLanguage = "hi",
  onClose,
}: {
  customerId: number;
  customerName: string;
  balance: number;
  phone?: string | null;
  initialLanguage?: string;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [lang, setLang] = useState<string>(initialLanguage || "hi");
  const [loading, setLoading] = useState<boolean>(true);
  const [draft, setDraft] = useState<DraftReminderResponse | null>(null);
  const [messageText, setMessageText] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  async function loadDraft(selectedLang: string) {
    setLoading(true);
    setError("");
    try {
      const res = await apiPost<DraftReminderResponse>("/api/reminders/draft", {
        customer_id: customerId,
        language: selectedLang,
      });
      setDraft(res);
      setMessageText(res.message);
    } catch (e) {
      setError((e as Error).message);
      // Fallback message if server error
      const fallback = `Namaste ${customerName} ji, aapka ${formatRupees(balance)} ka hisaab baaki hai. Kripya suvidha anusar chuka dijiye. Dhanyavaad!`;
      setMessageText(fallback);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDraft(lang);
  }, [customerId, lang]);

  function handleOpenWhatsApp() {
    const encoded = encodeURIComponent(messageText);
    const targetPhone = draft?.normalized_phone;
    const url = targetPhone ? `https://wa.me/${targetPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, "_blank");
  }

  function handleCopy() {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={onClose}>
      <div className="mx-auto w-full max-w-md bg-page pb-6" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between bg-bar px-4 py-3 text-logo">
          <div className="flex items-center gap-2">
            <MessageCircle size={20} />
            <h2 className="text-lg font-semibold">{t("Payment reminder")}</h2>
          </div>
          <button onClick={onClose} aria-label={t("Close")} className="text-logo">
            <X size={22} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* Customer info & draft pill */}
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-ink text-base">{customerName}</p>
              <p className="font-mono text-sm text-brand font-medium">{t("Due:")} {formatRupees(balance)}</p>
            </div>
            <Chip tone="gray">{t("Draft · Not sent")}</Chip>
          </div>

          {/* Language selector */}
          <div>
            <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-1.5">
              {t("Message language")}
            </label>
            <div className="flex gap-2">
              {[
                { id: "hi", label: "हिन्दी (Hindi)" },
                { id: "mr", label: "मराठी (Marathi)" },
                { id: "en", label: "English" },
              ].map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLang(l.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                    lang === l.id
                      ? "bg-bar text-logo border-bar font-semibold"
                      : "bg-white text-muted border-line hover:border-brand"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Draft message textarea */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wider">
                {t("Reminder draft (editable)")}
              </label>
              <button
                type="button"
                onClick={() => loadDraft(lang)}
                disabled={loading}
                className="flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-50"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                {t("Regenerate")}
              </button>
            </div>
            <textarea
              rows={4}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={t("Reminder message…")}
              className="w-full border-2 border-line bg-white p-3 text-sm text-ink outline-none focus:border-brand"
            />
          </div>

          {/* Phone status & validation */}
          {draft && !draft.is_phone_valid && (
            <div className="border border-danger/40 bg-danger-soft p-3 text-xs text-danger rounded-sm">
              <p className="font-semibold">⚠ {t("Phone number invalid or missing")}</p>
              <p className="mt-0.5 text-muted">
                {phone ? t('Stored number "{phone}" is not a valid 10-digit Indian mobile.', { phone }) : t("No phone number saved for this customer.")}{" "}
                {t("You can still open WhatsApp or copy the message manually.")}
              </p>
            </div>
          )}

          {draft?.is_phone_valid && (
            <p className="text-xs text-muted">
              {t("Sending to:")} <span className="font-mono font-medium text-ink">+{draft.normalized_phone}</span>
            </p>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}

          <p className="text-xs text-muted">
            {t("WhatsApp prefilled message ke saath khulega. Bhejne ke liye WhatsApp par send dabayein.")}
          </p>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center justify-center gap-1.5 border border-line bg-white px-3 py-2.5 text-sm font-medium text-muted hover:text-ink active:bg-soft"
            >
              <Copy size={16} />
              {copied ? t("Copied!") : t("Copy")}
            </button>
            <PrimaryButton
              icon={MessageCircle}
              onClick={handleOpenWhatsApp}
              disabled={loading || !messageText.trim()}
              className="flex-1"
            >
              {t("Open in WhatsApp")}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
