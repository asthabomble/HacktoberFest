import { useEffect, useRef, useState } from "react";
import {
  apiGet,
  apiPost,
  apiUpload,
  imageUrl,
  type BillExtractResponse,
  type CustomerList,
  type ExtractResponse,
  type ExtractedBillItem,
  type KhataRow,
  type ProductStockItem,
  type ShelfAssessResponse,
  type ShelfItemWithMatch,
  type ShelfStatus,
} from "../lib/api";
import { today } from "../lib/format";
import { shrinkImage } from "../lib/image";

export type ScanMode = "khata" | "bill" | "shelf";

// --- Types ---

type EditKhataRow = KhataRow & { key: number; include: boolean };

type EditBillItem = ExtractedBillItem & {
  key: number;
  include: boolean;
  selectedProductId: number | null | "new";
  customName: string;
};

type EditShelfItem = ShelfItemWithMatch & {
  key: number;
  selectedProductId: number | null | "new";
  customName: string;
};

type Stage =
  | { name: "pick" }
  | { name: "reading"; preview: string; lines: string[] }
  | { name: "confirm_khata"; sourceImage: string }
  | { name: "confirm_bill"; sourceImage: string; data: BillExtractResponse }
  | { name: "confirm_shelf"; sourceImage: string; data: ShelfAssessResponse }
  | { name: "error"; message: string; preview?: string };

let nextKey = 1;

const blankKhataRow = (): EditKhataRow => ({
  key: nextKey++,
  customer_name: "",
  amount: 0,
  type: "gave",
  date: today(),
  raw_text: "",
  confidence: "high",
  include: true,
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
  include: true,
  selectedProductId: "new",
  customName: "",
});

function ReadingLoader({ preview, lines }: { preview: string; lines: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 1800);
    return () => clearInterval(t);
  }, [lines]);

  return (
    <div className="flex flex-col items-center gap-6 pt-6">
      <div className="relative w-full overflow-hidden border-2 border-line">
        <img src={preview} alt="" className="max-h-80 w-full object-cover opacity-60" />
        <div className="absolute inset-x-0 h-1 animate-[scan_1.6s_ease-in-out_infinite_alternate] bg-mint shadow-[0_0_16px_var(--color-mint)]" />
      </div>
      <p className="font-pixel text-sm text-mint">{lines[i]}</p>
      <p className="text-center text-sm text-muted">AI model reading and validating items…</p>
    </div>
  );
}

// --- Main Scan Component ---

