import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiUpload, imageUrl, type CustomerList, type ExtractResponse, type KhataRow } from "../lib/api";
import { shrinkImage } from "../lib/image";
import { today } from "../lib/format";

type EditRow = KhataRow & { key: number; include: boolean };

type Stage =
  | { name: "pick" }
  | { name: "reading"; preview: string }
  | { name: "confirm"; sourceImage: string }
  | { name: "error"; message: string; preview?: string };

const READING_LINES = ["Khata padh raha hoon…", "Naam pehchaan raha hoon…", "Hisaab jod raha hoon…"];

let nextKey = 1;
const blankRow = (): EditRow => ({
  key: nextKey++,
  customer_name: "",
  amount: 0,
  type: "gave",
  date: today(),
  raw_text: "",
  confidence: "high",
  include: true,
});

const rowValid = (r: EditRow) => r.customer_name.trim() !== "" && r.amount > 0;

function ReadingLoader({ preview }: { preview: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % READING_LINES.length), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center gap-6 pt-6">
      <div className="relative w-full overflow-hidden border-2 border-line">
        <img src={preview} alt="" className="max-h-80 w-full object-cover opacity-60" />
        {/* scan line */}
        <div className="absolute inset-x-0 h-1 animate-[scan_1.6s_ease-in-out_infinite_alternate] bg-mint shadow-[0_0_16px_var(--color-mint)]" />
      </div>
      <p className="font-pixel text-sm text-mint">{READING_LINES[i]}</p>
      <p className="text-center text-sm text-muted">Handwriting padhne mein 10–30 second lag sakte hain.</p>
    </div>
  );
}

function RowCard({
  row,
  names,
  onChange,
  onRemove,
}: {
  row: EditRow;
  names: string[];
  onChange: (patch: Partial<EditRow>) => void;
  onRemove: () => void;
}) {
  const low = row.confidence === "low";
  const invalid = row.include && !rowValid(row);
  const frame = !row.include
    ? "border-line opacity-50"
    : low
      ? "border-warn bg-warn/10"
      : "border-line bg-panel";
  const field = "w-full border-2 bg-ink px-2 py-2 outline-none focus:border-marigold";

  return (
    <li className={`border-2 p-3 ${frame}`}>
      <div className="mb-2 flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={row.include}
            onChange={(e) => onChange({ include: e.target.checked })}
            className="size-5 accent-marigold"
          />
          Save
        </label>
        {low && <span className="bg-warn px-1.5 font-pixel text-[10px] text-ink">CHECK</span>}
        <button onClick={onRemove} className="ml-auto px-2 font-mono text-muted hover:text-rose" aria-label="Remove row">
          ✕
        </button>
      </div>

      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <input
          value={row.customer_name}
          onChange={(e) => onChange({ customer_name: e.target.value })}
          placeholder="Naam"
          list="customer-names"
          className={`${field} ${invalid && !row.customer_name.trim() ? "border-rose" : "border-line"}`}
        />
        <input
          value={row.amount || ""}
          onChange={(e) => onChange({ amount: Number(e.target.value.replace(/[^\d.]/g, "")) })}
          inputMode="decimal"
          placeholder="₹"
          className={`${field} text-right font-mono ${invalid && !(row.amount > 0) ? "border-rose" : "border-line"}`}
        />
      </div>
      <datalist id="customer-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2 text-sm">
        <button
          onClick={() => onChange({ type: "gave" })}
          className={`border-2 py-2 ${row.type === "gave" ? "border-rose bg-rose text-ink" : "border-line text-muted"}`}
        >
          Udhaar diya
        </button>
        <button
          onClick={() => onChange({ type: "got" })}
          className={`border-2 py-2 ${row.type === "got" ? "border-mint bg-mint text-ink" : "border-line text-muted"}`}
        >
          Jama mila
        </button>
        <input
          type="date"
          value={row.date ?? ""}
          onChange={(e) => onChange({ date: e.target.value || null })}
          className={`${field} w-36 border-line font-mono text-xs [color-scheme:dark]`}
        />
      </div>

      {row.raw_text && <p className="mt-2 break-words font-mono text-xs text-muted">read: “{row.raw_text}”</p>}
    </li>
  );
}

