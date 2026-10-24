import { useState } from "react";
import type { SaleDetail } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import SaleListPagination from "@/components/sale/SaleListPagination";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useOpenSaleReceipt, useSaleHistory } from "@/hooks/useSale";
import { getErrorMessage } from "@/lib/api";

export default function SaleHistoryPanel({
  onOpen,
  disabled = false,
}: {
  onOpen: (sale: SaleDetail) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"COMPLETED" | "VOID">("COMPLETED");
  const [page, setPage] = useState(1);
  const history = useSaleHistory(status, page, open);
  const receipt = useOpenSaleReceipt();
  const { formatDateTime, formatPrice } = useSalonFormatting();

  async function openReceipt(id: string) {
    if (disabled) return;
    try {
      const sale = await receipt.mutateAsync(id);
      setOpen(false);
      onOpen(sale);
    } catch {
      // The mutation error is displayed beside the list; the active cart is untouched.
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        disabled={disabled || receipt.isPending}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        Browse sale history
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Sale history"
        description="Open a stored receipt without changing your current cart."
      >
        <section aria-label="Sale history results" className="flex flex-col gap-3">
          <label className="text-sm">
            Sale status
            <select
              className="ml-2 rounded-md border border-line bg-surface px-2 py-1"
              value={status}
              disabled={disabled || receipt.isPending}
              onChange={(event) => {
                setStatus(event.target.value as "COMPLETED" | "VOID");
                setPage(1);
                receipt.reset();
              }}
            >
              <option value="COMPLETED">Completed</option>
              <option value="VOID">Voided</option>
            </select>
          </label>
          {history.isPending ? (
            <p aria-busy="true">Reading sale history…</p>
          ) : history.isError ? (
            <div role="alert">
              <p>Sale history could not be read.</p>
              <Button variant="secondary" onClick={() => void history.refetch()}>
                Try again
              </Button>
            </div>
          ) : history.data?.items.length === 0 ? (
            <p>No sales on this page.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.data?.items.map((sale) => (
                <li
                  key={sale.id}
                  className="flex items-center justify-between gap-3 border-b border-line py-2"
                >
                  <div>
                    <p>
                      Receipt #{sale.receiptNumber} · {sale.customerName ?? "Walk-in"}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {formatDateTime(sale.soldAt)} · {formatPrice(sale.totalAmount)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled || receipt.isPending}
                    onClick={() => void openReceipt(sale.id)}
                    aria-label={`Open receipt #${sale.receiptNumber}`}
                  >
                    Open receipt
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {receipt.isError ? (
            <p role="alert" className="text-danger">
              {getErrorMessage(receipt.error)}
            </p>
          ) : null}
          <SaleListPagination
            page={page}
            hasMore={history.data?.hasMore ?? false}
            disabled={history.isFetching || history.isError || receipt.isPending}
            onPageChange={setPage}
          />
        </section>
      </Drawer>
    </>
  );
}
