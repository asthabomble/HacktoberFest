import { useRef, useState } from "react";

// Browser speech recognition. Chrome/Android expose it as webkitSpeechRecognition; Firefox has none.
// Phone browsers usually only allow the mic on https or localhost.
type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: (e: { error: string }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

const Ctor: (new () => Recognition) | undefined =
  (window as unknown as Record<string, new () => Recognition>).SpeechRecognition ??
  (window as unknown as Record<string, new () => Recognition>).webkitSpeechRecognition;

export const speechSupported = !!Ctor;

/** Start listening; `onText` gets the final transcript. `error` is "denied" | "failed" | "". */
export function useSpeech(lang: string, onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<"" | "denied" | "failed">("");
  const rec = useRef<Recognition | null>(null);

  function start() {
    if (!Ctor || listening) return;
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = false;
    r.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript?.trim();
      if (text) onText(text);
    };
    r.onerror = (e) => setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : "failed");
    r.onend = () => setListening(false);
    setError("");
    setListening(true);
    rec.current = r;
    r.start();
  }

  function stop() {
    rec.current?.stop();
  }

  return { supported: speechSupported, listening, error, start, stop };
}
