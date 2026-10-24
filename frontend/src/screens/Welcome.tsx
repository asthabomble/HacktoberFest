import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Camera,
  ChartNoAxesCombined,
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { apiPost } from "../lib/api";

type AuthView = "landing" | "login" | "signup";
type GoogleProfile = { subject: string; email: string; name: string; picture: string | null };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: { theme: "outline"; size: "large"; text: "continue_with"; shape: "rect"; width: number }) => void;
        };
      };
    };
  }
}

let googleScript: Promise<void> | undefined;

function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve();
  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Google sign-in. Check your connection and try again."));
      document.head.appendChild(script);
    });
  }
  return googleScript;
}

function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${light ? "text-white" : "text-logo"}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-logo text-bar shadow-sm sm:size-10 sm:rounded-xl">
        <BookOpen size={18} strokeWidth={2.2} className="sm:hidden" />
        <BookOpen size={21} strokeWidth={2.2} className="hidden sm:block" />
      </span>
      <span className="text-[17px] font-semibold tracking-tight sm:text-[21px]">Hisaab<span className="font-normal">Kitaab</span></span>
    </span>
  );
}

function GoogleButton({ clientId, onCredential, onError }: { clientId: string; onCredential: (credential: string) => void; onError: (message: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const credentialHandler = useRef(onCredential);
  credentialHandler.current = onCredential;

  useEffect(() => {
    if (!clientId) {
      onError("Google sign-in needs VITE_GOOGLE_CLIENT_ID in frontend/.env. Add your Web OAuth client ID, then restart Vite.");
      return;
    }

    let cancelled = false;
    loadGoogleIdentity()
      .then(() => {
        if (cancelled || !container.current || !window.google?.accounts.id) return;
        const target = container.current;
        target.replaceChildren();
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => credentialHandler.current(response.credential),
        });
        window.google.accounts.id.renderButton(target, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rect",
          width: Math.floor(target.getBoundingClientRect().width),
        });
      })
      .catch((error: unknown) => {
        onError(error instanceof Error ? error.message : "Google sign-in could not be loaded.");
      });

    return () => { cancelled = true; };
  }, [clientId, onError]);

  return <div ref={container} className="flex h-12 w-full items-center justify-center" aria-label="Continue with Google" />;
}

