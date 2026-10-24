import { useEffect, useRef, useState } from "react";
import { ArrowRight, ListFilter, Mic } from "lucide-react";
import { SubHeader, Tabs } from "../components/ui";
import { apiGet, apiPost, type ChatResponse, type ChatSample, type StructuredQueryTrace } from "../lib/api";
import { formatDate, formatRupees } from "../lib/format";
import { useLanguage, type Language } from "../lib/language";

type Message = { id: number; question: string; response?: ChatResponse; error?: string };

const SAMPLES_BY_LANG: Record<Language, string[]> = {
  en: ["Who owes > 500?", "Today's total udhaar?", "Which stock is low?", "Top 5 debtors"],
  hi: ["किसने 500 से ज़्यादा उधार लिया?", "आज का कुल उधार कितना है?", "दुकान में कौन सा सामान कम है?", "रमेश का कितना बाकी है?"],
  mr: ["कोणाकडे 1000 पेक्षा जास्त उधारी आहे?", "आजची एकूण उधारी किती?", "कोणता माल संपत आला आहे?", "सुरेशचा किती बाकी आहे?"],
  hinglish: ["Kisne 500 se zyada udhaar liya?", "Aaj ka total udhaar kitna hai?", "Konsa stock low chal raha hai?", "Ramesh ka hisaab batao"],
};

let nextId = 1;

/** One-line summary of the whitelisted query the backend ran, e.g. "filter: balance > 500 · sort: desc" */
function traceLine(q: StructuredQueryTrace): string {
  switch (q.intent) {
    case "who_owes_more_than":
      return `filter: balance > ${q.threshold ?? 0} · sort: desc`;
    case "top_debtors":
      return `sort: balance desc · limit: ${q.limit ?? 5}`;
    case "customer_balance":
      return `customer: ${q.customer_name ?? "?"}`;
    case "total_udhaar":
      return `sum: udhaar · period: ${q.time_period ?? "today"}`;
    case "items_running_low":
      return "filter: stock ≤ threshold";
    default:
      return `intent: ${q.intent}`;
  }
}

function Row({ left, right, tone }: { left: string; right: string; tone?: "brand" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line px-4 py-2.5">
      <span className="min-w-0 truncate">{left}</span>
      <span className={`shrink-0 font-mono font-semibold ${tone === "brand" ? "text-brand" : ""}`}>{right}</span>
    </div>
  );
}

function AnswerRows({ res }: { res: ChatResponse }) {
  const { t } = useLanguage();
  const d = res.data;
  switch (res.intent) {
    case "who_owes_more_than":
    case "top_debtors": {
      const list: { id: number; name: string; balance: number }[] = d.customers ?? d.debtors ?? [];
      return (
        <>
          {list.map((c) => (
            <Row key={c.id} left={c.name} right={formatRupees(c.balance)} />
          ))}
        </>
      );
    }
    case "customer_balance":
      if (!d.found) return null;
      return (
        <>
          <Row left={d.customer_name} right={formatRupees(d.balance ?? 0)} />
          {(d.recent_entries ?? []).map((e: { date: string; raw_text: string | null; type: string; amount: number }, i: number) => (
            <Row
              key={i}
              left={`${formatDate(e.date)} · ${e.raw_text || (e.type === "gave" ? "Udhaar" : "Jama")}`}
              right={`${e.type === "gave" ? "+" : "−"}${formatRupees(e.amount)}`}
              tone={e.type === "got" ? "brand" : undefined}
            />
          ))}
        </>
      );
    case "total_udhaar":
      return (
        <>
          <Row left={t("diya_udhaar")} right={formatRupees(d.total_gave ?? 0)} />
          <Row left={t("jama_mila")} right={formatRupees(d.total_got ?? 0)} tone="brand" />
        </>
      );
    case "items_running_low":
      return (
        <>
          {(d.items ?? []).map((it: { id: number; name: string; current_stock: number; unit: string; threshold: number }) => (
            <Row key={it.id} left={it.name} right={`${it.current_stock} ${it.unit} / min ${it.threshold}`} />
          ))}
        </>
      );
    default:
      return null;
  }
}

