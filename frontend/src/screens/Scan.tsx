import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Camera, Check, FileText, ImageIcon, Info, X } from "lucide-react";
import { BottomBar, Card, OutlineButton, PrimaryButton, SubHeader, Tabs } from "../components/ui";
import { DiyaJama } from "./CustomerDetail";
import {
  apiGet,
  apiPost,
  apiUpload,
  imageUrl,
  type AiHealth,
  type BillExtractResponse,
  type ExtractResponse,
  type ExtractedBillItem,
  type KhataRow,
  type Overview,
  type ProductStockItem,
  type ShelfAssessResponse,
  type ShelfItemWithMatch,
  type ShelfStatus,
} from "../lib/api";
import { captureFrame, shrinkImage } from "../lib/image";
import { formatDate, formatRupees, today } from "../lib/format";

export type ScanMode = "khata" | "bill" | "shelf";

type EditRow = KhataRow & { key: number; suggestedName: string };
type ProductChoice = number | "new";
type EditBillItem = ExtractedBillItem & { key: number; selectedProductId: ProductChoice; customName: string };
type EditShelfItem = ShelfItemWithMatch & { key: number; selectedProductId: ProductChoice; customName: string };

type Stage =
  | { name: "capture"; error?: string }
  | { name: "reading"; preview: string }
  | { name: "review_khata"; sourceImage: string }
  | { name: "review_bill"; sourceImage: string }
  | { name: "review_shelf"; sourceImage: string };

const MODE_COPY: Record<ScanMode, { hint: string; reading: string }> = {
  khata: { hint: "Poora page frame mein rakho. Hindi, Marathi aur English — teeno chalega.", reading: "Khata padh rahe hain…" },
  bill: { hint: "Supplier ka poora bill frame mein rakho. Printed ya haath se likha — dono chalega.", reading: "Bill padh rahe hain…" },
  shelf: { hint: "Poori shelf ya rack frame mein rakho. Status Low / Medium / Full milega, exact ginti nahi.", reading: "Shelf dekh rahe hain…" },
};

let nextKey = 1;
const blankRow = (): EditRow => ({
  key: nextKey++,
  suggestedName: "",
  customer_name: "",
  amount: 0,
  type: "gave",
  date: today(),
  raw_text: "",
  confidence: "high",
});

const blankBillItem = (): EditBillItem => ({
  key: nextKey++,
  item_name: "",
  quantity: 1,
  unit: "pcs",
  rate: null,
  line_total: 0,
  raw_text: "",
  confidence: "high",
  needs_confirmation: false,
  line_mismatch: false,
  suggested_product_id: null,
  suggested_product_name: null,
  match_score: 0,
  selectedProductId: "new",
  customName: "",
});

const rowValid = (r: EditRow) => r.customer_name.trim() !== "" && r.amount > 0;
const billItemValid = (it: EditBillItem) => it.quantity > 0 && it.customName.trim() !== "";
const toNumber = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;

const field = "min-w-0 border-b-2 border-line bg-soft px-2.5 py-2 text-[15px] outline-none focus:border-brand";

/* ---------- Capture (page 2 of the design) ---------- */

function useCamera(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setLive(true);
      })
      .catch(() => setLive(false)); // no permission / no camera / plain http on a phone
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      setLive(false);
    };
  }, [enabled]);

  return { videoRef, live };
}

