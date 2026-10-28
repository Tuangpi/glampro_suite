import { div, exact, fixed, mul } from "./decimal.js";

/** FOC is list-price activity, independent of the receipt's payment tenders. */
export function payrollSaleLineBase(input: {
  foc: boolean;
  listUnitPrice: string | null;
  quantity: number;
  netAmount: string;
  creditPaid: boolean;
  externalNetCents: bigint | null;
}) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0)
    throw new Error("Invalid commission source quantity.");
  if (input.foc) {
    if (input.listUnitPrice === null) return null;
    const price = exact(input.listUnitPrice);
    if (price.n < 0n) throw new Error("List price cannot be negative.");
    return fixed(mul(price, exact(String(input.quantity))), 4);
  }
  if (!input.creditPaid) return fixed(exact(input.netAmount), 4);
  if (input.externalNetCents === null) return null;
  if (input.externalNetCents < 0n) throw new Error("External collection cannot be negative.");
  return fixed(mul(exact(input.externalNetCents.toString()), exact("0.01")), 4);
}

/** Fixed per sale line, once across all instalments, not fixed per purchased unit. */
export function payrollFixedSaleAward(amount: string, priorCollections: number) {
  if (!Number.isSafeInteger(priorCollections) || priorCollections < 0)
    throw new Error("Invalid prior collection count.");
  const award = exact(amount);
  if (award.n < 0n) throw new Error("Fixed sale award cannot be negative.");
  return priorCollections === 0 ? fixed(award, 4) : "0.0000";
}

/** Proportional original award, truncated to base precision and bounded by original net. */
export function payrollFixedSaleClawback(award: string, refundNet: bigint, purchaseNet: bigint) {
  const original = exact(award);
  if (original.n < 0n || refundNet < 0n || purchaseNet < 0n || refundNet > purchaseNet)
    throw new Error("Invalid fixed sale clawback evidence.");
  if (refundNet === 0n) return "0.0000";
  const ratio = div(mul(original, exact(refundNet.toString())), exact(purchaseNet.toString()));
  const ticks = (ratio.n * 10000n) / ratio.d;
  return ticks === 0n
    ? "0.0000"
    : `-${ticks / 10000n}.${(ticks % 10000n).toString().padStart(4, "0")}`;
}
