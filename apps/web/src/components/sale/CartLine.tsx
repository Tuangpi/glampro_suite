/**
 * One cart line — name, quantity stepper, performer, line total.
 *
 * The quantity input is uncontrolled in the same way `Select` is: the committed
 * value travels up on blur and Enter, while typing an intermediate "1" of "12"
 * never rewrites the cart. A zero or a blank on commit removes the line, which
 * is the contract's "a line of zero is not a line" rather than a second rule.
 *
 * The staff picker is the MVP's forced decision (`docs/mvp.md`): a service line
 * offers staff **in the service's department** (`User.departments` ∩
 * `Service.departmentId`), because a root-colour credit to a nail tech is a
 * wrong report. Every other kind takes no performer — the sale's own `staffId`
 * (who rang it up, defaulted server-side) attributes those. `staffOptions` is
 * the picker this line may offer, already narrowed by the page.
 */
import { useState } from "react";

import { Minus, Plus, Trash } from "@/components/icons";
import IconButton from "@/components/ui/IconButton";
import { CONTROL_CLASS } from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import { cartLineKey, type CartLine as CartLineState } from "@/hooks/useSale";
import { cartTotalCents } from "@/lib/money";
import { performerOptions } from "@/lib/performer-options";
import { cn } from "@/lib/utils";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

export interface StaffOption {
  id: string;
  name: string;
  email?: string | null;
}

export interface CartLineProps {
  line: CartLineState;
  /** What one unit costs after the line's discount — what the receipt will charge. */
  unitPrice: string;
  /** The same unit at the catalogue's price, so a discounted line can show both. */
  listPrice: string;
  /** The narrowed staff list: department staff for a SERVICE line, empty for the rest. */
  staffOptions: StaffOption[];
  /** The salon cannot offer a choice (line is not a service, or nobody to offer). */
  attribution: "service" | "none";
  onQuantity: (key: string, quantity: number) => void;
  onStaff: (key: string, staffId: string | undefined) => void;
  /** Sets or clears the line's discount rate, in percent (ADR 0017). */
  onDiscount: (key: string, percent: number | undefined) => void;
  onRemove: (key: string) => void;
  disabled: boolean;
}

export default function CartLine({
  line,
  unitPrice,
  listPrice,
  staffOptions,
  attribution,
  onQuantity,
  onStaff,
  onDiscount,
  onRemove,
  disabled,
}: CartLineProps) {
  const { formatPrice } = useSalonFormatting();
  const key = cartLineKey(line);
  // The draft the cashier is typing, held apart from the committed quantity so
  // an intermediate keystroke never rewrites the cart. `null` means "not
  // editing": the box shows the line's own quantity.
  const [draft, setDraft] = useState<string | null>(null);
  // The same treatment for the discount: typing "1" of "10" must not briefly set a
  // rate of one percent.
  const [discountDraft, setDiscountDraft] = useState<string | null>(null);

  function commit(raw: string) {
    setDraft(null);
    const parsed = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(parsed)) return;
    onQuantity(key, Math.trunc(parsed));
  }

  function commitDiscount(raw: string) {
    setDiscountDraft(null);
    const trimmed = raw.trim();
    // An emptied box **clears** the discount rather than setting zero: a line nobody
    // discounted sends no rate at all (ADR 0017).
    if (trimmed === "") {
      onDiscount(key, undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    onDiscount(key, parsed);
  }

  const totalCents = cartTotalCents([{ unitPrice, quantity: line.quantity }]);
  const discounted = line.discountPercent !== undefined && line.discountPercent > 0;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line-soft bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{line.name}</p>
          <p className="text-xs text-ink-muted">
            {discounted
              ? `${formatPrice(unitPrice)} each · ${line.discountPercent}% off ${formatPrice(listPrice)}`
              : `${formatPrice(unitPrice)} each`}
          </p>
        </div>
        <p className="shrink-0 text-sm font-heavy text-ink">{formatPrice(totalCents / 100)}</p>
      </div>

      <div className="flex items-center gap-1.5">
        <IconButton
          label={`One fewer ${line.name}`}
          icon={<Minus />}
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onQuantity(key, line.quantity - 1)}
        />
        {/* A raw input rather than `Input`: the stepper is one control among three
            in a row, and a second visible "Quantity" label under the line's own
            name would double the row's height for a caption nobody needs. The
            accessible name carries the line, so a screen reader still hears
            which row the box belongs to. */}
        <input
          type="number"
          min={0}
          max={10_000}
          aria-label={`Quantity of ${line.name}`}
          value={draft ?? String(line.quantity)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
          }}
          disabled={disabled}
          className={cn(CONTROL_CLASS, "h-control-sm w-20 text-center")}
        />
        <IconButton
          label={`One more ${line.name}`}
          icon={<Plus />}
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onQuantity(key, line.quantity + 1)}
        />
        <span className="flex-1" />

        {/* The discount control, always visible rather than behind an overflow menu: a
            rate the cashier has to hunt for is a rate that gets forgotten mid-sale, and
            the box shows the rate the line already carries so a discounted line says so.
            A raw input for the quantity's reason — a visible label per line would double
            the row's height. */}
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          <span aria-hidden>%</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            placeholder="off"
            aria-label={`Discount percent for ${line.name}`}
            value={discountDraft ?? line.discountPercent ?? ""}
            onChange={(event) => setDiscountDraft(event.target.value)}
            onBlur={(event) => commitDiscount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitDiscount((event.target as HTMLInputElement).value);
              }
            }}
            disabled={disabled}
            className={cn(CONTROL_CLASS, "h-control-sm w-16 text-center")}
          />
        </label>

        <IconButton
          label={`Remove ${line.name} from the cart`}
          icon={<Trash />}
          size="sm"
          disabled={disabled}
          onClick={() => onRemove(key)}
        />
      </div>

      {attribution === "service" && staffOptions.length > 0 ? (
        <Select
          label={`Who performed ${line.name}`}
          value={line.staffId ?? ""}
          onChange={(event) => onStaff(key, event.target.value || undefined)}
          options={[{ value: "", label: "Unassigned" }, ...performerOptions(staffOptions)]}
          disabled={disabled}
        />
      ) : null}
    </li>
  );
}
