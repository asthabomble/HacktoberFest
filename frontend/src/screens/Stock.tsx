import { useEffect, useState } from "react";
import { ChevronRight, ImageIcon, Receipt, ScanLine } from "lucide-react";
import { Card, Chip, OutlineButton, PrimaryButton, Skeleton, SkeletonRows, SubHeader } from "../components/ui";
import { apiGet, imageUrl, type ProductStockHistory, type ProductStockItem, type ShelfStatus } from "../lib/api";
import { formatDate, formatRupees } from "../lib/format";
import { useLang, type TKey } from "../lib/i18n";

const SHELF_LABEL: Record<ShelfStatus, TKey> = { low: "Low", medium: "Medium", full: "Full" };

export function ShelfChip({ status }: { status: ShelfStatus | null }) {
  const { t } = useLang();
  if (!status) return null;
  const tone = status === "low" ? "red" : status === "medium" ? "yellow" : "gray";
  return <Chip tone={tone}>{t("Shelf:")} {t(SHELF_LABEL[status])}</Chip>;
}

/** Stock tab on Home: products with counted stock (from bills) and latest shelf status. */
export function StockList({
  onOpen,
  onScanBill,
  onScanShelf,
}: {
  onOpen: (id: number) => void;
  onScanBill: () => void;
  onScanShelf: () => void;
}) {
  const { t } = useLang();
  const [products, setProducts] = useState<ProductStockItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<{ products: ProductStockItem[] }>("/api/stock/products")
      .then((d) => setProducts(d.products))
      .catch((e) => setError(e.message));
  }, []);

  const lowCount = (products ?? []).filter((p) => p.is_low).length;

  return (
    <>
      {error && <p className="text-sm text-danger">{error}</p>}

      <Card className="grid grid-cols-2">
        <div className="border-r border-line p-4">
          <p className="text-sm text-muted">{t("Products")}</p>
          <p className="mt-1 font-mono text-2xl font-semibold">{products ? products.length : <Skeleton className="h-7 w-12" />}</p>
        </div>
        <div className="p-4">
          <p className="text-sm text-muted">{t("Low stock items")}</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-brand">{products ? lowCount : <Skeleton className="h-7 w-12" />}</p>
        </div>
      </Card>

      <Card>
        {!products && !error ? (
          <SkeletonRows rows={5} />
        ) : products && products.length > 0 ? (
          <table className="w-full table-fixed text-left">
            <thead>
              <tr className="border-b border-line bg-soft text-xs font-medium uppercase tracking-wider text-muted">
                <th className="py-2.5 pl-4 font-medium">{t("Product")}</th>
                <th className="w-24 py-2.5 text-right font-medium">{t("Stock")}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} onClick={() => onOpen(p.id)} className="cursor-pointer border-b border-line last:border-b-0 active:bg-soft">
                  <td className="py-3 pl-4">
                    <p className="truncate text-[15px]">{p.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <ShelfChip status={p.shelf_status} />
                      {p.is_low && !p.shelf_status && <Chip tone="red">{t("Low")}</Chip>}
                    </div>
                  </td>
                  <td className={`py-3 text-right align-top font-mono text-[15px] ${p.is_low ? "text-danger" : ""}`}>
                    {p.current_stock} <span className="text-xs text-muted">{p.unit}</span>
                  </td>
                  <td className="py-3 pr-3 text-right align-top text-muted">
                    <ChevronRight size={20} className="ml-auto" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-muted">
            {t("Abhi koi stock record nahi. Supplier bill scan karein ya shelf ki photo lein.")}
          </p>
        )}
      </Card>

      <div className="flex gap-3">
        <OutlineButton icon={ScanLine} onClick={onScanShelf} className="w-36 shrink-0">
          {t("Shelf")}
        </OutlineButton>
        <PrimaryButton icon={Receipt} onClick={onScanBill} className="flex-1">
          {t("Scan supplier bill")}
        </PrimaryButton>
      </div>
    </>
  );
}

/** Product screen: stock history from bills and shelf checks. */
export default function ProductDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { t } = useLang();
  const [data, setData] = useState<ProductStockHistory | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<ProductStockHistory>(`/api/stock/products/${id}/history`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  const current = data?.history.reduce((sum, e) => sum + e.qty_change, 0) ?? 0;
  const lastPurchase = data?.history.find((e) => e.kind === "purchase");
  const lastShelf = data?.history.find((e) => e.kind === "shelf_check");

  return (
    <>
      <SubHeader title={t("Product")} onBack={onBack} />
      {error && <p className="p-4 text-sm text-danger">{error}</p>}
      {!data && !error && (
        <div className="mx-auto max-w-md space-y-4 px-4 py-4" aria-busy="true">
          <Skeleton className="h-6 w-48" />
          <Card>
            <SkeletonRows rows={4} />
          </Card>
        </div>
      )}

      {data && (
        <>
          <div className="border-b border-line bg-white">
            <div className="mx-auto max-w-md px-4 py-4">
              <h2 className="text-xl font-semibold">{data.product.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>{t("Unit:")} {data.product.unit}</span>
                <ShelfChip status={lastShelf?.shelf_status ?? null} />
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-md space-y-4 px-4 py-4">
            <Card className="flex items-end justify-between p-4">
              <div>
                <p className="text-sm text-muted">{t("Current stock")}</p>
                <p className="font-mono text-[30px] font-semibold leading-tight">
                  {current} <span className="text-base text-muted">{data.product.unit}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted">{t("Last purchase")}</p>
                <p className="text-sm font-medium">
                  {lastPurchase
                    ? `+${lastPurchase.qty_change}${lastPurchase.rate ? ` @ ${formatRupees(lastPurchase.rate)}` : ""} · ${formatDate(lastPurchase.created_at)}`
                    : "—"}
                </p>
              </div>
            </Card>

            <Card>
              <table className="w-full table-fixed text-left">
                <thead>
                  <tr className="border-b border-line bg-soft text-xs font-medium uppercase tracking-wider text-muted">
                    <th className="w-[5.25rem] py-2.5 pl-4 font-medium">{t("Date")}</th>
                    <th className="py-2.5 font-medium">{t("Event")}</th>
                    <th className="w-24 py-2.5 pr-4 text-right font-medium">{t("Qty")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((e) => (
                    <tr key={e.id} className="border-b border-line last:border-b-0">
                      <td className="py-3 pl-4 align-top text-muted">{formatDate(e.created_at)}</td>
                      <td className="break-words py-3 pr-2 align-top">
                        <p>
                          {e.kind === "purchase" ? t("Supplier bill") : e.kind === "shelf_check" ? t("Shelf check") : e.kind}
                          {e.source_image && (
                            <a
                              href={imageUrl(e.source_image)}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-2 inline-flex items-center gap-0.5 text-sm text-brand"
                            >
                              <ImageIcon size={14} /> {t("Photo")}
                            </a>
                          )}
                        </p>
                        {e.raw_text && <p className="font-mono text-xs text-muted">{e.raw_text}</p>}
                        {e.rate != null && <p className="text-xs text-muted">{t("Rate")} {formatRupees(e.rate)}</p>}
                      </td>
                      <td className="py-3 pr-4 text-right align-top font-mono">
                        {e.kind === "shelf_check" ? (
                          <ShelfChip status={e.shelf_status} />
                        ) : (
                          `${e.qty_change > 0 ? "+" : ""}${e.qty_change}`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.history.length === 0 && <p className="py-8 text-center text-muted">{t("Koi stock history nahi.")}</p>}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