export default function Scan({
  initialMode = "khata",
  onSaved,
}: {
  initialMode?: ScanMode;
  onSaved: (target: "ledger" | "stock", msg: string) => void;
}) {
  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [stage, setStage] = useState<Stage>({ name: "pick" });

  // Khata State
  const [khataRows, setKhataRows] = useState<EditKhataRow[]>([]);
  const [customerNames, setCustomerNames] = useState<string[]>([]);

  // Bill State
  const [billItems, setBillItems] = useState<EditBillItem[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [hasMismatch, setHasMismatch] = useState(false);
  const [statedTotal, setStatedTotal] = useState<number | null>(null);
  const [discrepancyText, setDiscrepancyText] = useState<string | null>(null);
  const [billToken, setBillToken] = useState("");

  // Shelf State
  const [shelfItems, setShelfItems] = useState<EditShelfItem[]>([]);

  // Shared Products List for Matching
  const [existingProducts, setExistingProducts] = useState<ProductStockItem[]>([]);

  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load customer names for khata
    apiGet<CustomerList>("/api/customers")
      .then((d) => setCustomerNames(d.customers.map((c) => c.name)))
      .catch(() => {});

    // Load products for bill / shelf matching
    apiGet<{ products: ProductStockItem[] }>("/api/stock/products")
      .then((d) => setExistingProducts(d.products))
      .catch(() => {});
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const preview = URL.createObjectURL(file);

    if (mode === "khata") {
      setStage({
        name: "reading",
        preview,
        lines: ["Khata padh raha hoon…", "Naam pehchaan raha hoon…", "Hisaab jod raha hoon…"],
      });
      try {
        const blob = await shrinkImage(file);
        const res = await apiUpload<ExtractResponse>("/api/khata/extract", blob, "khata.jpg");
        const extracted = res.rows.map((r) => ({
          ...r,
          date: r.date ?? today(),
          key: nextKey++,
          include: true,
        }));
        setKhataRows(extracted.length ? extracted : [blankKhataRow()]);
        setStage({ name: "confirm_khata", sourceImage: res.source_image });
      } catch (e) {
        setStage({ name: "error", message: (e as Error).message, preview });
      }
    } else if (mode === "bill") {
      setStage({
        name: "reading",
        preview,
        lines: [
          "Supplier bill scan kar raha hoon…",
          "Item, quantity aur rate nikal raha hoon…",
          "Bill total verify kar raha hoon…",
        ],
      });
      try {
        const blob = await shrinkImage(file);
        const res = await apiUpload<BillExtractResponse>("/api/stock/bills/extract", blob, "bill.jpg");

        setSupplierName(res.supplier_name || "");
        setBillDate(res.bill_date || today());
        setHasMismatch(res.has_total_mismatch);
        setStatedTotal(res.stated_total);
        setDiscrepancyText(res.discrepancy_details);
        setBillToken(res.confirmation_token);

        const items: EditBillItem[] = res.items.map((it) => ({
          ...it,
          key: nextKey++,
          include: true,
          selectedProductId: it.suggested_product_id ? it.suggested_product_id : "new",
          customName: it.suggested_product_name || it.item_name,
        }));

        setBillItems(items.length ? items : [blankBillItem()]);
        setStage({ name: "confirm_bill", sourceImage: res.source_image, data: res });
      } catch (e) {
        setStage({ name: "error", message: (e as Error).message, preview });
      }
    } else if (mode === "shelf") {
      setStage({
        name: "reading",
        preview,
        lines: [
          "Shelf photo dekh raha hoon…",
          "Products ki pehchaan kar raha hoon…",
          "Stock status (Low/Med/Full) jaanch raha hoon…",
        ],
      });
      try {
        const blob = await shrinkImage(file);
        const res = await apiUpload<ShelfAssessResponse>("/api/stock/shelf/assess", blob, "shelf.jpg");

        const items: EditShelfItem[] = res.items.map((it) => ({
          ...it,
          key: nextKey++,
          selectedProductId: it.suggested_product_id ? it.suggested_product_id : "new",
          customName: it.suggested_product_name || it.product_name,
        }));

        setShelfItems(items);
        setStage({ name: "confirm_shelf", sourceImage: res.source_image, data: res });
      } catch (e) {
        setStage({ name: "error", message: (e as Error).message, preview });
      }
    }
  }

  // --- Confirm Khata ---
  async function confirmKhata() {
    if (stage.name !== "confirm_khata") return;
    const toSave = khataRows.filter((r) => r.include && r.customer_name.trim() && r.amount > 0);
    setSaving(true);
    try {
      await apiPost("/api/khata/confirm", {
        source_image: stage.sourceImage || null,
        rows: toSave.map(({ key, include, ...r }) => r),
      });
      setKhataRows([]);
      setStage({ name: "pick" });
      onSaved("ledger", "Khate mein save ho gaya ✓");
    } catch (e) {
      alert(`Save nahi hua: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  // --- Confirm Supplier Bill ---
  async function confirmBill() {
    if (stage.name !== "confirm_bill") return;
    const toSave = billItems.filter((i) => i.include && i.quantity > 0 && i.customName.trim());
    setSaving(true);
    try {
      await apiPost("/api/stock/bills/confirm", {
        confirmation_token: billToken,
        source_image: stage.sourceImage || null,
        supplier_name: supplierName.trim() || null,
        bill_date: billDate || null,
        stated_total: statedTotal,
        calculated_total: toSave.reduce((s, it) => s + (it.line_total || 0), 0),
        items: toSave.map((it) => ({
          product_id: it.selectedProductId === "new" ? null : it.selectedProductId,
          new_product_name: it.selectedProductId === "new" ? it.customName.trim() : null,
          unit: it.unit || "pcs",
          quantity: it.quantity,
          rate: it.rate,
          line_total: it.line_total,
          raw_text: it.raw_text,
          confidence: it.confidence,
        })),
      });
      setBillItems([]);
      setStage({ name: "pick" });
      onSaved("stock", "Supplier bill confirm ho gaya! Stock update hua ✓");
    } catch (e) {
      alert(`Bill save nahi hua: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  // --- Confirm Shelf Assessment ---
  async function confirmShelf() {
    if (stage.name !== "confirm_shelf") return;
    setSaving(true);
    try {
      await apiPost("/api/stock/shelf/confirm", {
        items: shelfItems.map((it) => ({
          product_id: it.selectedProductId === "new" ? null : it.selectedProductId,
          new_product_name: it.selectedProductId === "new" ? it.customName.trim() : null,
          stock_status: it.stock_status,
          visual_evidence: it.visual_evidence,
          source_image: stage.sourceImage || null,
        })),
      });
      setShelfItems([]);
      setStage({ name: "pick" });
      onSaved("stock", "Shelf status save ho gaya ✓");
    } catch (e) {
      alert(`Shelf status save nahi hua: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const fileInputs = (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
    </>
  );

  // --- Mode Picker Tabs ---
  const modeSwitcher = (
    <div className="mb-4 grid grid-cols-3 gap-1 border-2 border-line bg-panel p-1 font-pixel text-xs">
      <button
        onClick={() => {
          setMode("khata");
          setStage({ name: "pick" });
        }}
        className={`py-2 ${mode === "khata" ? "bg-marigold text-ink font-bold" : "text-muted hover:text-paper"}`}
      >
        Khata
      </button>
      <button
        onClick={() => {
          setMode("bill");
          setStage({ name: "pick" });
        }}
        className={`py-2 ${mode === "bill" ? "bg-marigold text-ink font-bold" : "text-muted hover:text-paper"}`}
      >
        Supplier Bill
      </button>
      <button
        onClick={() => {
          setMode("shelf");
          setStage({ name: "pick" });
        }}
        className={`py-2 ${mode === "shelf" ? "bg-marigold text-ink font-bold" : "text-muted hover:text-paper"}`}
      >
        Shelf Photo
      </button>
    </div>
  );

  // ================= STAGE: PICK =================
  if (stage.name === "pick") {
    let title = "Scan khata";
    let sub = "Poora panna frame mein rakho, roshni achhi ho.";
    let bulletList = [
      "Hindi, Marathi, English sab chalega",
      "Save karne se pehle har line check kar sakte ho",
      "Peeli lines dhyan se dekhna",
    ];

    if (mode === "bill") {
      title = "Scan Supplier Bill";
      sub = "Supplier ya wholesaler ka bill/parcha photograph karo.";
      bulletList = [
        "Printed ya handwritten bills dono chalenge",
        "Item, quantity, rate aur totals auto-calculate honge",
        "Total mismatch hone par warning milegi",
        "Products ko confirm karne par hi stock update hoga",
      ];
    } else if (mode === "shelf") {
      title = "Shelf Photo Check";
      sub = "Dukan ki shelf ya rack ki photo lo visual status dekhne ke liye.";
      bulletList = [
        "AI shelf dekh kar Low / Medium / Full status bataega",
        "Approximate visual inspection — actual quantity change nahi hogi",
        "Low stock wale shelves stock view mein highlight honge",
      ];
    }

    return (
      <>
        {fileInputs}
        {modeSwitcher}

        <h1 className="font-pixel text-xl text-marigold">{title}</h1>
        <p className="mb-6 text-muted">{sub}</p>

        <button
          onClick={() => cameraRef.current?.click()}
          className="block-shadow-marigold press flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 border-2 border-dashed border-marigold bg-panel"
        >
          <span className="font-pixel text-4xl text-marigold">[ ◉ ]</span>
          <span className="font-pixel text-sm">Photo lo</span>
          <span className="text-sm text-muted">कैमरा खोलो</span>
        </button>

        <button
          onClick={() => galleryRef.current?.click()}
          className="press mt-5 w-full border-2 border-line bg-ink py-3 font-pixel text-sm text-paper"
        >
          Gallery se chuno
        </button>

        <ul className="mt-8 space-y-2 text-sm text-muted">
          {bulletList.map((b, idx) => (
            <li key={idx}>▸ {b}</li>
          ))}
        </ul>
      </>
    );
  }

  // ================= STAGE: READING =================
  if (stage.name === "reading") {
    return <ReadingLoader preview={stage.preview} lines={stage.lines} />;
  }

  // ================= STAGE: ERROR =================
  if (stage.name === "error") {
    return (
      <div className="pt-6">
        {fileInputs}
        {modeSwitcher}
        <div className="border-2 border-rose bg-rose/10 p-4">
          <p className="font-pixel text-sm text-rose">Photo padh nahi paaya</p>
          <p className="mt-2 break-words font-mono text-xs text-muted">{stage.message}</p>
        </div>
        {stage.preview && (
          <img src={stage.preview} alt="" className="mt-4 max-h-60 w-full border-2 border-line object-cover" />
        )}
        <button
          onClick={() => cameraRef.current?.click()}
          className="block-shadow-marigold press mt-5 w-full border-2 border-marigold bg-ink py-3 font-pixel text-sm text-marigold"
        >
          Dobara photo lo
        </button>
        <button
          onClick={() => setStage({ name: "pick" })}
          className="mt-3 w-full py-2 text-sm text-muted underline"
        >
          Wapas jao
        </button>
      </div>
    );
  }

  // ================= STAGE: CONFIRM KHATA (Phase 1) =================
  if (stage.name === "confirm_khata") {
    const toSave = khataRows.filter((r) => r.include);
    const canSave = toSave.length > 0 && toSave.every((r) => r.customer_name.trim() && r.amount > 0);
    const lowCount = khataRows.filter((r) => r.include && r.confidence === "low").length;

    return (
      <div className="pb-20">
        <div className="mb-4 flex items-start gap-3">
          {stage.sourceImage && (
            <button onClick={() => setZoom((z) => !z)} className={zoom ? "w-full" : "w-20 shrink-0"}>
              <img src={imageUrl(stage.sourceImage)} alt="Khata photo" className="w-full border-2 border-line" />
            </button>
          )}
          {!zoom && (
            <div>
              <h1 className="font-pixel text-lg text-marigold">Check karo (Khata)</h1>
              <p className="text-sm text-muted">
                {khataRows.length} line mili
                {lowCount > 0 && (
                  <>
                    {" · "}
                    <span className="text-warn">{lowCount} peeli</span> dhyan se dekho
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        <ul className="space-y-3">
          {khataRows.map((r) => {
            const low = r.confidence === "low";
            const invalid = r.include && (!r.customer_name.trim() || !(r.amount > 0));
            return (
              <li
                key={r.key}
                className={`border-2 p-3 ${
                  !r.include ? "border-line opacity-50" : low ? "border-warn bg-warn/10" : "border-line bg-panel"
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={r.include}
                      onChange={(e) =>
                        setKhataRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, include: e.target.checked } : x)))
                      }
                      className="size-5 accent-marigold"
                    />
                    Save
                  </label>
                  {low && <span className="bg-warn px-1.5 font-pixel text-[10px] text-ink">CHECK</span>}
                  <button
                    onClick={() => setKhataRows((rs) => rs.filter((x) => x.key !== r.key))}
                    className="ml-auto px-2 font-mono text-muted hover:text-rose"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-[1fr_7rem] gap-2">
                  <input
                    value={r.customer_name}
                    onChange={(e) =>
                      setKhataRows((rs) =>
                        rs.map((x) => (x.key === r.key ? { ...x, customer_name: e.target.value } : x)),
                      )
                    }
                    placeholder="Naam"
                    list="customer-names"
                    className={`w-full border-2 bg-ink px-2 py-2 outline-none focus:border-marigold ${
                      invalid && !r.customer_name.trim() ? "border-rose" : "border-line"
                    }`}
                  />
                  <input
                    value={r.amount || ""}
                    onChange={(e) =>
                      setKhataRows((rs) =>
                        rs.map((x) =>
                          x.key === r.key ? { ...x, amount: Number(e.target.value.replace(/[^\d.]/g, "")) } : x,
                        ),
                      )
                    }
                    inputMode="decimal"
                    placeholder="₹"
                    className={`w-full border-2 bg-ink px-2 py-2 text-right font-mono outline-none focus:border-marigold ${
                      invalid && !(r.amount > 0) ? "border-rose" : "border-line"
                    }`}
                  />
                </div>
                <datalist id="customer-names">
                  {customerNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>

                <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2 text-sm">
                  <button
                    onClick={() => setKhataRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, type: "gave" } : x)))}
                    className={`border-2 py-2 ${
                      r.type === "gave" ? "border-rose bg-rose text-ink" : "border-line text-muted"
                    }`}
                  >
                    Udhaar diya
                  </button>
                  <button
                    onClick={() => setKhataRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, type: "got" } : x)))}
                    className={`border-2 py-2 ${
                      r.type === "got" ? "border-mint bg-mint text-ink" : "border-line text-muted"
                    }`}
                  >
                    Jama mila
                  </button>
                  <input
                    type="date"
                    value={r.date ?? ""}
                    onChange={(e) =>
                      setKhataRows((rs) =>
                        rs.map((x) => (x.key === r.key ? { ...x, date: e.target.value || null } : x)),
                      )
                    }
                    className="w-36 border-2 border-line bg-ink px-2 py-2 font-mono text-xs [color-scheme:dark]"
                  />
                </div>
                {r.raw_text && <p className="mt-2 break-words font-mono text-xs text-muted">read: “{r.raw_text}”</p>}
              </li>
            );
          })}
        </ul>

        <button
          onClick={() => setKhataRows((rs) => [...rs, blankKhataRow()])}
          className="mt-3 w-full border-2 border-dashed border-line py-3 font-pixel text-xs text-muted hover:text-paper"
        >
          + Line jodo
        </button>
        <button onClick={() => setStage({ name: "pick" })} className="mt-2 w-full py-2 text-sm text-muted underline">
          Cancel
        </button>

        <div className="fixed inset-x-0 bottom-14 z-10 border-t-2 border-line bg-ink px-4 py-3">
          <button
            onClick={confirmKhata}
            disabled={!canSave || saving}
            className="press mx-auto block w-full max-w-md border-2 border-marigold bg-marigold py-3 font-pixel text-sm text-ink disabled:border-line disabled:bg-panel disabled:text-muted"
          >
            {saving ? "Save ho raha hai…" : `Confirm all (${toSave.length})`}
          </button>
        </div>
      </div>
    );
  }

  // ================= STAGE: CONFIRM SUPPLIER BILL (Phase 2A/2B/2C) =================
  if (stage.name === "confirm_bill") {
    const toSave = billItems.filter((i) => i.include);
    const calculatedSum = toSave.reduce((s, it) => s + (it.line_total || 0), 0);
    const lowCount = billItems.filter((i) => i.include && (i.confidence === "low" || i.needs_confirmation)).length;
    const canSave = toSave.length > 0 && toSave.every((it) => it.quantity > 0 && it.customName.trim());

    return (
      <div className="pb-24">
        <div className="mb-4 flex items-start gap-3">
          {stage.sourceImage && (
            <button onClick={() => setZoom((z) => !z)} className={zoom ? "w-full" : "w-20 shrink-0"}>
              <img src={imageUrl(stage.sourceImage)} alt="Bill photo" className="w-full border-2 border-line" />
            </button>
          )}
          {!zoom && (
            <div className="min-w-0 flex-1">
              <h1 className="font-pixel text-lg text-marigold">Supplier Bill Review</h1>
              <p className="text-xs text-muted">
                {billItems.length} items found
                {lowCount > 0 && (
                  <>
                    {" · "}
                    <span className="text-warn">{lowCount} need review</span>
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Bill Metadata */}
        <div className="mb-4 border-2 border-line bg-panel p-3 space-y-2">
          <div className="grid grid-cols-[1fr_8rem] gap-2">
            <div>
              <label className="block font-pixel text-[10px] text-muted">SUPPLIER NAME</label>
              <input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Wholesaler / Trader Name"
                className="mt-1 w-full border-2 border-line bg-ink px-2 py-1.5 text-sm outline-none focus:border-marigold"
              />
            </div>
            <div>
              <label className="block font-pixel text-[10px] text-muted">BILL DATE</label>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="mt-1 w-full border-2 border-line bg-ink px-2 py-1.5 font-mono text-xs [color-scheme:dark]"
              />
            </div>
          </div>
        </div>

        {/* Total Mismatch Warning */}
        {hasMismatch && (
          <div className="mb-4 border-2 border-warn bg-warn/15 p-3">
            <div className="flex items-center gap-2">
              <span className="font-pixel text-xs text-warn">⚠ TOTAL MISMATCH DETECTED</span>
            </div>
            <p className="mt-1 text-xs text-paper">{discrepancyText}</p>
            <div className="mt-2 flex gap-4 font-mono text-xs">
              <span>Stated: ₹{statedTotal}</span>
              <span>Calculated sum: ₹{calculatedSum.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Items List */}
        <ul className="space-y-3">
          {billItems.map((it) => {
            const isLow = it.confidence === "low" || it.needs_confirmation;
            return (
              <li
                key={it.key}
                className={`border-2 p-3 ${
                  !it.include ? "border-line opacity-50" : isLow ? "border-warn bg-warn/10" : "border-line bg-panel"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={it.include}
                      onChange={(e) =>
                        setBillItems((items) =>
                          items.map((x) => (x.key === it.key ? { ...x, include: e.target.checked } : x)),
                        )
                      }
                      className="size-5 accent-marigold"
                    />
                    Include in stock
                  </label>
                  {isLow && <span className="bg-warn px-1.5 font-pixel text-[10px] text-ink">CHECK</span>}
                  <button
                    onClick={() => setBillItems((items) => items.filter((x) => x.key !== it.key))}
                    className="px-2 font-mono text-muted hover:text-rose"
                  >
                    ✕
                  </button>
                </div>

                {/* Extracted name & raw text */}
                <div className="mb-2">
                  <span className="font-pixel text-[10px] text-muted">ITEM NAME ON BILL</span>
                  <input
                    value={it.item_name}
                    onChange={(e) =>
                      setBillItems((items) =>
                        items.map((x) => (x.key === it.key ? { ...x, item_name: e.target.value } : x)),
                      )
                    }
                    className="mt-0.5 w-full border-2 border-line bg-ink px-2 py-1.5 text-sm"
                  />
                  {it.raw_text && <p className="mt-1 font-mono text-[10px] text-muted">read: “{it.raw_text}”</p>}
                </div>

                {/* Product Match Selector */}
                <div className="mb-2 rounded border border-line bg-ink/70 p-2 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-pixel text-[10px] text-marigold">PRODUCT MATCH</span>
                    {it.match_score > 0 && it.selectedProductId !== "new" && (
                      <span className="font-mono text-[10px] text-mint">
                        {Math.round(it.match_score * 100)}% match
                      </span>
                    )}
                  </div>
                  <select
                    value={it.selectedProductId === "new" ? "new" : it.selectedProductId || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "new") {
                        setBillItems((items) =>
                          items.map((x) =>
                            x.key === it.key
                              ? { ...x, selectedProductId: "new", customName: x.item_name }
                              : x,
                          ),
                        );
                      } else {
                        const pid = Number(val);
                        const matchProd = existingProducts.find((p) => p.id === pid);
                        setBillItems((items) =>
                          items.map((x) =>
                            x.key === it.key
                              ? {
                                  ...x,
                                  selectedProductId: pid,
                                  customName: matchProd ? matchProd.name : x.customName,
                                  unit: matchProd ? matchProd.unit : x.unit,
                                }
                              : x,
                          ),
                        );
                      }
                    }}
                    className="w-full border border-line bg-ink p-1.5 text-paper outline-none"
                  >
                    <option value="new">+ Create as New Product</option>
                    {existingProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.unit})
                      </option>
                    ))}
                  </select>

                  {it.selectedProductId === "new" && (
                    <div className="mt-1.5">
                      <span className="font-pixel text-[9px] text-muted">DISPLAY NAME IN APP</span>
                      <input
                        value={it.customName}
                        onChange={(e) =>
                          setBillItems((items) =>
                            items.map((x) => (x.key === it.key ? { ...x, customName: e.target.value } : x)),
                          )
                        }
                        placeholder="Product Name"
                        className="mt-0.5 w-full border border-line bg-ink px-2 py-1 text-xs"
                      />
                    </div>
                  )}
                </div>

                {/* Quantity, Unit, Rate, Line Total */}
                <div className="grid grid-cols-4 gap-1.5">
                  <div>
                    <label className="block font-pixel text-[9px] text-muted">QTY</label>
                    <input
                      value={it.quantity || ""}
                      onChange={(e) => {
                        const q = Number(e.target.value.replace(/[^\d.]/g, "")) || 0;
                        const line = it.rate ? Math.round(q * it.rate * 100) / 100 : it.line_total;
                        setBillItems((items) =>
                          items.map((x) => (x.key === it.key ? { ...x, quantity: q, line_total: line } : x)),
                        );
                      }}
                      inputMode="decimal"
                      className="w-full border-2 border-line bg-ink p-1.5 text-center font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-pixel text-[9px] text-muted">UNIT</label>
                    <input
                      value={it.unit}
                      onChange={(e) =>
                        setBillItems((items) =>
                          items.map((x) => (x.key === it.key ? { ...x, unit: e.target.value } : x)),
                        )
                      }
                      placeholder="kg/pcs"
                      className="w-full border-2 border-line bg-ink p-1.5 text-center font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-pixel text-[9px] text-muted">RATE (₹)</label>
                    <input
                      value={it.rate !== null && it.rate !== undefined ? it.rate : ""}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d.]/g, "");
                        const r = raw ? Number(raw) : null;
                        const line = r !== null ? Math.round(it.quantity * r * 100) / 100 : it.line_total;
                        setBillItems((items) =>
                          items.map((x) => (x.key === it.key ? { ...x, rate: r, line_total: line } : x)),
                        );
                      }}
                      inputMode="decimal"
                      className="w-full border-2 border-line bg-ink p-1.5 text-right font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block font-pixel text-[9px] text-muted">TOTAL (₹)</label>
                    <input
                      value={it.line_total || ""}
                      onChange={(e) => {
                        const tot = Number(e.target.value.replace(/[^\d.]/g, "")) || 0;
                        setBillItems((items) =>
                          items.map((x) => (x.key === it.key ? { ...x, line_total: tot } : x)),
                        );
                      }}
                      inputMode="decimal"
                      className="w-full border-2 border-line bg-ink p-1.5 text-right font-mono text-sm"
                    />
                  </div>
                </div>

                {it.line_mismatch && (
                  <p className="mt-1 font-mono text-[10px] text-warn">
                    ⚠ Rate × Qty doesn't match line total
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <button
          onClick={() => setBillItems((items) => [...items, blankBillItem()])}
          className="mt-3 w-full border-2 border-dashed border-line py-3 font-pixel text-xs text-muted hover:text-paper"
        >
          + Item Jodo
        </button>

        <button
          onClick={() => setStage({ name: "pick" })}
          className="mt-2 w-full py-2 text-sm text-muted underline"
        >
          Cancel
        </button>

        {/* Bottom confirmation bar */}
        <div className="fixed inset-x-0 bottom-14 z-10 border-t-2 border-line bg-ink px-4 py-3">
          <button
            onClick={confirmBill}
            disabled={!canSave || saving}
            className="press mx-auto block w-full max-w-md border-2 border-marigold bg-marigold py-3 font-pixel text-sm text-ink disabled:border-line disabled:bg-panel disabled:text-muted"
          >
            {saving ? "Stock Update Ho Raha Hai…" : `Confirm Bill & Update Stock (${toSave.length})`}
          </button>
        </div>
      </div>
    );
  }

  // ================= STAGE: CONFIRM SHELF (Phase 2D) =================
  if (stage.name === "confirm_shelf") {
    return (
      <div className="pb-24">
        <div className="mb-4 flex items-start gap-3">
          {stage.sourceImage && (
            <button onClick={() => setZoom((z) => !z)} className={zoom ? "w-full" : "w-20 shrink-0"}>
              <img src={imageUrl(stage.sourceImage)} alt="Shelf photo" className="w-full border-2 border-line" />
            </button>
          )}
          {!zoom && (
            <div>
              <h1 className="font-pixel text-lg text-marigold">Shelf Assessment</h1>
              <p className="text-xs text-muted">{shelfItems.length} products observed</p>
            </div>
          )}
        </div>

        <div className="mb-4 border-2 border-line bg-panel p-3 text-xs text-muted">
          <p className="font-pixel text-[10px] text-paper">APPROXIMATE VISUAL CHECK</p>
          <p className="mt-1">
            Visual status indicates shelf fullness (Low / Medium / Full) and does NOT modify exact counted stock quantity.
          </p>
        </div>

        <ul className="space-y-3">
          {shelfItems.map((it) => (
            <li key={it.key} className="border-2 border-line bg-panel p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-paper">{it.product_name}</span>
                <button
                  onClick={() => setShelfItems((items) => items.filter((x) => x.key !== it.key))}
                  className="font-mono text-muted hover:text-rose"
                >
                  ✕
                </button>
              </div>

              {/* Match product */}
              <div className="mb-3">
                <label className="block font-pixel text-[9px] text-muted">LINK TO PRODUCT</label>
                <select
                  value={it.selectedProductId === "new" ? "new" : it.selectedProductId || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "new") {
                      setShelfItems((items) =>
                        items.map((x) =>
                          x.key === it.key ? { ...x, selectedProductId: "new", customName: x.product_name } : x,
                        ),
                      );
                    } else {
                      const pid = Number(val);
                      const matchProd = existingProducts.find((p) => p.id === pid);
                      setShelfItems((items) =>
                        items.map((x) =>
                          x.key === it.key
                            ? { ...x, selectedProductId: pid, customName: matchProd ? matchProd.name : x.customName }
                            : x,
                        ),
                      );
                    }
                  }}
                  className="mt-0.5 w-full border border-line bg-ink p-1.5 text-xs text-paper"
                >
                  <option value="new">+ Create as New Product</option>
                  {existingProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status buttons */}
              <div className="mb-2">
                <label className="block font-pixel text-[9px] text-muted mb-1">SHELF STATUS</label>
                <div className="grid grid-cols-3 gap-1.5 text-xs font-pixel">
                  {(["low", "medium", "full"] as ShelfStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() =>
                        setShelfItems((items) =>
                          items.map((x) => (x.key === it.key ? { ...x, stock_status: st } : x)),
                        )
                      }
                      className={`border-2 py-1.5 uppercase ${
                        it.stock_status === st
                          ? st === "low"
                            ? "border-warn bg-warn text-ink font-bold"
                            : st === "medium"
                              ? "border-sky bg-sky text-ink font-bold"
                              : "border-mint bg-mint text-ink font-bold"
                          : "border-line text-muted"
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Visual Evidence */}
              <div>
                <label className="block font-pixel text-[9px] text-muted">VISUAL EVIDENCE</label>
                <input
                  value={it.visual_evidence}
                  onChange={(e) =>
                    setShelfItems((items) =>
                      items.map((x) => (x.key === it.key ? { ...x, visual_evidence: e.target.value } : x)),
                    )
                  }
                  className="mt-0.5 w-full border border-line bg-ink p-1.5 text-xs"
                />
              </div>

              {it.uncertainty && (
                <p className="mt-1.5 font-mono text-[10px] text-muted">
                  Note: {it.uncertainty}
                </p>
              )}
            </li>
          ))}
        </ul>

        {shelfItems.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">Koi product pehchaan nahi paaya.</p>
        )}

        <button
          onClick={() => setStage({ name: "pick" })}
          className="mt-4 w-full py-2 text-sm text-muted underline"
        >
          Cancel
        </button>

        <div className="fixed inset-x-0 bottom-14 z-10 border-t-2 border-line bg-ink px-4 py-3">
          <button
            onClick={confirmShelf}
            disabled={shelfItems.length === 0 || saving}
            className="press mx-auto block w-full max-w-md border-2 border-marigold bg-marigold py-3 font-pixel text-sm text-ink disabled:border-line disabled:bg-panel disabled:text-muted"
          >
            {saving ? "Save ho raha hai…" : `Confirm Shelf Status (${shelfItems.length})`}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
