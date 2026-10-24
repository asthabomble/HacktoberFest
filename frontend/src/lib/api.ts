const BASE = import.meta.env.VITE_API_URL ?? "";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // FastAPI puts the message in `detail`
    const body = await res.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : `${res.status} ${res.statusText}`;
    throw new Error(detail);
  }
  return res.json();
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await fetch(`${BASE}${path}`));
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function apiUpload<T>(path: string, file: Blob, filename: string): Promise<T> {
  const form = new FormData();
  form.append("file", file, filename);
  return handle<T>(await fetch(`${BASE}${path}`, { method: "POST", body: form }));
}

export const imageUrl = (path: string) => `${BASE}${path}`;

export type AppHealth = { status: "ok" | "error"; database: boolean };

export type AiHealth = {
  provider: string;
  model: string;
  ok: boolean;
  detail: string;
  generation?: string;
};

export type CreditType = "gave" | "got";
export type Confidence = "high" | "low";

export type KhataRow = {
  customer_name: string;
  amount: number;
  type: CreditType;
  date: string | null;
  raw_text: string;
  confidence: Confidence;
};

export type ExtractResponse = { source_image: string; rows: KhataRow[] };

export type CustomerBalance = {
  id: number;
  name: string;
  phone: string | null;
  balance: number;
  last_entry: string | null;
};

export type CustomerList = { total_outstanding: number; customers: CustomerBalance[] };

export type LedgerEntry = {
  id: number;
  amount: number;
  type: CreditType;
  entry_date: string;
  raw_text: string | null;
  source_image: string | null;
  confidence: Confidence;
  running_balance: number;
};

export type Ledger = {
  customer: { id: number; name: string; phone: string | null };
  balance: number;
  entries: LedgerEntry[];
};
