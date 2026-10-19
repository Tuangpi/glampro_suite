/**
 * What a package pays for — the till's copy of the server's coverage rule (TK2610-0011).
 *
 * `redeemPayments` in `sale.service.ts` recomputes this and refuses a tender whose amount
 * differs, so the two have to agree exactly: a sheet that ordered or rounded differently
 * would offer a payment the server then rejects. The server's own suite covers the ledger
 * side; this module is the arithmetic the browser shows, and it lives outside the dialog so
 * it can be tested without rendering one.
 */
import type { CustomerHolding, SaleItemKind } from "@glampro_suite/shared";

/** One cart line as the payment sheet prices a redemption against it. */
export interface PaymentLine {
  itemType: SaleItemKind;
  itemId: string;
  quantity: number;
  /** The unit price the cart is charging, in whole cents. */
  unitPriceCents: number;
}

/**
 * Covers eligible service units in cart order, one session each, until the sessions run
 * out. A line the package does not list is skipped rather than refused: a cart with a
 * shampoo and a haircut is exactly what a haircut package is for.
 */
export function packageCoverage(
  holding: Pick<CustomerHolding, "serviceIds" | "quantityRemaining">,
  lines: readonly PaymentLine[],
) {
  const eligible = new Set(holding.serviceIds);
  let sessions = 0;
  let cents = 0;

  for (const line of lines) {
    if (line.itemType !== "SERVICE" || !eligible.has(line.itemId)) continue;
    for (let unit = 0; unit < line.quantity && sessions < holding.quantityRemaining; unit++) {
      cents += line.unitPriceCents;
      sessions += 1;
    }
    if (sessions >= holding.quantityRemaining) break;
  }

  return { cents, sessions };
}
