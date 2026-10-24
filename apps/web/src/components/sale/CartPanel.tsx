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
import { Cart } from "@/components/icons";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
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
    <Card
      className="max-h-[65vh] [&>div]:min-h-0 [&>div]:overflow-y-auto [&>footer]:shrink-0 lg:max-h-[calc(100dvh-22rem)]"
      title="Cart"
      description={
        lines.length === 0
          ? "Nothing rung up yet."
          : `${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${units} ${units === 1 ? "item" : "items"}`
      }
      actions={
        lines.length > 0 ? (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={onClear}>
            Clear
          </Button>
        ) : undefined
      }
      footer={
        lines.length > 0 ? (
          <div className="flex flex-col gap-2">
            {discountCents > 0 ? (
              // The handoff draws one `Discount` row, and it is the sum of what each line
              // gave away — not a second total the server would have to reconcile
              // (ADR 0017). Both figures are whole cents, so they cannot disagree.
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink-muted">Discount</span>
                <span className="text-sm font-bold text-success-text">
                  −{formatPrice(discountCents / 100)}
                </span>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between">
              <span className="font-bold text-ink">Total</span>
              <span className="text-lg font-heavy text-ink">{formatPrice(totalCents / 100)}</span>
            </div>
            {needsCustomer ? (
              <p className="text-xs text-ink-muted">
                This cart grants a package, credit or gift card — pick a customer before taking
                payment.
              </p>
            ) : null}
            {/* Hold and pay sit side by side: parking a cart is the other thing a
                cashier does with a full one, and hiding it behind a menu is how a
                till ends up with a cart nobody can leave the counter with. */}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={disabled || holdPending}
                loading={holdPending}
                onClick={onHold}
              >
                Hold
              </Button>
              <Button
                className="flex-1"
                size="lg"
                disabled={disabled || holdPending}
                onClick={onCheckout}
              >
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
          description="Pick a tab, find what the customer asked for, and add it."
          icon={<Cart />}
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-2 px-3 pt-1.5 pb-3">
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
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
