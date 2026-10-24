/**
 * The salon's parked carts, opened from the till toolbar.
 *
 * A hold belongs to the **salon**, not to the till that parked it (ADR 0015), so this is
 * a shared workbench rather than one cashier's scratch pad: a colleague has to be able to
 * pick up the cart somebody else left, and this card is the only place a hold can be
 * opened or abandoned. Its toolbar action remains visible beside the staff controls.
 *
 * A row carries enough to recognise a cart — who it is for, who parked it, when, how many
 * lines and what it came to — and **no lines**. The lines arrive when the cart is opened
 * (`useResumeHold`), so fifty holds are not fifty carts' worth of rows in one response.
 */
import { Clock, Trash } from "@/components/icons";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SaleListPagination from "@/components/sale/SaleListPagination";
import EmptyState from "@/components/ui/EmptyState";
import type { SaleSummary } from "@glampro_suite/shared";

import { priceToCents } from "@/lib/money";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

export interface HeldCartsPanelProps {
  holds: SaleSummary[];
  isPending: boolean;
  isError: boolean;
  /** The cart currently open in the till, so its row says so rather than offering it twice. */
  activeId: string | null;
  /** The hold whose pickup or discard is in flight; that row's buttons wait on it. */
  busyId: string | null;
  /** The till may look but not write (suspended salon). */
  disabled: boolean;
  onPickUp: (id: string) => void;
  onDiscard: (id: string) => void;
  onRetry: () => void;
  page: number;
  hasMore: boolean;
  isFetching: boolean;
  onPageChange: (page: number) => void;
}

export default function HeldCartsPanel({
  holds,
  isPending,
  isError,
  activeId,
  busyId,
  disabled,
  onPickUp,
  onDiscard,
  onRetry,
  page,
  hasMore,
  isFetching,
  onPageChange,
}: HeldCartsPanelProps) {
  const { formatDateTime, formatPrice } = useSalonFormatting();
  return (
    <Card
      title="Held carts"
      description={
        holds.length === 0
          ? "Carts parked for later."
          : `${holds.length} ${holds.length === 1 ? "cart" : "carts"} waiting.`
      }
    >
      {isPending ? (
        <p className="px-1 py-3 text-sm text-ink-muted" aria-busy>
          Reading the salon's held carts…
        </p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-2 px-1 py-3">
          <p className="text-sm text-danger">The held carts could not be read.</p>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : holds.length === 0 ? (
        <EmptyState
          title="Nothing is parked"
          description="Hold a cart and it waits here for anyone at the counter."
          icon={<Clock />}
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {holds.map((hold) => {
            const busy = busyId === hold.id;
            const inCart = activeId === hold.id;

            return (
              <li key={hold.id} className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">
                      {hold.customerName ?? "Walk-in"}
                    </p>
                    <p className="truncate text-xs text-ink-muted">
                      {hold.totalQuantity} {hold.totalQuantity === 1 ? "item" : "items"} ·{" "}
                      {formatPrice(priceToCents(hold.totalAmount) / 100)} ·{" "}
                      {formatDateTime(hold.soldAt)}
                    </p>
                    <p className="truncate text-xs text-ink-muted">
                      Held by {hold.staffName ?? "the till"}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled || busy || inCart}
                      loading={busy && !inCart}
                      onClick={() => onPickUp(hold.id)}
                    >
                      {inCart ? "In the cart" : "Pick up"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={disabled || busy}
                      onClick={() => onDiscard(hold.id)}
                      aria-label={`Discard the cart held by ${hold.staffName ?? "the till"}`}
                    >
                      <Trash aria-hidden />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <SaleListPagination
        page={page}
        hasMore={hasMore}
        disabled={isFetching || isError || busyId !== null}
        onPageChange={onPageChange}
      />
    </Card>
  );
}
