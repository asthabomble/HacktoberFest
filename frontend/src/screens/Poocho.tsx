import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, type ChatResponse, type ChatSample } from "../lib/api";
import { formatRupees } from "../lib/format";

type Message = {
  id: string;
  sender: "user" | "assistant";
  text: string;
  structured?: ChatResponse;
  timestamp: string;
};

const DEFAULT_SAMPLES: ChatSample[] = [
  {
    category: "उधार सीमा",
    lang: "hi",
    label: "किसने ₹500 से ज़्यादा उधार लिया?",
    query: "किसने 500 से ज़्यादा उधार लिया है?",
    intent: "who_owes_more_than",
  },
  {
    category: "आज का हिसाब",
    lang: "hi",
    label: "आज का कुल उधार कितना है?",
    query: "आज का कुल उधार कितना है?",
    intent: "total_udhaar",
  },
  {
    category: "ग्राहक खाता",
    lang: "hi",
    label: "रमेश का कितना बाकी है?",
    query: "रमेश का कितना बाकी है?",
    intent: "customer_balance",
  },
  {
    category: "स्टॉक अलर्ट",
    lang: "hi",
    label: "दुकान में कौन सा सामान कम है?",
    query: "दुकान में कौन सा सामान कम है?",
    intent: "items_running_low",
  },
  {
    category: "टॉप बकायेदार",
    lang: "hi",
    label: "सबसे ज़्यादा उधार वाले 5 लोग",
    query: "सबसे ज़्यादा उधार वाले 5 लोग कौन हैं?",
    intent: "top_debtors",
  },
  {
    category: "मराठी उधारी",
    lang: "mr",
    label: "कोणाकडे ₹1000 पेक्षा जास्त उधारी आहे?",
    query: "कोणाकडे 1000 पेक्षा जास्त उधारी बाकी आहे?",
    intent: "who_owes_more_than",
  },
  {
    category: "मराठी महिना",
    lang: "mr",
    label: "या महिन्यात किती उधारी दिली?",
    query: "या महिन्यात किती उधारी दिली?",
    intent: "total_udhaar",
  },
  {
    category: "मराठी ग्राहक",
    lang: "mr",
    label: "सुरेशचा किती बाकी आहे?",
    query: "सुरेशचा किती बाकी आहे?",
    intent: "customer_balance",
  },
  {
    category: "Hinglish",
    lang: "hinglish",
    label: "Konsa stock low chal raha hai?",
    query: "Konsa stock low chal raha hai?",
    intent: "items_running_low",
  },
];