// Browser speech recognition (Chrome/Android expose it as webkitSpeechRecognition)
type Recognition = { lang: string; onresult: (e: any) => void; onend: () => void; start: () => void };
const SpeechRecognitionCtor: (new () => Recognition) | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export default function Poocho({ onBack }: { onBack: () => void }) {
  const { lang, t } = useLanguage();
  const [tab, setTab] = useState<"chat" | "history">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const activeSamples = SAMPLES_BY_LANG[lang] || SAMPLES_BY_LANG.en;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function ask(text?: string) {
    const question = (text ?? input).trim();
    if (!question || loading) return;
    const id = nextId++;
    setMessages((m) => [...m, { id, question }]);
    setInput("");
    setTab("chat");
    setLoading(true);
    try {
      const response = await apiPost<ChatResponse>("/api/chat", { query: question, language: lang });
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, response } : x)));
    } catch (e) {
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
    } finally {
      setLoading(false);
    }
  }

  function listen() {
    if (!SpeechRecognitionCtor) return;
    const rec = new SpeechRecognitionCtor();
    rec.lang = lang === "mr" ? "mr-IN" : lang === "hi" || lang === "hinglish" ? "hi-IN" : "en-IN";
    rec.onresult = (e) => setInput(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }

  return (
    <>
      <SubHeader title={t("pucho_title")} onBack={onBack} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "chat", label: t("pucho_tab_chat") },
          { id: "history", label: t("pucho_tab_history") },
        ]}
      />

      <div className="mx-auto max-w-md space-y-4 px-4 py-4 pb-64">
        {tab === "chat" && (
          <>
            {messages.length === 0 && (
              <p className="py-6 text-center text-muted">{t("pucho_hint")}</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className="space-y-4">
                <div className="flex justify-end">
                  <p className="max-w-[85%] bg-bar px-4 py-3 text-[17px] text-logo">{m.question}</p>
                </div>
                {m.response && (
                  <div className="max-w-[92%] border border-line bg-white">
                    <p className="whitespace-pre-wrap px-4 py-3 text-[17px]">{m.response.answer}</p>
                    <AnswerRows res={m.response} />
                    <p className="flex items-center gap-2 border-t border-line bg-soft px-4 py-2 font-mono text-sm text-muted">
                      <ListFilter size={16} /> {traceLine(m.response.structured_query)}
                    </p>
                  </div>
                )}
                {m.error && <p className="max-w-[92%] border border-danger/40 bg-danger-soft px-4 py-3 text-danger">{m.error}</p>}
              </div>
            ))}
            {loading && <p className="text-muted">{t("gemma_thinking")}</p>}
            <div ref={endRef} />
          </>
        )}

        {tab === "history" &&
          (messages.length === 0 ? (
            <p className="py-6 text-center text-muted">{t("no_questions_yet")}</p>
          ) : (
            <ul className="border border-line bg-white">
              {[...messages].reverse().map((m) => (
                <li key={m.id} className="border-b border-line last:border-b-0">
                  <button onClick={() => ask(m.question)} className="w-full px-4 py-3 text-left">
                    <p>{m.question}</p>
                    {m.response && <p className="truncate text-sm text-muted">{m.response.answer}</p>}
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-page pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-md px-4 pt-3">
          <p className="mb-2 text-sm text-muted">{t("try_asking")}</p>
          <div className="flex flex-wrap gap-2">
            {activeSamples.slice(0, 4).map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                disabled={loading}
                className="rounded-full border-2 border-info-line bg-white px-3.5 py-1.5 text-[15px] text-info-text disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
          className="mx-auto flex max-w-md gap-3 px-4 py-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("pucho_placeholder")}
            className="min-w-0 flex-1 border-b-2 border-line bg-soft px-3 py-3 text-[15px] outline-none placeholder:text-muted focus:border-brand"
          />
          <button
            type="button"
            onClick={listen}
            disabled={!SpeechRecognitionCtor || listening}
            aria-label="Speak your question"
            className={`grid w-12 place-items-center border-2 border-brand ${listening ? "bg-chip" : "bg-white"} text-brand disabled:opacity-40`}
          >
            <Mic size={22} />
          </button>
          <button type="submit" disabled={!input.trim() || loading} aria-label="Ask" className="grid w-14 place-items-center bg-bar text-logo disabled:opacity-50">
            <ArrowRight size={22} />
          </button>
        </form>
      </div>
    </>
  );
}