export default function Scan({ onSaved }: { onSaved: () => void }) {
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [rows, setRows] = useState<EditRow[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiGet<CustomerList>("/api/customers")
      .then((d) => setNames(d.customers.map((c) => c.name)))
      .catch(() => {});
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setStage({ name: "reading", preview });
    try {
      const blob = await shrinkImage(file);
      const res = await apiUpload<ExtractResponse>("/api/khata/extract", blob, "khata.jpg");
      const extracted = res.rows.map((r) => ({ ...r, date: r.date ?? today(), key: nextKey++, include: true }));
      setRows(extracted.length ? extracted : [blankRow()]);
      setStage({ name: "confirm", sourceImage: res.source_image });
    } catch (e) {
      setStage({ name: "error", message: (e as Error).message, preview });
    }
  }

  function update(key: number, patch: Partial<EditRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const toSave = rows.filter((r) => r.include);
  const canSave = toSave.length > 0 && toSave.every(rowValid);
  const lowCount = rows.filter((r) => r.include && r.confidence === "low").length;

  async function confirmAll() {
    if (stage.name !== "confirm") return;
    setSaving(true);
    try {
      await apiPost("/api/khata/confirm", {
        source_image: stage.sourceImage || null,
        rows: toSave.map(({ key, include, ...r }) => r),
      });
      setRows([]);
      setStage({ name: "pick" });
      onSaved();
    } catch (e) {
      alert(`Save nahi hua: ${(e as Error).message}`);
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

  if (stage.name === "pick") {
    return (
      <>
        {fileInputs}
        <h1 className="font-pixel text-xl text-marigold">Scan khata</h1>
        <p className="mb-6 text-muted">Poora panna frame mein rakho, roshni achhi ho.</p>
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
          <li>▸ Hindi, Marathi, English sab chalega</li>
          <li>▸ Save karne se pehle aap har line check kar sakte ho</li>
          <li>▸ <span className="text-warn">Peeli</span> lines dhyan se dekhna</li>
        </ul>
      </>
    );
  }

  if (stage.name === "reading") return <ReadingLoader preview={stage.preview} />;

  if (stage.name === "error") {
    return (
      <div className="pt-6">
        {fileInputs}
        <div className="border-2 border-rose bg-rose/10 p-4">
          <p className="font-pixel text-sm text-rose">Padh nahi paaya</p>
          <p className="mt-2 break-words font-mono text-xs text-muted">{stage.message}</p>
        </div>
        {stage.preview && <img src={stage.preview} alt="" className="mt-4 max-h-60 w-full border-2 border-line object-cover" />}
        <button
          onClick={() => cameraRef.current?.click()}
          className="block-shadow-marigold press mt-5 w-full border-2 border-marigold bg-ink py-3 font-pixel text-sm text-marigold"
        >
          Dobara photo lo
        </button>
        <button
          onClick={() => {
            setRows([blankRow()]);
            setStage({ name: "confirm", sourceImage: "" });
          }}
          className="mt-3 w-full py-2 text-sm text-muted underline"
        >
          Haath se entry karo
        </button>
      </div>
    );
  }

  // confirm
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
            <h1 className="font-pixel text-lg text-marigold">Check karo</h1>
            <p className="text-sm text-muted">
              {rows.length} line mili
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
        {rows.map((r) => (
          <RowCard
            key={r.key}
            row={r}
            names={names}
            onChange={(patch) => update(r.key, patch)}
            onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
          />
        ))}
      </ul>

      <button
        onClick={() => setRows((rs) => [...rs, blankRow()])}
        className="mt-3 w-full border-2 border-dashed border-line py-3 font-pixel text-xs text-muted hover:text-paper"
      >
        + Line jodo
      </button>
      <button
        onClick={() => {
          setRows([]);
          setStage({ name: "pick" });
        }}
        className="mt-2 w-full py-2 text-sm text-muted underline"
      >
        Cancel
      </button>

      <div className="fixed inset-x-0 bottom-14 z-10 border-t-2 border-line bg-ink px-4 py-3">
        <button
          onClick={confirmAll}
          disabled={!canSave || saving}
          className="press mx-auto block w-full max-w-md border-2 border-marigold bg-marigold py-3 font-pixel text-sm text-ink disabled:border-line disabled:bg-panel disabled:text-muted"
        >
          {saving ? "Save ho raha hai…" : `Confirm all (${toSave.length})`}
        </button>
      </div>
    </div>
  );
}
