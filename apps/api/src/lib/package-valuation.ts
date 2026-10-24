/** Approved remaining-package purchase-value policy. Never use catalogue prices. */
export const PACKAGE_VALUATION_POLICY_VERSION = 1;

/** Inclusive, one-based purchase-session ordinals. Store ranges, not rounded shares. */
export interface SessionOrdinalRange {
  first: number;
  last: number;
}

export interface PackagePurchaseValue {
  netCents: bigint;
  taxCents: bigint;
  grossCents: bigint;
}

/** Decimal database strings only: reject sub-cent values rather than rounding evidence. */
export function packageMoneyToCents(value: string): bigint {
  const match = /^\d+(?:\.\d{1,2})?$/.exec(value);
  if (!match || match[0] !== value) {
    throw new RangeError(
      "Package purchase money must be a nonnegative decimal with at most two places.",
    );
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

/** lineTotal already includes manual discounts. Only the stored voucher share is removed. */
export function packagePurchaseValue(
  lineTotal: string,
  voucherDiscountAmount: string,
  storedTaxAmount: string,
): PackagePurchaseValue {
  const grossCents = packageMoneyToCents(lineTotal) - packageMoneyToCents(voucherDiscountAmount);
  const taxCents = packageMoneyToCents(storedTaxAmount);
  if (grossCents < taxCents) {
    throw new RangeError("Package purchase consideration must cover its nonnegative stored tax.");
  }
  return { netCents: grossCents - taxCents, taxCents, grossCents };
}

function assertSessionCount(sessions: number): void {
  if (!Number.isSafeInteger(sessions) || sessions < 1) {
    throw new RangeError("Granted sessions must be a positive safe integer.");
  }
}

/** Validate persisted evidence without mutating it; overlap is corruption, not deduplication. */
export function normalizeSessionRanges(
  sessions: number,
  ranges: readonly SessionOrdinalRange[],
): SessionOrdinalRange[] {
  assertSessionCount(sessions);
  const sorted = ranges
    .map(({ first, last }) => {
      if (
        !Number.isSafeInteger(first) ||
        !Number.isSafeInteger(last) ||
        first < 1 ||
        last < first ||
        last > sessions
      ) {
        throw new RangeError("Session ordinal ranges must lie within the original purchase grant.");
      }
      return { first, last };
    })
    .sort((a, b) => a.first - b.first);
  const result: SessionOrdinalRange[] = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (previous && range.first <= previous.last) {
      throw new RangeError("Session ordinal ranges must not overlap.");
    }
    if (previous && range.first - previous.last === 1) previous.last = range.last;
    else result.push(range);
  }
  return result;
}

/** Equal shares, with the first remainder ordinals receiving one additional cent. */
function componentValue(
  cents: bigint,
  sessions: number,
  ranges: readonly SessionOrdinalRange[],
): bigint {
  const divisor = BigInt(sessions);
  const base = cents / divisor;
  const remainder = cents % divisor;
  let result = 0n;
  for (const range of ranges) {
    const first = BigInt(range.first);
    const last = BigInt(range.last);
    const extraLast = last < remainder ? last : remainder;
    result += base * (last - first + 1n);
    if (extraLast >= first) result += extraLast - first + 1n;
  }
  return result;
}

/** Allocate net and original tax independently. Gross is their sum, never a third rounding. */
export function packageRangeValue(
  purchase: PackagePurchaseValue,
  sessions: number,
  ranges: readonly SessionOrdinalRange[],
): PackagePurchaseValue & { quantity: number } {
  const normalized = normalizeSessionRanges(sessions, ranges);
  if (
    purchase.netCents < 0n ||
    purchase.taxCents < 0n ||
    purchase.grossCents !== purchase.netCents + purchase.taxCents
  ) {
    throw new RangeError("Package purchase components must be nonnegative and reconcile.");
  }
  const netCents = componentValue(purchase.netCents, sessions, normalized);
  const taxCents = componentValue(purchase.taxCents, sessions, normalized);
  return {
    quantity: normalized.reduce((sum, range) => sum + (range.last - range.first + 1), 0),
    netCents,
    taxCents,
    grossCents: netCents + taxCents,
  };
}

/** Redeem lowest available ordinals first; both returned lists are safe to persist. */
export function takePackageSessions(
  sessions: number,
  available: readonly SessionOrdinalRange[],
  quantity: number,
): { allocated: SessionOrdinalRange[]; remaining: SessionOrdinalRange[] } {
  const normalized = normalizeSessionRanges(sessions, available);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > sessions) {
    throw new RangeError("Redemption quantity must be a positive safe integer within the grant.");
  }
  const allocated: SessionOrdinalRange[] = [];
  const remaining: SessionOrdinalRange[] = [];
  let needed = quantity;
  for (const range of normalized) {
    const take = Math.min(needed, range.last - range.first + 1);
    if (take > 0) allocated.push({ first: range.first, last: range.first + take - 1 });
    if (take < range.last - range.first + 1)
      remaining.push({ first: range.first + take, last: range.last });
    needed -= take;
  }
  if (needed !== 0) throw new RangeError("Not enough available package session ordinals.");
  return { allocated, remaining };
}

/** Restore the original redemption evidence, not a new equal share of the current balance. */
export function restorePackageSessions(
  sessions: number,
  available: readonly SessionOrdinalRange[],
  originalAllocation: readonly SessionOrdinalRange[],
): SessionOrdinalRange[] {
  if (originalAllocation.length === 0) {
    throw new RangeError("A package restoration requires its original session allocation.");
  }
  // Overlap deliberately fails: a retry must be handled by the source-action idempotency key.
  return normalizeSessionRanges(sessions, [...available, ...originalAllocation]);
}
