import {
  normalizeSessionRanges,
  packageRangeValue,
  type PackagePurchaseValue,
  type SessionOrdinalRange,
} from "./package-valuation.js";

function nonnegative(value: bigint): void {
  if (value < 0n) throw new RangeError("Collection evidence must be nonnegative.");
}

function assertPurchase(purchase: PackagePurchaseValue): void {
  nonnegative(purchase.netCents);
  nonnegative(purchase.taxCents);
  if (purchase.grossCents !== purchase.netCents + purchase.taxCents)
    throw new RangeError("Contracted net, stored tax and gross must reconcile.");
}

/** Integer half-up only; no decimal or floating-point monetary arithmetic. */
function halfUp(numerator: bigint, denominator: bigint): bigint {
  nonnegative(numerator);
  if (denominator <= 0n) throw new RangeError("Ratio denominator must be positive.");
  return (2n * numerator + denominator) / (2n * denominator);
}

/** Collection attribution only. Never changes contracted value or stored GST. */
export function collectionComponents(
  purchase: PackagePurchaseValue,
  collectedGrossCents: bigint,
): PackagePurchaseValue {
  assertPurchase(purchase);
  nonnegative(collectedGrossCents);
  if (collectedGrossCents > purchase.grossCents)
    throw new RangeError("Collection exceeds the line's contracted gross.");
  const taxCents =
    purchase.grossCents === 0n
      ? 0n
      : halfUp(collectedGrossCents * purchase.taxCents, purchase.grossCents);
  return {
    netCents: collectedGrossCents - taxCents,
    taxCents,
    grossCents: collectedGrossCents,
  };
}

/** Signed cumulative differences support collection and exact source restoration. */
export function collectionDelta(
  purchase: PackagePurchaseValue,
  beforeGrossCents: bigint,
  afterGrossCents: bigint,
): PackagePurchaseValue {
  const before = collectionComponents(purchase, beforeGrossCents);
  const after = collectionComponents(purchase, afterGrossCents);
  return {
    netCents: after.netCents - before.netCents,
    taxCents: after.taxCents - before.taxCents,
    grossCents: after.grossCents - before.grossCents,
  };
}

export interface CollectionLine {
  lineId: string;
  purchase: PackagePurchaseValue;
  collectedGrossCents: bigint;
}

/**
 * Validate one receipt's explicit allocations against authoritative line state.
 * The caller must tenant/sale/currency-scope and lock these lines in its transaction.
 * No inference, mutation, automatic pro rata allocation or unlabelled remainder.
 */
export function allocateCollection(
  receiptCents: bigint,
  lines: readonly CollectionLine[],
  allocations: readonly { lineId: string; grossCents: bigint }[],
): (PackagePurchaseValue & { lineId: string })[] {
  nonnegative(receiptCents);
  const byId = new Map<string, CollectionLine>();
  for (const line of lines) {
    if (!line.lineId || byId.has(line.lineId))
      throw new RangeError("Authoritative collection lines require unique identities.");
    collectionComponents(line.purchase, line.collectedGrossCents);
    byId.set(line.lineId, line);
  }
  const seen = new Set<string>();
  let allocated = 0n;
  const result = allocations.map(({ lineId, grossCents }) => {
    const line = byId.get(lineId);
    if (!line || seen.has(lineId))
      throw new RangeError("Allocations must reference distinct lines from this sale.");
    if (grossCents <= 0n) throw new RangeError("Explicit allocation amounts must be positive.");
    seen.add(lineId);
    allocated += grossCents;
    return {
      lineId,
      ...collectionDelta(
        line.purchase,
        line.collectedGrossCents,
        line.collectedGrossCents + grossCents,
      ),
    };
  });
  if (allocated !== receiptCents)
    throw new RangeError("Explicit line allocations must equal the settled receipt.");
  return result;
}

/**
 * Refund one immutable collection lot, never a sale-wide inferred payment.
 * Cumulative net/tax deltas ensure the last refund consumes the exact residual.
 * Source identity, unrefunded balance and serialization remain the caller's duty.
 */
export function collectionRefundDelta(
  lot: PackagePurchaseValue,
  beforeRefundedGrossCents: bigint,
  afterRefundedGrossCents: bigint,
): PackagePurchaseValue {
  if (afterRefundedGrossCents < beforeRefundedGrossCents)
    throw new RangeError("Cumulative refunded gross cannot decrease.");
  const delta = collectionDelta(lot, beforeRefundedGrossCents, afterRefundedGrossCents);
  return {
    netCents: -delta.netCents,
    taxCents: -delta.taxCents,
    grossCents: -delta.grossCents,
  };
}

