/**
 * The cart panel — the right column of handoff screen 01, visible at all times.
 *
 * A `Card` with one line per `CartLine` component, the sale totals in its body and the
 * take-payment and hold buttons in its footer. The totals are cents-exact
 * (`lib/money.ts`) and re-derived from the customer on every render, because a
 * customer attached after the search must re-price the cart without searching
 * again — the same reason the search returns both prices.
 *
 * The totals are _estimates until the receipt_: the server re-prices from the
 * catalogue at post time, so the panel totals for display and posts none of
 * it (the schema's "no price" rule).
 */
import { useState } from "react";
import { Cart } from "@/components/icons";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import CartLine, { type StaffOption } from "@/components/sale/CartLine";
import { lineUnitPrice, listUnitPrice, type CartLine as CartLineState } from "@/hooks/useSale";
import { cartTotalCents } from "@/lib/money";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

export interface CartPanelProps {
  lines: CartLineState[];
  /** Whether the sale's customer carries a membership reference. */
  isMember: boolean;
  /** Narrowed picker for one service line: `User.departments ∩ Service.departmentId`. */
  staffForService: (serviceId: string) => StaffOption[];
  /** A granting line forces a customer, or the credit is issued to nobody. */
  needsCustomer: boolean;
  /** The till may look but not ring anything up (suspended salon). */
  disabled: boolean;
  onQuantity: (key: string, quantity: number) => void;
  onStaff: (key: string, staffId: string | undefined) => void;
  /** Sets or clears a line's discount rate, in percent (ADR 0017). */
  onDiscount: (key: string, percent: number | undefined) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onCheckout: () => void;
  /** Parks the cart for later — a draft, not a sale (ADR 0015). */
  onHold: () => void;
  /** A hold is in flight, so both footer actions wait on it. */
  holdPending: boolean;
}

export default function CartPanel({
  lines,
  isMember,
  staffForService,
  needsCustomer,
  disabled,
  onQuantity,
  onStaff,
  onDiscount,
  onRemove,
  onClear,
  onCheckout,
  onHold,
  holdPending,
}: CartPanelProps) {
  const { formatPrice } = useSalonFormatting();
  const [clearOpen, setClearOpen] = useState(false);
  const locked = disabled || holdPending;
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  // Every line carries both figures: what it costs **after** its discount, and what the
  // catalogue asked. The difference is what the `Discount` row shows (ADR 0017).
  const priced = lines.map((line) => ({
    line,
    unitPrice: lineUnitPrice(line, isMember),
    listPrice: listUnitPrice(line, isMember),
  }));
  const totalCents = cartTotalCents(
    priced.map(({ line, unitPrice }) => ({ unitPrice, quantity: line.quantity })),
  );
  const listTotalCents = cartTotalCents(
    priced.map(({ line, listPrice }) => ({ unitPrice: listPrice, quantity: line.quantity })),
  );
  const discountCents = listTotalCents - totalCents;

  return (
    <>
      <Card
        flush
        className="h-[min(90dvh,46rem)] min-h-96 [&>div]:min-h-0 [&>div]:flex-1 [&>div]:overflow-y-auto [&>footer]:shrink-0 lg:h-[max(36rem,calc(100dvh-10rem))]"
        title={
          <span className="flex items-center gap-2">
            Cart
            <span
              aria-hidden="true"
              className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-bold text-ink-muted tabular-nums"
            >
              {units} {units === 1 ? "item" : "items"}
            </span>
          </span>
        }
        description={
          <span className="sr-only">
            {units} {units === 1 ? "item" : "items"} in cart
          </span>
        }
        actions={
          lines.length > 0 ? (
            <Button variant="ghost" disabled={locked} onClick={() => setClearOpen(true)}>
              Clear cart
            </Button>
          ) : undefined
        }
        footer={
          lines.length > 0 ? (
            <div className="flex flex-col gap-4 p-1">
              {discountCents > 0 ? (
                <>
                  <div className="flex items-baseline justify-between text-sm text-ink-muted">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatPrice(listTotalCents / 100)}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-ink-muted">Discount</span>
                    <span className="text-sm font-bold text-success-text">
                      −{formatPrice(discountCents / 100)}
                    </span>
                  </div>
                </>
              ) : null}
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-bold text-ink">Total</span>
                <span className="text-3xl font-heavy text-ink tabular-nums">
                  {formatPrice(totalCents / 100)}
                </span>
              </div>
              {needsCustomer ? (
                <p
                  role="status"
                  className="rounded-md border border-line bg-surface p-3 text-sm text-ink-body"
                >
                  This cart grants a package, credit or gift card — pick a customer before taking
                  payment.
                </p>
              ) : null}
              {/* One compact row leaves more vertical space for cart items. */}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  disabled={locked}
                  loading={holdPending}
                  onClick={onHold}
                >
                  {holdPending ? "Holding…" : "Hold cart"}
                </Button>
                <Button className="min-w-0 flex-1" size="md" disabled={locked} onClick={onCheckout}>
                  Take payment
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {lines.length === 0 ? (
          <EmptyState
            title="The cart is empty"
            description="Choose a service, product or package to start this sale."
            icon={<Cart />}
            className="h-full py-8"
          />
        ) : (
          <ul aria-label="Cart items" className="divide-y divide-line-soft px-5">
            {priced.map(({ line, unitPrice, listPrice }) => (
              <CartLine
                key={`${line.itemType}:${line.itemId}:${line.staffId ?? ""}`}
                line={line}
                unitPrice={unitPrice}
                listPrice={listPrice}
                attribution={line.itemType === "SERVICE" ? "service" : "none"}
                staffOptions={line.itemType === "SERVICE" ? staffForService(line.itemId) : []}
                onQuantity={onQuantity}
                onStaff={onStaff}
                onDiscount={onDiscount}
                onRemove={onRemove}
                disabled={locked}
              />
            ))}
          </ul>
        )}
      </Card>
      <Modal
        open={clearOpen && lines.length > 0}
        title="Clear this cart?"
        description="All items and line discounts will be removed from the open cart. This cannot be undone."
        size="sm"
        onClose={() => setClearOpen(false)}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setClearOpen(false)}>
              Keep cart
            </Button>
            <Button
              variant="danger"
              disabled={locked}
              onClick={() => {
                onClear();
                setClearOpen(false);
              }}
            >
              Clear cart
            </Button>
          </div>
        }
      />
    </>
  );
}
