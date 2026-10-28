import { readPayrollPackagePurchase } from "./package-payment.js";
import { payrollPackageSessionBase, type PayrollPackagePurchase } from "./package-purchase.js";

/** Validate original unused ordinals before using them to calculate money. */
export function payrollPackageUnusedValue(
  snapshot: PayrollPackagePurchase,
  ranges: readonly { first: number; last: number }[],
  quantityRemaining: number,
) {
  const purchase = readPayrollPackagePurchase(snapshot);
  if (!Number.isSafeInteger(quantityRemaining) || quantityRemaining < 0)
    throw new Error("Invalid remaining package sessions.");
  const sorted = [...ranges].sort((a, b) => a.first - b.first);
  let count = 0;
  let previous = 0;
  let remainingTicks = 0n;
  for (const range of sorted) {
    if (range.first <= previous) throw new Error("Package session ordinals overlap.");
    const value = payrollPackageSessionBase(
      purchase,
      range.first,
      range.last,
      purchase.sellers ?? [{ staffId: "economics-only", share: 10000 }],
    );
    remainingTicks += BigInt(value.baseAmount.replace(".", ""));
    count += range.last - range.first + 1;
    previous = range.last;
  }
  if (count !== quantityRemaining)
    throw new Error("Package ordinals do not reconcile with remaining sessions.");
  return {
    remainingTicks,
    usedTicks: BigInt(purchase.netCents) * 100n - remainingTicks,
  };
}

/** Customer refund at exact cents; commission clawbacks remain separate. */
export function payrollPackageRefundAmounts(input: {
  purchase: PayrollPackagePurchase;
  available: readonly { first: number; last: number }[];
  quantityRemaining: number;
  collectedNet: bigint;
  collectedTax: bigint;
  adminFeeNet: bigint;
}) {
  const purchase = readPayrollPackagePurchase(input.purchase);
  if (
    input.collectedNet < 0n ||
    input.collectedTax < 0n ||
    input.adminFeeNet < 0n ||
    input.collectedNet > BigInt(purchase.netCents) ||
    input.collectedTax > BigInt(purchase.taxCents)
  )
    throw new Error("Package collections do not reconcile with original consideration.");
  const { usedTicks } = payrollPackageUnusedValue(
    purchase,
    input.available,
    input.quantityRemaining,
  );
  const raw = input.collectedNet * 100n - usedTicks - input.adminFeeNet * 100n;
  // Round down only at the customer cent boundary, not per session.
  const net = raw > 0n ? raw / 100n : 0n;
  const tax = input.collectedNet
    ? (input.collectedTax * net + input.collectedNet / 2n) / input.collectedNet
    : 0n;
  return {
    net,
    tax,
    gross: net + tax,
    usedTicks,
    cancelledGross: BigInt(purchase.grossCents) - input.collectedNet - input.collectedTax,
  };
}
