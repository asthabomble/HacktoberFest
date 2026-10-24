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
  written_name?: string; // name as written on the page, e.g. "Rmsh"
  matched_by?: "shorthand" | "customer" | "fuzzy" | null;
  amount: number;
  type: CreditType;
  date: string | null;
  raw_text: string;
  confidence: Confidence;
};

export type ExtractResponse = { source_image: string; rows: KhataRow[] };

export type CustomerSummary = {
  id: number;
  name: string;
  phone: string | null;
  balance: number;
  days_due: number;
  last_entry: string | null;
  last_payment: { amount: number; date: string } | null;
};

export type CustomerList = { total_outstanding: number; overdue_days: number; customers: CustomerSummary[] };

export type Shop = { id: number; name: string; owner_name: string | null; language: string };

export type LowStockAlert = {
  product_id: number;
  product_name: string;
  unit: string;
  current_stock: number;
  threshold: number;
  shortage: number;
  shelf_low?: boolean; // low because the latest shelf photo said so
  message: string;
};

export type OverdueAlert = {
  customer_id: number;
  customer_name: string;
  phone: string | null;
  balance: number;
  days_due: number;
  overdue_days_threshold: number;
  last_payment: { amount: number; date: string } | null;
  last_entry: string | null;
  message: string;
};

export type AlertsResponse = {
  low_stock_alerts: LowStockAlert[];
  overdue_udhaar_alerts: OverdueAlert[];
  total_alerts: number;
  low_stock_count: number;
  overdue_count: number;
  overdue_days: number;
};

export type DraftReminderResponse = {
  customer_id: number;
  customer_name: string;
  phone: string | null;
  normalized_phone: string | null;
  is_phone_valid: boolean;
  balance: number;
  language: string;
  message: string;
  whatsapp_url: string | null;
  is_fallback: boolean;
};

export type Overview = {
  shop: Shop;
  customer_count: number;
  total_outstanding: number;
  udhaar_today: number;
  overdue_count: number;
  overdue_days: number;
  low_stock_count: number | null;
  shorthand_count: number;
  top_debtors: CustomerSummary[];
  low_stock_alerts?: LowStockAlert[];
  overdue_alerts?: OverdueAlert[];
};

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

export type SimilarCustomer = CustomerSummary & { score: number };

export type Ledger = {
  customer: CustomerSummary;
  aliases: string[];
  overdue_days: number;
  entries: LedgerEntry[];
};

export type ShelfStatus = "low" | "medium" | "full";

export type ExtractedBillItem = {
  item_name: string;
  quantity: number;
  unit: string;
  rate: number | null;
  line_total: number;
  raw_text: string;
  confidence: Confidence;
  needs_confirmation: boolean;
  line_mismatch: boolean;
  suggested_product_id: number | null;
  suggested_product_name: string | null;
  match_score: number;
};

export type BillExtractResponse = {
  source_image: string;
  confirmation_token: string;
  supplier_name: string | null;
  bill_date: string | null;
  items: ExtractedBillItem[];
  stated_total: number | null;
  calculated_total: number;
  has_total_mismatch: boolean;
  discrepancy_details: string | null;
};

export type ConfirmBillItemPayload = {
  product_id?: number | null;
  new_product_name?: string | null;
  unit: string;
  quantity: number;
  rate?: number | null;
  line_total?: number | null;
  raw_text?: string;
  confidence: Confidence;
};

export type ConfirmBillPayload = {
  confirmation_token: string;
  source_image?: string | null;
  supplier_name?: string | null;
  bill_date?: string | null;
  stated_total?: number | null;
  calculated_total?: number | null;
  items: ConfirmBillItemPayload[];
};

export type ShelfItemWithMatch = {
  product_name: string;
  stock_status: ShelfStatus;
  visual_evidence: string;
  confidence: Confidence;
  uncertainty?: string | null;
  suggested_product_id?: number | null;
  suggested_product_name?: string | null;
  match_score: number;
};

export type ShelfAssessResponse = {
  source_image: string;
  items: ShelfItemWithMatch[];
};

export type ConfirmShelfItemPayload = {
  product_id?: number | null;
  new_product_name?: string | null;
  stock_status: ShelfStatus;
  visual_evidence?: string;
  source_image?: string | null;
};

export type ConfirmShelfPayload = {
  items: ConfirmShelfItemPayload[];
};

export type ProductStockItem = {
  id: number;
  name: string;
  unit: string;
  low_stock_threshold: number;
  current_stock: number;
  shelf_status: ShelfStatus | null;
  shelf_evidence: string | null;
  shelf_checked_at: string | null;
  last_purchase_qty: number | null;
  last_purchase_rate: number | null;
  last_purchase_date: string | null;
  last_updated_at: string;
  last_source: "bill" | "shelf_assessment" | "manual";
  is_low: boolean;
};

export type ProductStockHistoryEntry = {
  id: number;
  kind: "purchase" | "sale" | "adjust" | "shelf_check";
  qty_change: number;
  rate: number | null;
  shelf_status: ShelfStatus | null;
  raw_text: string | null;
  source_image: string | null;
  created_at: string;
};

export type ProductStockHistory = {
  product: {
    id: number;
    name: string;
    unit: string;
    low_stock_threshold: number;
  };
  history: ProductStockHistoryEntry[];
};

export type ChatSample = {
  category: string;
  lang: string;
  label: string;
  query: string;
  intent: string;
};

export type StructuredQueryTrace = {
  intent: string;
  threshold?: number | null;
  time_period?: string | null;
  customer_name?: string | null;
  limit?: number | null;
  language: string;
  confidence: "high" | "low";
};

export type ChatResponse = {
  query: string;
  intent: string;
  structured_query: StructuredQueryTrace;
  data: Record<string, any>;
  answer: string;
};