function Field({
  label,
  type = "text",
  placeholder,
  autoComplete,
}: {
  label: string;
  type?: string;
  placeholder: string;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <span className="relative block">
        <input
          required
          type={isPassword && visible ? "text" : type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={isPassword ? 8 : undefined}
          className="h-12 w-full min-w-0 border border-line bg-white px-3.5 pr-11 text-base text-ink outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/10"
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            aria-label={visible ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-ink"
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </span>
    </label>
  );
}

function AuthCard({ view, onBack, onSwitch, onEnterDemo }: { view: Exclude<AuthView, "landing">; onBack: () => void; onSwitch: (view: AuthView) => void; onEnterDemo: () => void }) {
  const [message, setMessage] = useState("");
  const [googleProfile, setGoogleProfile] = useState<GoogleProfile | null>(null);
  const [verifyingGoogle, setVerifyingGoogle] = useState(false);
  const signup = view === "signup";
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

  async function verifyGoogleCredential(credential: string) {
    setMessage("");
    setVerifyingGoogle(true);
    try {
      const profile = await apiPost<GoogleProfile>("/api/auth/google", { credential });
      setGoogleProfile(profile);
    } catch (error) {
      setMessage((error as Error).message || "Google sign-in could not be verified. Please try again.");
    } finally {
      setVerifyingGoogle(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Sign in is not connected yet. Explore the demo while account access is being set up.");
  }
  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-4 py-4 sm:px-8 sm:py-5">
        <button type="button" onClick={onBack} aria-label="Back to home"><Brand /></button>
        <button type="button" onClick={onBack} className="flex h-11 shrink-0 items-center gap-0.5 text-xs font-medium text-muted hover:text-brand sm:gap-1 sm:text-sm">
          <ChevronLeft size={17} /> <span className="sm:hidden">Home</span><span className="hidden sm:inline">Back to home</span>
        </button>
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-6 px-4 pb-8 pt-2 sm:gap-10 sm:px-8 sm:pb-10 sm:pt-3 lg:grid-cols-[1fr_440px] lg:gap-16">
        <section className="hidden lg:block">
          <span className="inline-flex items-center gap-2 rounded-full border border-info-line bg-info-soft px-3 py-1.5 text-sm font-medium text-info-text">
            <Sparkles size={15} /> A clearer way to run your shop
          </span>
          <h1 className="mt-6 max-w-xl text-5xl font-semibold leading-[1.12] tracking-tight text-logo">
            Your shop’s daily hisaab, <span className="text-brand">all in one place.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-muted">Keep customer credit, stock and khata pages together. Made for the rhythm of a neighborhood shop.</p>
          <ul className="mt-8 space-y-4 text-[15px] text-ink">
            {["Know who owes what, at a glance", "Turn khata photos into editable entries", "Ask questions in Hindi, Marathi or Hinglish"].map((item) => (
              <li key={item} className="flex items-center gap-3"><span className="grid size-6 place-items-center rounded-full bg-info-soft text-brand"><Check size={15} /></span>{item}</li>
            ))}
          </ul>
        </section>
        <section className="mx-auto w-full max-w-md min-w-0 border border-line bg-white p-5 shadow-[0_16px_50px_rgba(58,42,6,0.08)] sm:p-9">
          <div className="mb-5 lg:hidden sm:mb-6"><Brand /></div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-brand">{signup ? "Create your account" : "Welcome back"}</p>
          <h1 className="mt-2 text-[25px] font-semibold tracking-tight text-ink sm:text-[28px]">{signup ? "Get started for free" : "Sign in to your shop"}</h1>
          <p className="mt-2 text-[15px] text-muted">{signup ? "Set up your shop’s books in a few minutes." : "Pick up right where you left off."}</p>

          <div className="mt-7 space-y-3">
            <GoogleButton clientId={googleClientId} onCredential={verifyGoogleCredential} onError={setMessage} />
            {verifyingGoogle && <p role="status" className="text-center text-sm text-muted">Verifying your Google account…</p>}
            {googleProfile && (
              <div className="border border-info-line bg-info-soft p-3 text-sm text-info-text">
                Signed in as <strong>{googleProfile.name}</strong> ({googleProfile.email}).
                <button type="button" onClick={onEnterDemo} className="mt-2 flex h-10 w-full items-center justify-center gap-2 bg-bar font-semibold text-logo">Continue to HisaabKitaab<ArrowRight size={17} /></button>
              </div>
            )}
            <div className="flex items-center gap-3 py-1"><span className="h-px flex-1 bg-line" /><span className="text-xs font-medium uppercase tracking-wider text-muted">or continue with email</span><span className="h-px flex-1 bg-line" /></div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {signup && <Field label="Your name" placeholder="e.g. Asha Sharma" autoComplete="name" />}
            <Field label="Email address" type="email" placeholder="you@yourshop.com" autoComplete="email" />
            <div>
              <Field label="Password" type="password" placeholder="At least 8 characters" autoComplete={signup ? "new-password" : "current-password"} />
              {!signup && <button type="button" onClick={() => setMessage("Password reset will be available when account access is connected.")} className="mt-2 text-sm font-medium text-brand hover:underline">Forgot password?</button>}
            </div>
            {signup && <label className="flex items-start gap-2.5 text-sm leading-5 text-muted"><input required type="checkbox" className="mt-1 accent-brand" /><span>I agree to the <a href="#terms" onClick={(e) => e.preventDefault()} className="font-medium text-brand hover:underline">Terms</a> and <a href="#privacy" onClick={(e) => e.preventDefault()} className="font-medium text-brand hover:underline">Privacy Policy</a>.</span></label>}
            <button className="flex h-12 w-full items-center justify-center gap-2 bg-bar text-[15px] font-semibold text-logo transition hover:bg-bar-strong" type="submit">{signup ? "Create account" : "Sign in"}<ArrowRight size={18} /></button>
          </form>
          {message && <p role="status" className="mt-4 border border-info-line bg-info-soft px-3 py-2.5 text-sm leading-5 text-info-text">{message}</p>}
          <p className="mt-6 text-center text-sm text-muted">
            {signup ? "Already have an account?" : "New to HisaabKitaab?"}{" "}
            <button type="button" onClick={() => onSwitch(signup ? "login" : "signup")} className="font-semibold text-brand hover:underline">{signup ? "Sign in" : "Create an account"}</button>
          </p>
        </section>
      </main>
      <footer className="px-5 pb-5 text-center text-xs text-muted">© 2026 HisaabKitaab · Simple books for your shop</footer>
    </div>
  );
}

function ShopPreview() {
  return (
    <div className="relative mx-auto w-full min-w-0 max-w-[510px] px-1 sm:px-0">
      <div className="absolute -inset-5 rounded-[2rem] bg-bar/20 blur-2xl" />
      <div className="relative border border-line bg-white p-3.5 shadow-[0_20px_55px_rgba(58,42,6,0.12)] sm:rotate-[1deg] sm:p-5 sm:shadow-[0_28px_70px_rgba(58,42,6,0.14)]">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-info-soft text-brand sm:size-10"><Wallet size={20} /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink sm:text-base">Sharma General Store</p><p className="text-xs text-muted">Today’s overview</p></div></div>
          <span className="hidden shrink-0 rounded-full bg-[#edf7ef] px-2.5 py-1 text-xs font-medium text-[#2e6a3d] sm:inline-flex">All caught up</span>
          <span aria-label="All caught up" className="ml-2 size-2 shrink-0 rounded-full bg-[#5b9b65] sm:hidden" />
        </div>
        <div className="grid grid-cols-2 gap-2 py-3 sm:gap-3 sm:py-4">
          <div className="min-w-0 border border-line bg-page p-2.5 sm:p-3.5"><p className="text-[11px] text-muted sm:text-xs">Total outstanding</p><p className="mt-1 whitespace-nowrap font-mono text-lg font-semibold text-ink sm:text-xl">₹24,850</p><p className="mt-1 text-[11px] text-muted sm:text-xs">Across 18 customers</p></div>
          <div className="min-w-0 border border-line bg-page p-2.5 sm:p-3.5"><p className="text-[11px] text-muted sm:text-xs">Credit today</p><p className="mt-1 whitespace-nowrap font-mono text-lg font-semibold text-brand sm:text-xl">₹1,250</p><p className="mt-1 text-[11px] text-muted sm:text-xs">4 new entries</p></div>
        </div>
        <div className="flex items-center justify-between pb-2"><p className="text-sm font-semibold text-ink">Recent khata entries</p><span className="text-xs font-medium text-brand">View all</span></div>
        <div className="divide-y divide-line border-y border-line">
          {[["Ramesh Kumar", "Today · 10:42 am", "+ ₹450"], ["Meena Stores", "Today · 9:18 am", "+ ₹320"], ["Suresh Patil", "Yesterday", "− ₹800"]].map(([name, date, amount], index) => (
            <div key={name} className="flex items-center gap-3 py-3"><span className={`grid size-9 place-items-center rounded-full text-xs font-semibold ${index === 1 ? "bg-[#e6f1f7] text-[#3c647d]" : "bg-info-soft text-info-text"}`}>{name.split(" ").map((part) => part[0]).join("")}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{name}</p><p className="text-xs text-muted">{date}</p></div><p className={`font-mono text-sm font-medium ${amount.startsWith("+") ? "text-danger" : "text-[#2e6a3d]"}`}>{amount}</p></div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#fbf6e8] px-2.5 py-2.5 text-[11px] leading-4 text-info-text sm:px-3 sm:text-xs"><Sparkles className="shrink-0" size={15} /><span>Ask Poocho: “Aaj ka total udhaar kitna hai?”</span><ArrowUpRight className="ml-auto shrink-0" size={15} /></div>
      </div>
      <div className="absolute -bottom-5 -left-3 hidden items-center gap-2 border border-line bg-white px-3 py-2.5 text-sm shadow-lg sm:flex"><span className="grid size-8 place-items-center rounded-lg bg-[#edf7ef] text-[#2e6a3d]"><ShieldCheck size={17} /></span><span><b className="block text-ink">You stay in control</b><small className="text-muted">Review every entry before saving</small></span></div>
    </div>
  );
}

function Feature({ icon: Icon, title, children }: { icon: typeof Camera; title: string; children: ReactNode }) {
  return <article className="border border-line bg-white p-5"><span className="grid size-10 place-items-center bg-info-soft text-brand"><Icon size={20} /></span><h3 className="mt-4 font-semibold text-ink">{title}</h3><p className="mt-1.5 text-sm leading-6 text-muted">{children}</p></article>;
}

export default function Welcome({ onEnterDemo }: { onEnterDemo: () => void }) {
  const [view, setView] = useState<AuthView>("landing");
  if (view !== "landing") return <AuthCard view={view} onBack={() => setView("landing")} onSwitch={setView} onEnterDemo={onEnterDemo} />;

  return (
    <div className="min-h-dvh overflow-hidden bg-page">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-4 sm:px-8 lg:py-5">
        <Brand />
        <nav className="flex shrink-0 items-center gap-1 sm:gap-3">
          <button onClick={() => setView("login")} className="h-11 px-2 text-sm font-semibold text-brand hover:underline sm:px-4">Log in</button>
          <button onClick={() => setView("signup")} className="h-11 bg-bar px-2.5 text-sm font-semibold text-logo transition hover:bg-bar-strong sm:px-5"><span className="sm:hidden">Sign up</span><span className="hidden sm:inline">Create account</span></button>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl items-center gap-9 px-4 pb-14 pt-8 sm:gap-10 sm:px-8 sm:pb-20 sm:pt-14 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:pb-24 lg:pt-16">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-info-line bg-info-soft px-3 py-1.5 text-sm font-medium text-info-text"><Sparkles size={15} /> Made for neighborhood shops</span>
            <h1 className="mt-5 text-[38px] font-semibold leading-[1.1] tracking-tight text-logo sm:mt-6 sm:text-6xl">Your shop’s hisaab.<br /><span className="text-brand">Finally in order.</span></h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted sm:text-lg sm:leading-8">One simple place for customer credit, stock and handwritten khata. Spend less time sorting the books and more time with your customers.</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button onClick={() => setView("signup")} className="flex h-12 items-center justify-center gap-2 bg-bar px-5 font-semibold text-logo transition hover:bg-bar-strong">Get started for free<ArrowRight size={18} /></button>
              <button onClick={onEnterDemo} className="flex h-12 items-center justify-center gap-2 border border-line bg-white px-5 font-semibold text-brand transition hover:border-brand">Explore the demo<ArrowUpRight size={17} /></button>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted"><span className="inline-flex items-center gap-1.5"><Check size={15} className="text-brand" /> Easy to get started</span><span className="inline-flex items-center gap-1.5"><Check size={15} className="text-brand" /> You review every entry</span></div>
          </div>
          <ShopPreview />
        </section>

        <section className="border-y border-line bg-white">
          <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
            <div className="mx-auto max-w-2xl text-center"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">Built around your day</p><h2 className="mt-2 text-3xl font-semibold tracking-tight text-logo sm:text-4xl">The important things, made simpler.</h2><p className="mt-3 text-muted">Practical tools for the way your shop already works.</p></div>
            <div className="mt-8 grid gap-4 sm:grid-cols-3 sm:gap-5">
              <Feature icon={BookOpen} title="A clearer khata">See customer balances and recent entries without flipping through pages.</Feature>
              <Feature icon={Camera} title="From page to record">Scan handwritten khata entries, check them, and save when they look right.</Feature>
              <Feature icon={ChartNoAxesCombined} title="Stock at a glance">Keep an eye on purchases and low stock alongside your daily hisaab.</Feature>
            </div>
          </div>
        </section>
        <section className="mx-auto flex max-w-7xl flex-col items-stretch justify-between gap-5 px-4 py-12 sm:items-start sm:px-8 md:flex-row md:items-center md:py-16">
          <div><p className="text-sm font-medium text-brand">Ready when you are</p><h2 className="mt-1 text-2xl font-semibold text-logo sm:text-3xl">Bring your shop’s hisaab together.</h2></div>
          <button onClick={() => setView("signup")} className="flex h-12 w-full items-center justify-center gap-2 bg-bar px-5 font-semibold text-logo transition hover:bg-bar-strong md:w-auto">Create your free account<ArrowRight size={18} /></button>
        </section>
      </main>
      <footer className="border-t border-line bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8"><Brand /><span>© 2026 HisaabKitaab · Simple books for your shop</span></div></footer>
    </div>
  );
}