function CameraBox({
  videoRef,
  live,
  preview,
  readingText,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  live: boolean;
  preview?: string;
  readingText: string;
}) {
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden bg-camera">
      <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full object-cover ${live && !preview ? "" : "hidden"}`} />
      {preview && <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />}
      {!live && !preview && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
          <FileText size={44} strokeWidth={1.4} />
          <span>Camera preview</span>
          <span className="px-8 text-center text-xs text-slate-400">Capture dabane par phone ka camera khulega</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-6 border-2 border-dashed border-bar" />
      {preview && (
        <>
          <div className="absolute inset-x-6 h-[3px] animate-[scan_1.6s_ease-in-out_infinite_alternate] bg-bar shadow-[0_0_14px_var(--color-bar)]" />
          <div className="absolute inset-x-0 bottom-10 text-center">
            <span className="bg-logo/80 px-3 py-1.5 text-sm font-medium text-bar">{readingText}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Shared review pieces ---------- */

function ReviewHeader({ image, title, subtitle }: { image: string; title: string; subtitle: string }) {
  return (
    <div className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
        {image ? (
          <a href={imageUrl(image)} target="_blank" rel="noreferrer">
            <img src={imageUrl(image)} alt="Scanned photo" className="size-14 bg-camera object-cover" />
          </a>
        ) : (
          <span className="size-14 bg-camera" />
        )}
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function CardTop({ readAs, low, onRemove }: { readAs: string; low: boolean; onRemove: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <p className="min-w-0 flex-1 truncate font-mono text-sm text-muted">Read as: {readAs || "—"}</p>
      {low && <span className="shrink-0 rounded-full bg-warn px-2.5 py-0.5 text-sm font-medium text-ink">Low confidence</span>}
      <button onClick={onRemove} aria-label="Remove" className="shrink-0 text-muted hover:text-danger">
        <X size={18} />
      </button>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-xs uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Link a scanned item to an existing product, or create a new one */
function ProductSelect({
  value,
  products,
  onChange,
}: {
  value: ProductChoice;
  products: ProductStockItem[];
  onChange: (choice: ProductChoice, product?: ProductStockItem) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === "new") return onChange("new");
        const id = Number(e.target.value);
        onChange(id, products.find((p) => p.id === id));
      }}
      className={`${field} w-full`}
    >
      <option value="new">+ New product</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.unit})
        </option>
      ))}
    </select>
  );
}

/* ---------- Review cards ---------- */

function KhataCard({ row, onChange, onRemove }: { row: EditRow; onChange: (p: Partial<EditRow>) => void; onRemove: () => void }) {
  const low = row.confidence === "low";
  return (
    <li className={`border p-3 ${low ? "border-warn-line bg-warn-soft" : "border-line bg-white"}`}>
      <CardTop readAs={row.raw_text} low={low} onRemove={onRemove} />
      <div className="flex gap-2">
        <input
          value={row.customer_name}
          onChange={(e) => onChange({ customer_name: e.target.value })}
          placeholder="Customer"
          className={`${field} flex-1 ${row.customer_name.trim() ? "" : "border-danger"}`}
        />
        <input
          value={row.amount || ""}
          onChange={(e) => onChange({ amount: toNumber(e.target.value) })}
          inputMode="decimal"
          placeholder="Amount"
          className={`${field} w-[4.5rem] text-right font-mono font-semibold ${row.amount > 0 ? "" : "border-danger"}`}
        />
        <DiyaJama value={row.type} onChange={(type) => onChange({ type })} />
      </div>
      <NameHint row={row} />
    </li>
  );
}

const MATCH_LABEL = { shorthand: "seekha hua", customer: "customer list se", fuzzy: "milta-julta naam" } as const;

/** "Rmsh → Ramesh bhau · seekha hua", or after a correction: "Yaad rakhenge: Rmsh = Ramesh bhau" */
function NameHint({ row }: { row: EditRow }) {
  const written = row.written_name?.trim() ?? "";
  const name = row.customer_name.trim();
  if (!written || !name || written.toLowerCase() === name.toLowerCase()) return null;
  if (row.matched_by && name === row.suggestedName) {
    return (
      <p className="mt-2 text-sm text-muted">
        <span className="font-mono">{written}</span> → {name} · {MATCH_LABEL[row.matched_by]}
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm text-brand">
      Save karne par yaad rakhenge: <span className="font-mono">{written}</span> = {name}
    </p>
  );
}

function BillCard({
  item,
  products,
  onChange,
  onRemove,
}: {
  item: EditBillItem;
  products: ProductStockItem[];
  onChange: (p: Partial<EditBillItem>) => void;
  onRemove: () => void;
}) {
  const low = item.confidence === "low" || item.needs_confirmation;
  return (
    <li className={`space-y-2 border p-3 ${low ? "border-warn-line bg-warn-soft" : "border-line bg-white"}`}>
      <CardTop readAs={item.raw_text || item.item_name} low={low} onRemove={onRemove} />

      <Labeled label={item.selectedProductId !== "new" && item.match_score > 0 ? `Product · ${Math.round(item.match_score * 100)}% match` : "Product"}>
        <ProductSelect
          value={item.selectedProductId}
          products={products}
          onChange={(choice, product) =>
            onChange(
              choice === "new"
                ? { selectedProductId: "new", customName: item.item_name }
                : { selectedProductId: choice, customName: product?.name ?? item.customName, unit: product?.unit ?? item.unit },
            )
          }
        />
      </Labeled>
      {item.selectedProductId === "new" && (
        <input
          value={item.customName}
          onChange={(e) => onChange({ customName: e.target.value })}
          placeholder="New product name"
          className={`${field} w-full ${item.customName.trim() ? "" : "border-danger"}`}
        />
      )}

      <div className="grid grid-cols-4 gap-2">
        <Labeled label="Qty">
          <input
            value={item.quantity || ""}
            onChange={(e) => {
              const quantity = toNumber(e.target.value);
              const line_total = item.rate ? Math.round(quantity * item.rate * 100) / 100 : item.line_total;
              onChange({ quantity, line_total });
            }}
            inputMode="decimal"
            className={`${field} w-full text-right font-mono ${item.quantity > 0 ? "" : "border-danger"}`}
          />
        </Labeled>
        <Labeled label="Unit">
          <input value={item.unit} onChange={(e) => onChange({ unit: e.target.value })} className={`${field} w-full`} />
        </Labeled>
        <Labeled label="Rate ₹">
          <input
            value={item.rate ?? ""}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d.]/g, "");
              const rate = raw ? Number(raw) : null;
              const line_total = rate !== null ? Math.round(item.quantity * rate * 100) / 100 : item.line_total;
              onChange({ rate, line_total });
            }}
            inputMode="decimal"
            className={`${field} w-full text-right font-mono`}
          />
        </Labeled>
        <Labeled label="Total ₹">
          <input
            value={item.line_total || ""}
            onChange={(e) => onChange({ line_total: toNumber(e.target.value) })}
            inputMode="decimal"
            className={`${field} w-full text-right font-mono font-semibold`}
          />
        </Labeled>
      </div>
      {item.line_mismatch && <p className="text-sm text-info-text">Rate × qty line total se match nahi karta — check karein.</p>}
    </li>
  );
}

function ShelfCard({
  item,
  products,
  onChange,
  onRemove,
}: {
  item: EditShelfItem;
  products: ProductStockItem[];
  onChange: (p: Partial<EditShelfItem>) => void;
  onRemove: () => void;
}) {
  const low = item.confidence === "low";
  const seg = (active: boolean) => `flex-1 py-2 text-sm ${active ? "bg-bar font-medium text-logo" : "bg-white text-muted"}`;
  return (
    <li className={`space-y-2 border p-3 ${low ? "border-warn-line bg-warn-soft" : "border-line bg-white"}`}>
      <CardTop readAs={item.product_name} low={low} onRemove={onRemove} />
      <Labeled label="Product">
        <ProductSelect
          value={item.selectedProductId}
          products={products}
          onChange={(choice, product) =>
            onChange(
              choice === "new"
                ? { selectedProductId: "new", customName: item.product_name }
                : { selectedProductId: choice, customName: product?.name ?? item.customName },
            )
          }
        />
      </Labeled>
      <div className="flex border border-muted/50">
        {(["low", "medium", "full"] as ShelfStatus[]).map((st) => (
          <button key={st} type="button" onClick={() => onChange({ stock_status: st })} className={seg(item.stock_status === st)}>
            {st === "low" ? "Low" : st === "medium" ? "Medium" : "Full"}
          </button>
        ))}
      </div>
      <input
        value={item.visual_evidence}
        onChange={(e) => onChange({ visual_evidence: e.target.value })}
        placeholder="Kya dikha (e.g. 2 packet bache)"
        className={`${field} w-full`}
      />
      {item.uncertainty && <p className="text-sm text-muted">Note: {item.uncertainty}</p>}
    </li>
  );
}

/* ---------- Screen ---------- */

export default function Scan({
  initialMode = "khata",
  onBack,
  onSaved,
}: {
  initialMode?: ScanMode;
  onBack: () => void;
  onSaved: (target: "ledger" | "stock", message: string) => void;
}) {
  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [stage, setStage] = useState<Stage>({ name: "capture" });
  const [filter, setFilter] = useState<"all" | "review">("all");
  const [saving, setSaving] = useState(false);
  const [shorthand, setShorthand] = useState<number | null>(null);
  const [model, setModel] = useState<AiHealth | null>(null);
  const [products, setProducts] = useState<ProductStockItem[]>([]);

  // Khata
  const [rows, setRows] = useState<EditRow[]>([]);
  // Supplier bill
  const [bill, setBill] = useState<BillExtractResponse | null>(null);
  const [billItems, setBillItems] = useState<EditBillItem[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [billDate, setBillDate] = useState(today());
  // Shelf
  const [shelfItems, setShelfItems] = useState<EditShelfItem[]>([]);

  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const { videoRef, live } = useCamera(stage.name === "capture");

  useEffect(() => {
    apiGet<Overview>("/api/overview").then((o) => setShorthand(o.shorthand_count)).catch(() => {});
    apiGet<AiHealth>("/api/health/ai").then(setModel).catch(() => {});
    apiGet<{ products: ProductStockItem[] }>("/api/stock/products")
      .then((d) => setProducts(d.products))
      .catch(() => {});
  }, []);

  async function read(image: Blob, preview: string) {
    setStage({ name: "reading", preview });
    setFilter("all");
    try {
      if (mode === "khata") {
        const res = await apiUpload<ExtractResponse>("/api/khata/extract", image, "khata.jpg");
        const extracted = res.rows.map((r) => ({ ...r, date: r.date ?? today(), key: nextKey++, suggestedName: r.customer_name }));
        setRows(extracted.length ? extracted : [blankRow()]);
        setStage({ name: "review_khata", sourceImage: res.source_image });
      } else if (mode === "bill") {
        const res = await apiUpload<BillExtractResponse>("/api/stock/bills/extract", image, "bill.jpg");
        setBill(res);
        setSupplierName(res.supplier_name ?? "");
        setBillDate(res.bill_date ?? today());
        const items = res.items.map((it) => ({
          ...it,
          key: nextKey++,
          selectedProductId: it.suggested_product_id ?? ("new" as const),
          customName: it.suggested_product_name ?? it.item_name,
        }));
        setBillItems(items.length ? items : [blankBillItem()]);
        setStage({ name: "review_bill", sourceImage: res.source_image });
      } else {
        const res = await apiUpload<ShelfAssessResponse>("/api/stock/shelf/assess", image, "shelf.jpg");
        setShelfItems(
          res.items.map((it) => ({
            ...it,
            key: nextKey++,
            selectedProductId: it.suggested_product_id ?? ("new" as const),
            customName: it.suggested_product_name ?? it.product_name,
          })),
        );
        setStage({ name: "review_shelf", sourceImage: res.source_image });
      }
    } catch (e) {
      setStage({ name: "capture", error: (e as Error).message });
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    read(await shrinkImage(file), URL.createObjectURL(file));
  }

  async function capture() {
    if (live && videoRef.current) {
      const blob = await captureFrame(videoRef.current);
      read(blob, URL.createObjectURL(blob));
    } else {
      cameraInput.current?.click();
    }
  }

  async function save<T>(request: () => Promise<T>, target: "ledger" | "stock", message: string | ((res: T) => string)) {
    setSaving(true);
    try {
      const res = await request();
      onSaved(target, typeof message === "string" ? message : message(res));
    } catch (e) {
      alert(`Save nahi hua: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  const retake = () => setStage({ name: "capture" });

  const fileInputs = (
    <>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={galleryInput} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </>
  );

  /* ----- Khata review (page 3 of the design) ----- */
  if (stage.name === "review_khata") {
    const lowCount = rows.filter((r) => r.confidence === "low").length;
    const shown = filter === "review" ? rows.filter((r) => r.confidence === "low") : rows;
    const canSave = rows.length > 0 && rows.every(rowValid);
    const update = (key: number, patch: Partial<EditRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

    return (
      <>
        <SubHeader title="Review entries" onBack={retake} />
        <ReviewHeader
          image={stage.sourceImage}
          title={`Khata page · ${formatDate(today())}`}
          subtitle={`${rows.length} entries found · edit anything that's wrong`}
        />
        <Tabs
          active={filter}
          onChange={setFilter}
          tabs={[
            { id: "all", label: `All (${rows.length})` },
            { id: "review", label: "Needs review", badge: lowCount, badgeTone: "orange" },
          ]}
        />
        <div className="mx-auto max-w-md px-4 py-4 pb-28">
          <ul className="space-y-3">
            {shown.map((r) => (
              <KhataCard key={r.key} row={r} onChange={(p) => update(r.key, p)} onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
            ))}
          </ul>
          {shown.length === 0 && <p className="py-8 text-center text-muted">Sab entries theek lag rahi hain.</p>}
          {filter === "all" && (
            <button onClick={() => setRows((rs) => [...rs, blankRow()])} className="mt-3 font-medium text-brand">
              + Entry jodo
            </button>
          )}
        </div>
        <BottomBar>
          <OutlineButton onClick={retake} className="w-28 shrink-0">
            Retake
          </OutlineButton>
          <PrimaryButton
            icon={Check}
            disabled={!canSave || saving}
            className="flex-1"
            onClick={() =>
              save(
                () =>
                  apiPost<{ saved: number; learned: number }>("/api/khata/confirm", {
                    source_image: stage.sourceImage || null,
                    rows: rows.map(({ key, suggestedName, ...r }) => r),
                  }),
                "ledger",
                (res) =>
                  res.learned > 0
                    ? `Entries save ho gayi · ${res.learned} naya shorthand seekha`
                    : "Entries khate mein save ho gayi",
              )
            }
          >
            {saving ? "Saving…" : `Confirm all ${rows.length}`}
          </PrimaryButton>
        </BottomBar>
      </>
    );
  }

  /* ----- Supplier bill review ----- */
  if (stage.name === "review_bill" && bill) {
    const lowCount = billItems.filter((i) => i.confidence === "low" || i.needs_confirmation).length;
    const shown = filter === "review" ? billItems.filter((i) => i.confidence === "low" || i.needs_confirmation) : billItems;
    const calculated = billItems.reduce((s, it) => s + (it.line_total || 0), 0);
    const canSave = billItems.length > 0 && billItems.every(billItemValid);
    const update = (key: number, patch: Partial<EditBillItem>) =>
      setBillItems((items) => items.map((x) => (x.key === key ? { ...x, ...patch } : x)));

    return (
      <>
        <SubHeader title="Review bill" onBack={retake} />
        <ReviewHeader
          image={stage.sourceImage}
          title={`Supplier bill · ${formatDate(billDate)}`}
          subtitle={`${billItems.length} items found · edit anything that's wrong`}
        />
        <Tabs
          active={filter}
          onChange={setFilter}
          tabs={[
            { id: "all", label: `All (${billItems.length})` },
            { id: "review", label: "Needs review", badge: lowCount, badgeTone: "orange" },
          ]}
        />
        <div className="mx-auto max-w-md space-y-3 px-4 py-4 pb-28">
          <Card className="grid grid-cols-[1fr_9rem] gap-2 p-3">
            <Labeled label="Supplier">
              <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Wholesaler ka naam" className={`${field} w-full`} />
            </Labeled>
            <Labeled label="Bill date">
              <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className={`${field} w-full`} />
            </Labeled>
          </Card>

          {bill.has_total_mismatch && (
            <div className="flex gap-3 border border-warn-line bg-warn-soft p-3">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-info-text" />
              <div className="min-w-0 text-[15px]">
                <p className="font-medium">Bill total match nahi kar raha</p>
                {bill.discrepancy_details && <p className="text-sm text-muted">{bill.discrepancy_details}</p>}
                <p className="mt-1 font-mono text-sm">
                  Bill par: {bill.stated_total != null ? formatRupees(bill.stated_total) : "—"} · Items ka jod: {formatRupees(calculated)}
                </p>
              </div>
            </div>
          )}

          <ul className="space-y-3">
            {shown.map((it) => (
              <BillCard
                key={it.key}
                item={it}
                products={products}
                onChange={(p) => update(it.key, p)}
                onRemove={() => setBillItems((items) => items.filter((x) => x.key !== it.key))}
              />
            ))}
          </ul>
          {shown.length === 0 && <p className="py-8 text-center text-muted">Sab items theek lag rahe hain.</p>}
          {filter === "all" && (
            <button onClick={() => setBillItems((items) => [...items, blankBillItem()])} className="font-medium text-brand">
              + Item jodo
            </button>
          )}
        </div>
        <BottomBar>
          <OutlineButton onClick={retake} className="w-28 shrink-0">
            Retake
          </OutlineButton>
          <PrimaryButton
            icon={Check}
            disabled={!canSave || saving}
            className="flex-1"
            onClick={() =>
              save(
                () =>
                  apiPost("/api/stock/bills/confirm", {
                    confirmation_token: bill.confirmation_token,
                    source_image: stage.sourceImage || null,
                    supplier_name: supplierName.trim() || null,
                    bill_date: billDate || null,
                    stated_total: bill.stated_total,
                    calculated_total: calculated,
                    items: billItems.map((it) => ({
                      product_id: it.selectedProductId === "new" ? null : it.selectedProductId,
                      new_product_name: it.selectedProductId === "new" ? it.customName.trim() : null,
                      unit: it.unit || "pcs",
                      quantity: it.quantity,
                      rate: it.rate,
                      line_total: it.line_total,
                      raw_text: it.raw_text,
                      item_name: it.item_name,
                      confidence: it.confidence,
                    })),
                  }),
                "stock",
                "Bill save ho gaya, stock update hua",
              )
            }
          >
            {saving ? "Saving…" : `Confirm bill (${billItems.length})`}
          </PrimaryButton>
        </BottomBar>
      </>
    );
  }

  /* ----- Shelf review ----- */
  if (stage.name === "review_shelf") {
    const update = (key: number, patch: Partial<EditShelfItem>) =>
      setShelfItems((items) => items.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    const canSave = shelfItems.length > 0 && shelfItems.every((it) => it.selectedProductId !== "new" || it.customName.trim());

    return (
      <>
        <SubHeader title="Review shelf" onBack={retake} />
        <ReviewHeader
          image={stage.sourceImage}
          title={`Shelf check · ${formatDate(today())}`}
          subtitle={`${shelfItems.length} products dikhe · status theek karein`}
        />
        <div className="mx-auto max-w-md space-y-3 px-4 py-4 pb-28">
          <div className="flex gap-3 border border-info-line bg-info-soft p-3 text-info-text">
            <Info size={20} className="mt-0.5 shrink-0" />
            <p className="text-[15px]">Ye andaaza hai (Low / Medium / Full). Isse stock ki exact ginti nahi badlegi.</p>
          </div>
          <ul className="space-y-3">
            {shelfItems.map((it) => (
              <ShelfCard
                key={it.key}
                item={it}
                products={products}
                onChange={(p) => update(it.key, p)}
                onRemove={() => setShelfItems((items) => items.filter((x) => x.key !== it.key))}
              />
            ))}
          </ul>
          {shelfItems.length === 0 && <p className="py-8 text-center text-muted">Koi product pehchaan nahi paaye.</p>}
        </div>
        <BottomBar>
          <OutlineButton onClick={retake} className="w-28 shrink-0">
            Retake
          </OutlineButton>
          <PrimaryButton
            icon={Check}
            disabled={!canSave || saving}
            className="flex-1"
            onClick={() =>
              save(
                () =>
                  apiPost("/api/stock/shelf/confirm", {
                    items: shelfItems.map((it) => ({
                      product_id: it.selectedProductId === "new" ? null : it.selectedProductId,
                      new_product_name: it.selectedProductId === "new" ? it.customName.trim() : null,
                      stock_status: it.stock_status,
                      visual_evidence: it.visual_evidence,
                      source_image: stage.sourceImage || null,
                    })),
                  }),
                "stock",
                "Shelf status save ho gaya",
              )
            }
          >
            {saving ? "Saving…" : `Confirm shelf (${shelfItems.length})`}
          </PrimaryButton>
        </BottomBar>
      </>
    );
  }

  /* ----- Capture ----- */
  const reading = stage.name === "reading";

  return (
    <>
      {fileInputs}
      <SubHeader title="New scan" onBack={onBack} />
      <Tabs<ScanMode>
        stretch
        active={mode}
        onChange={(m) => {
          if (reading) return;
          setMode(m);
          setStage({ name: "capture" });
        }}
        tabs={[
          { id: "khata", label: "Khata page" },
          { id: "bill", label: "Supplier bill" },
          { id: "shelf", label: "Shelf" },
        ]}
      />
      <div className="mx-auto max-w-md space-y-4 px-4 py-4 pb-28">
        {stage.name === "capture" && stage.error ? (
          <div className="flex gap-3 border border-danger/40 bg-danger-soft p-3 text-danger">
            <Info size={20} className="mt-0.5 shrink-0" />
            <p className="min-w-0 break-words text-[15px]">Photo padh nahi paaye: {stage.error}</p>
          </div>
        ) : (
          <div className="flex gap-3 border border-info-line bg-info-soft p-3 text-info-text">
            <Info size={20} className="mt-0.5 shrink-0" />
            <p className="text-[15px]">{MODE_COPY[mode].hint}</p>
          </div>
        )}

        <CameraBox videoRef={videoRef} live={live} preview={reading ? stage.preview : undefined} readingText={MODE_COPY[mode].reading} />

        <Card className="grid grid-cols-2">
          <div className="border-r border-line p-3">
            <p className="text-xs uppercase tracking-wider text-muted">{mode === "khata" ? "Shorthand learned" : "Products"}</p>
            <p className="font-mono text-xl font-semibold">{mode === "khata" ? (shorthand ?? "—") : products.length}</p>
          </div>
          <div className="p-3" title={model?.detail}>
            <p className="text-xs uppercase tracking-wider text-muted">Model</p>
            <p className="flex items-center gap-2 text-[15px]">
              <span className={`size-2.5 rounded-full ${model === null ? "bg-line" : model.ok ? "bg-bar-strong" : "bg-danger"}`} />
              Gemma · {model === null ? "…" : model.ok ? "online" : "offline"}
            </p>
          </div>
        </Card>
      </div>

      <BottomBar>
        <OutlineButton icon={ImageIcon} onClick={() => galleryInput.current?.click()} className="w-32 shrink-0">
          Gallery
        </OutlineButton>
        <PrimaryButton icon={Camera} onClick={capture} disabled={reading} className="flex-1">
          {reading ? "Reading…" : "Capture"}
        </PrimaryButton>
      </BottomBar>
    </>
  );
}
