import { useEffect, useState } from "react";
import { apiGet, imageUrl, type ProductStockHistory, type ProductStockItem } from "../lib/api";
import { formatDate, formatRupees } from "../lib/format";

function shelfBadge(status: string | null) {
  if (!status) return null;
  switch (status.toLowerCase()) {
    case "low":
      return (
        <span className="border border-warn bg-warn/15 px-1.5 py-0.5 font-pixel text-[10px] text-warn">
          SHELF: LOW
        </span>
      );
    case "medium":
      return (
        <span className="border border-sky bg-sky/15 px-1.5 py-0.5 font-pixel text-[10px] text-sky">
          SHELF: MED
        </span>
      );
    case "full":
      return (
        <span className="border border-mint bg-mint/15 px-1.5 py-0.5 font-pixel text-[10px] text-mint">
          SHELF: FULL
        </span>
      );
    default:
      return null;
  }
}

function ProductDetail({
  productId,
  onBack,
}: {
  productId: number;
  onBack: () => void;
}) {
  const [data, setData] = useState<ProductStockHistory | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<ProductStockHistory>(`/api/stock/products/${productId}/history`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [productId]);

  return (
    <div className="pb-16">
      <button onClick={onBack} className="mb-4 font-pixel text-xs text-muted hover:text-paper">
        &lt; Sab products
      </button>

      {error && <p className="font-mono text-sm text-rose">{error}</p>}
      {!data && !error && <p className="font-pixel text-sm text-muted">Loading history…</p>}

      {data && (
        <>
          <div className="block-shadow mb-5 border-2 border-line bg-panel p-4">
            <h1 className="text-xl font-bold text-paper">{data.product.name}</h1>
            <p className="font-pixel text-xs text-muted">Unit: {data.product.unit}</p>
          </div>

          <h2 className="mb-3 font-pixel text-xs uppercase tracking-wider text-muted">
            Stock History &amp; Timeline
          </h2>

          <ul className="space-y-3">
            {data.history.map((e) => (
              <li key={e.id} className="border-2 border-line bg-panel p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono text-xs text-muted">{formatDate(e.created_at)}</span>
                    <span className="ml-2 font-pixel text-xs uppercase text-paper">
                      {e.kind === "purchase" ? "Supplier Bill" : e.kind === "shelf_check" ? "Shelf Check" : e.kind}
                    </span>
                  </div>
                  {e.kind === "purchase" && (
                    <span className="font-mono text-sm font-bold text-mint">
                      +{e.qty_change} {data.product.unit}
                    </span>
                  )}
                  {e.kind === "shelf_check" && shelfBadge(e.shelf_status)}
                </div>

                {e.rate && (
                  <p className="mt-1 font-mono text-xs text-muted">
                    Rate: {formatRupees(e.rate)} / {data.product.unit}
                  </p>
                )}

                {e.raw_text && (
                  <p className="mt-1 break-words font-mono text-xs text-paper/80">
                    "{e.raw_text}"
                  </p>
                )}

                {e.source_image && (
                  <div className="mt-2">
                    <a
                      href={imageUrl(e.source_image)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] text-sky underline"
                    >
                      [View source photo]
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {data.history.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">Koi stock history nahi mili.</p>
          )}
        </>
      )}
    </div>
  );
}

export default function Stock({ onScanBill }: { onScanBill?: () => void }) {
  const [products, setProducts] = useState<ProductStockItem[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (selectedId !== null) return;
    apiGet<{ products: ProductStockItem[] }>("/api/stock/products")
      .then((d) => setProducts(d.products))
      .catch((e) => setError(e.message));
  }, [selectedId]);

  if (selectedId !== null) {
    return <ProductDetail productId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );

  const lowShelfCount = products.filter(
    (p) => p.shelf_status?.toLowerCase() === "low",
  ).length;

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-pixel text-xl text-marigold">Stock &amp; Shelf</h1>
          <p className="text-xs text-muted">Supplier bills &amp; visual shelf checks</p>
        </div>
        {onScanBill && (
          <button
            onClick={onScanBill}
            className="border-2 border-marigold bg-marigold px-2.5 py-1.5 font-pixel text-xs text-ink"
          >
            + Scan
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="border-2 border-line bg-panel p-3">
          <p className="font-pixel text-[10px] text-muted">TOTAL PRODUCTS</p>
          <p className="font-mono text-2xl font-bold text-paper">{products.length}</p>
        </div>
        <div className={`border-2 p-3 ${lowShelfCount > 0 ? "border-warn bg-warn/10" : "border-line bg-panel"}`}>
          <p className="font-pixel text-[10px] text-muted">SHELF ALERTS</p>
          <p className={`font-mono text-2xl font-bold ${lowShelfCount > 0 ? "text-warn" : "text-paper"}`}>
            {lowShelfCount} {lowShelfCount > 0 ? "LOW" : "OK"}
          </p>
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Product dhoondo…"
        className="mb-4 w-full border-2 border-line bg-ink px-3 py-2 outline-none focus:border-marigold"
      />

      {error && <p className="mb-4 font-mono text-sm text-rose">{error}</p>}

      <ul className="space-y-2.5">
        {filtered.map((p) => {
          const isLow = p.shelf_status?.toLowerCase() === "low";
          return (
            <li key={p.id}>
              <button
                onClick={() => setSelectedId(p.id)}
                className={`press flex w-full flex-col border-2 p-3 text-left transition-colors ${
                  isLow
                    ? "border-warn bg-warn/5 hover:border-warn"
                    : "border-line bg-panel hover:border-marigold"
                }`}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="block font-semibold text-paper truncate">{p.name}</span>
                    <span className="font-mono text-xs text-muted">
                      Last update: {formatDate(p.last_updated_at)} ({p.last_source === "bill" ? "Bill" : p.last_source === "shelf_assessment" ? "Shelf" : "Manual"})
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-lg font-bold text-marigold">
                      {p.current_stock}
                    </span>
                    <span className="ml-1 font-pixel text-[10px] text-muted">{p.unit}</span>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-xs">
                  <div>
                    {p.last_purchase_qty !== null ? (
                      <span className="font-mono text-muted">
                        Latest bill: <span className="text-mint">+{p.last_purchase_qty}</span>
                        {p.last_purchase_rate && ` @ ₹${p.last_purchase_rate}`}
                      </span>
                    ) : (
                      <span className="font-mono text-muted">No bill record</span>
                    )}
                  </div>
                  <div>{shelfBadge(p.shelf_status)}</div>
                </div>

                {isLow && p.shelf_evidence && (
                  <p className="mt-1.5 font-mono text-[11px] text-warn">
                    ⚠ {p.shelf_evidence}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {products.length === 0 && !error && (
        <div className="border-2 border-dashed border-line p-8 text-center">
          <p className="font-pixel text-sm text-muted">Abhi koi stock record nahi hai.</p>
          <p className="mt-2 text-sm text-muted">
            Supplier bill scan karo ya shelf photo lo taaki stock dikhe.
          </p>
          {onScanBill && (
            <button
              onClick={onScanBill}
              className="mt-4 border-2 border-marigold bg-marigold px-4 py-2 font-pixel text-xs text-ink"
            >
              Scan karo
            </button>
          )}
        </div>
      )}
    </>
  );
}