export default function Poocho() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "assistant",
      text: "नमस्ते! आप अपनी दुकान के खाते और स्टॉक के बारे में हिन्दी, मराठी या Hinglish में कुछ भी पूछ सकते हैं। नीचे दिए गए सुझावों पर टैप करें या खुद लिखकर पूछें।",
      timestamp: "अब",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [samples, setSamples] = useState<ChatSample[]>(DEFAULT_SAMPLES);
  const [activeLang, setActiveLang] = useState<string>("all");
  const [expandedTrace, setExpandedTrace] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<{ samples: ChatSample[] }>("/api/chat/samples")
      .then((res) => {
        if (res.samples?.length) {
          setSamples(res.samples);
        }
      })
      .catch(() => {
        // Keep default samples on error
      });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend(textToSend?: string) {
    const queryText = (textToSend ?? input).trim();
    if (!queryText || loading) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      sender: "user",
      text: queryText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput("");
    setLoading(true);

    try {
      const res = await apiPost<ChatResponse>("/api/chat", { query: queryText });
      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        sender: "assistant",
        text: res.answer,
        structured: res,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      const errorMsg: Message = {
        id: `e-${Date.now()}`,
        sender: "assistant",
        text: `माफ़ कीजिए, उत्तर प्राप्त नहीं हो सका: ${(e as Error).message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }

  function toggleTrace(id: string) {
    setExpandedTrace((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const filteredSamples =
    activeLang === "all" ? samples : samples.filter((s) => s.lang === activeLang);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <p className="font-pixel text-xs tracking-widest text-mint">&gt; AI_ASSISTANT</p>
          <span className="border border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-marigold">
            Hindi • Marathi • Hinglish
          </span>
        </div>
        <h1 className="font-pixel text-2xl text-marigold">
          Poocho <span className="text-paper">(पूछो)</span>
        </h1>
        <p className="text-xs text-muted">
          Gemma AI se dukan ka udhaar aur stock hisaab poochhein
        </p>
      </header>

      {/* Language filter pills */}
      <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        <span className="font-pixel text-[10px] text-muted">Filter:</span>
        {[
          { id: "all", label: "सब (All)" },
          { id: "hi", label: "हिन्दी" },
          { id: "mr", label: "मराठी" },
          { id: "hinglish", label: "Hinglish" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveLang(f.id)}
            className={`press shrink-0 border px-2 py-0.5 font-sans text-xs ${
              activeLang === f.id
                ? "border-marigold bg-marigold text-ink font-semibold"
                : "border-line bg-panel text-muted hover:text-paper"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Suggested Questions Carousel / Chip list */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-2 scrollbar-none">
        {filteredSamples.map((s, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(s.query)}
            disabled={loading}
            className="press shrink-0 border-2 border-line bg-panel p-2.5 text-left text-xs transition hover:border-marigold"
            style={{ maxWidth: "230px" }}
          >
            <span className="block font-mono text-[10px] text-sky">{s.category}</span>
            <span className="block font-medium text-paper leading-tight">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Chat Messages */}
      <div className="space-y-4 pb-24">
        {messages.map((m) => {
          const isUser = m.sender === "user";
          return (
            <div
              key={m.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[92%] border-2 p-3 ${
                  isUser
                    ? "block-shadow border-line bg-panel-2 text-paper"
                    : "block-shadow border-line bg-panel text-paper"
                }`}
              >
                {/* Message Header */}
                <div className="mb-1 flex items-center justify-between gap-4 font-mono text-[10px] text-muted">
                  <span className={`font-pixel ${isUser ? "text-marigold" : "text-mint"}`}>
                    {isUser ? "&gt; AAP" : "&gt; GEMMA_AI"}
                  </span>
                  <span>{m.timestamp}</span>
                </div>

                {/* Main Text Answer */}
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>

                {/* Structured Data Visual Cards */}
                {m.structured?.data && (
                  <div className="mt-3 border-t border-line/80 pt-2.5">
                    {/* 1. Who Owes More Than or Top Debtors */}
                    {(m.structured.intent === "who_owes_more_than" ||
                      m.structured.intent === "top_debtors") && (
                      <div className="space-y-1.5">
                        <p className="font-pixel text-[11px] text-sky">
                          {m.structured.intent === "top_debtors"
                            ? "Top Debtors (बकाया सूची)"
                            : `उधार > ₹${m.structured.data.threshold ?? 0}`}
                        </p>
                        <div className="divide-y divide-line/60 border border-line bg-ink/70">
                          {(
                            m.structured.data.customers ||
                            m.structured.data.debtors ||
                            []
                          ).map((c: any) => (
                            <div
                              key={c.id}
                              className="flex items-center justify-between px-2.5 py-1.5 text-xs"
                            >
                              <div className="min-w-0">
                                <span className="font-semibold text-paper">{c.name}</span>
                                {c.phone && (
                                  <span className="ml-1.5 font-mono text-[10px] text-muted">
                                    {c.phone}
                                  </span>
                                )}
                              </div>
                              <span className="font-mono font-bold text-rose">
                                {formatRupees(c.balance)}
                              </span>
                            </div>
                          ))}
                          {(m.structured.data.customers || m.structured.data.debtors || [])
                            .length === 0 && (
                            <div className="p-2 text-center text-xs text-muted">
                              कोई बकायेदार नहीं मिला
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 2. Total Udhaar Breakdown */}
                    {m.structured.intent === "total_udhaar" && (
                      <div className="space-y-1.5">
                        <p className="font-pixel text-[11px] text-sky">
                          हिसाब सारांश (
                          {m.structured.data.time_period === "today"
                            ? "आज"
                            : "इस महीने"}
                          )
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-center">
                          <div className="border border-line bg-ink/80 p-2">
                            <span className="block text-[11px] text-muted">दिया उधार</span>
                            <span className="font-mono text-sm font-bold text-rose">
                              {formatRupees(m.structured.data.total_gave || 0)}
                            </span>
                          </div>
                          <div className="border border-line bg-ink/80 p-2">
                            <span className="block text-[11px] text-muted">जमा मिला</span>
                            <span className="font-mono text-sm font-bold text-mint">
                              {formatRupees(m.structured.data.total_got || 0)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 3. Customer Balance Card */}
                    {m.structured.intent === "customer_balance" &&
                      m.structured.data.found && (
                        <div className="border border-line bg-ink/80 p-2.5">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-semibold text-paper">
                                {m.structured.data.customer_name}
                              </p>
                              {m.structured.data.phone && (
                                <p className="font-mono text-[10px] text-muted">
                                  {m.structured.data.phone}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <span className="block text-[10px] text-muted">कुल बकाया</span>
                              <span className="font-mono text-lg font-bold text-marigold">
                                {formatRupees(m.structured.data.balance || 0)}
                              </span>
                            </div>
                          </div>

                          {m.structured.data.recent_entries?.length > 0 && (
                            <div className="mt-2 border-t border-line/60 pt-1.5">
                              <p className="mb-1 font-mono text-[10px] text-muted">हालिया लेन-देन:</p>
                              <div className="space-y-1">
                                {m.structured.data.recent_entries.map((e: any, idx: number) => (
                                  <div
                                    key={idx}
                                    className="flex justify-between font-mono text-[11px]"
                                  >
                                    <span className="text-muted">
                                      {e.date} • {e.raw_text || (e.type === "gave" ? "उधार" : "जमा")}
                                    </span>
                                    <span
                                      className={
                                        e.type === "gave" ? "text-rose" : "text-mint"
                                      }
                                    >
                                      {e.type === "gave" ? "+" : "-"}
                                      {formatRupees(e.amount)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                    {/* 4. Items Running Low */}
                    {m.structured.intent === "items_running_low" && (
                      <div className="space-y-1.5">
                        <p className="font-pixel text-[11px] text-sky">कम स्टॉक सूची</p>
                        <div className="divide-y divide-line/60 border border-line bg-ink/70">
                          {(m.structured.data.items || []).map((it: any) => (
                            <div
                              key={it.id}
                              className="flex items-center justify-between px-2.5 py-1.5 text-xs"
                            >
                              <span className="font-medium text-paper">{it.name}</span>
                              <span className="border border-rose/40 bg-rose/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-rose">
                                {it.current_stock} {it.unit} (न्यूनतम: {it.threshold})
                              </span>
                            </div>
                          ))}
                          {(m.structured.data.items || []).length === 0 && (
                            <div className="p-2 text-center text-xs text-mint">
                              सभी सामान पर्याप्त मात्रा में उपलब्ध हैं
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Audit Trace Accordion */}
                    <div className="mt-2">
                      <button
                        onClick={() => toggleTrace(m.id)}
                        className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-paper"
                      >
                        <span>{expandedTrace[m.id] ? "▾" : "▸"}</span>
                        <span>AI Query Trace (Strict Whitelist Audit)</span>
                      </button>
                      {expandedTrace[m.id] && (
                        <div className="mt-1 border border-line bg-ink p-2 font-mono text-[10px] text-muted">
                          <p>
                            <span className="text-sky">Intent:</span>{" "}
                            {m.structured.structured_query.intent}
                          </p>
                          <p>
                            <span className="text-sky">Language:</span>{" "}
                            {m.structured.structured_query.language}
                          </p>
                          {m.structured.structured_query.threshold != null && (
                            <p>
                              <span className="text-sky">Threshold:</span> ₹
                              {m.structured.structured_query.threshold}
                            </p>
                          )}
                          {m.structured.structured_query.time_period && (
                            <p>
                              <span className="text-sky">Time Period:</span>{" "}
                              {m.structured.structured_query.time_period}
                            </p>
                          )}
                          {m.structured.structured_query.customer_name && (
                            <p>
                              <span className="text-sky">Target Customer:</span>{" "}
                              {m.structured.structured_query.customer_name}
                            </p>
                          )}
                          <p className="mt-1 border-t border-line/60 pt-1 text-mint">
                            ✓ Whitelisted plain-code execution • No raw SQL generated
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Loading Spinner / Gemma Thinking */}
        {loading && (
          <div className="flex flex-col items-start">
            <div className="max-w-[90%] border-2 border-line bg-panel p-3">
              <div className="mb-1 font-pixel text-[10px] text-mint">&gt; GEMMA_AI</div>
              <div className="flex items-center gap-2">
                <span className="size-2 animate-ping bg-marigold" />
                <span className="font-mono text-xs text-muted">
                  Gemma hisaab jod raha hai... (उत्तर तैयार हो रहा है)
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Fixed Sticky Input Bar */}
      <div className="fixed inset-x-0 bottom-14 z-20 border-t-2 border-line bg-ink/95 px-4 py-2.5 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="mx-auto flex max-w-md items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder="हिंदी, मराठी या Hinglish में पूछें..."
            className="flex-1 border-2 border-line bg-panel px-3 py-2.5 text-sm text-paper placeholder:text-muted focus:border-marigold focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="block-shadow-marigold press border-2 border-marigold bg-marigold px-4 py-2.5 font-pixel text-xs font-semibold text-ink disabled:opacity-40"
          >
            Poocho
          </button>
        </form>
      </div>
    </div>
  );
}
