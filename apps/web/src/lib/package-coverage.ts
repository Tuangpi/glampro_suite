/**
 * What a package pays for — the till's copy of the server's coverage rule (TK2610-0011).
 *
 * `redeemPayments` in `sale.service.ts` recomputes this and refuses a tender whose amount
 * differs, so the two have to agree exactly: a sheet that ordered or rounded differently
 * would offer a payment the server then rejects. The server's own suite covers the ledger
 * side; this module is the arithmetic the browser shows, and it lives outside the dialog so
 * it can be tested without rendering one.
 */
import {
  allocatePackage,
  type CustomerHolding,
  type SaleItemKind,
  type CommissionAttribution,
  type CommissionShares,
} from "@glampro_suite/shared";

/** One cart line as the payment sheet prices a redemption against it. */
export interface PaymentLine {
  itemName?: string;
  itemType: SaleItemKind;
  itemId: string;
  quantity: number;
  /** The unit price the cart is charging, in whole cents. */
  unitPriceCents: number;
  totalCents?: number;
  staffId?: string;
  attribution?: CommissionAttribution;
}

/** Only an identical explicit split across every covered line is a safe default.
 * A set with different therapists needs a deliberate whole-session split. */
export function coveredPerformers(
  lines: readonly PaymentLine[],
  units: readonly number[],
  before: readonly number[],
): CommissionShares | undefined {
  let result: CommissionShares | undefined;
  const canonical = (shares: CommissionShares) =>
    JSON.stringify([...shares].sort((a, b) => a.staffId.localeCompare(b.staffId)));
  for (const [index, line] of lines.entries()) {
    if ((units[index] ?? 0) <= (before[index] ?? 0)) continue;
    const shares =
      line.attribution?.performers ??
      (line.staffId ? [{ staffId: line.staffId, share: 10000 }] : undefined);
    if (!shares?.length || (result && canonical(result) !== canonical(shares))) return undefined;
    result ??= shares;
  }
  return result;
}

/**
 * Covers eligible service units in cart order, one session each, until the sessions run
 * out. A line the package does not list is skipped rather than refused: a cart with a
 * shampoo and a haircut is exactly what a haircut package is for.
 */
export function packageCoverage(
  holding: Pick<
    CustomerHolding,
    "serviceIds" | "quantityRemaining" | "redemptionMode" | "serviceSet"
  >,
  lines: readonly PaymentLine[],
  allocated?: readonly number[],
) {
  return allocatePackage(
    {
      mode: holding.redemptionMode ?? "PER_UNIT",
      requirements:
        holding.serviceSet ?? holding.serviceIds.map((serviceId) => ({ serviceId, quantity: 1 })),
    },
    holding.quantityRemaining,
    lines.map((line) => ({
      ...line,
      totalCents: line.totalCents ?? line.unitPriceCents * line.quantity,
    })),
    allocated,
  );
}