/** Exact source earning units (10 decimal places), prorated by refunded net basis. */
export function commissionClawbackUnits(
  originalUnits: bigint,
  originalNetCents: bigint,
  beforeRefundedNetCents: bigint,
  afterRefundedNetCents: bigint,
): bigint {
  nonnegative(originalUnits);
  nonnegative(originalNetCents);
  nonnegative(beforeRefundedNetCents);
  if (afterRefundedNetCents < beforeRefundedNetCents || afterRefundedNetCents > originalNetCents)
    throw new RangeError("Refunded net must increase within the original earning basis.");
  if (originalNetCents === 0n) {
    if (originalUnits !== 0n)
      throw new RangeError("Zero basis cannot evidence a positive earning.");
    return 0n;
  }
  return -(
    halfUp(originalUnits * afterRefundedNetCents, originalNetCents) -
    halfUp(originalUnits * beforeRefundedNetCents, originalNetCents)
  );
}

export type SessionCollectionEvidence =
  | { status: "UNKNOWN" }
  | { status: "KNOWN"; purchase: PackagePurchaseValue; collectedNetCents: bigint };

/**
 * Unknown historical evidence preserves legacy use but is never labelled paid.
 * This is not authorization: expiry, available ordinals and manager overrides are
 * separate transactional checks. Zero-value evidenced purchases remain unrestricted.
 */
export function sessionCollectionEligibility(
  evidence: SessionCollectionEvidence,
  sessions: number,
  selected: readonly SessionOrdinalRange[],
):
  | { status: "UNKNOWN"; coveredPrefix: null }
  | { status: "COVERED" | "INSUFFICIENT"; coveredPrefix: number } {
  const ordinals = normalizeSessionRanges(sessions, selected);
  if (ordinals.length === 0) throw new RangeError("Select at least one session ordinal.");
  if (evidence.status === "UNKNOWN") return { status: "UNKNOWN", coveredPrefix: null };
  assertPurchase(evidence.purchase);
  nonnegative(evidence.collectedNetCents);
  if (evidence.collectedNetCents > evidence.purchase.netCents)
    throw new RangeError("Allocated collection net exceeds the original purchase net.");
  // Binary search avoids expanding a large grant into one row per session.
  let low = 0;
  let high = sessions;
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    const required = packageRangeValue(evidence.purchase, sessions, [
      { first: 1, last: middle },
    ]).netCents;
    if (required <= evidence.collectedNetCents) low = middle;
    else high = middle - 1;
  }
  return {
    status: ordinals.every(({ last }) => last <= low) ? "COVERED" : "INSUFFICIENT",
    coveredPrefix: low,
  };
}

/** Cumulative original paid-to-granted-credit ratio, including promotional credit. */
export function storedCreditSpendDelta(
  originalPaidNetCents: bigint,
  grantedCreditCents: bigint,
  beforeSpentCents: bigint,
  afterSpentCents: bigint,
): bigint {
  nonnegative(originalPaidNetCents);
  nonnegative(beforeSpentCents);
  nonnegative(afterSpentCents);
  if (
    grantedCreditCents <= 0n ||
    beforeSpentCents > grantedCreditCents ||
    afterSpentCents > grantedCreditCents
  )
    throw new RangeError("Credit spend must lie within the original positive grant.");
  return (
    halfUp(afterSpentCents * originalPaidNetCents, grantedCreditCents) -
    halfUp(beforeSpentCents * originalPaidNetCents, grantedCreditCents)
  );
}

/** Partition once: ordinary service never earns on the stored-credit funding slice. */
export function partitionServiceCollection(
  purchase: PackagePurchaseValue,
  ordinaryGrossCents: bigint,
  creditGrossCents: bigint,
): { ordinaryNetCents: bigint; creditFundedNetCents: bigint } {
  nonnegative(ordinaryGrossCents);
  nonnegative(creditGrossCents);
  if (ordinaryGrossCents + creditGrossCents !== purchase.grossCents)
    throw new RangeError("Service funding must reconcile to its contracted gross.");
  const creditFundedNetCents = collectionComponents(purchase, creditGrossCents).netCents;
  return { ordinaryNetCents: purchase.netCents - creditFundedNetCents, creditFundedNetCents };
}
