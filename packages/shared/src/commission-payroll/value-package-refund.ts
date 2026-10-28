import { z } from "zod";
import { commissionSharesSchema } from "../schemas/commission-attribution.js";
import { payrollValuePackageSpend } from "./allocation.js";

const money = z.string().regex(/^(0|[1-9]\d{0,9})\.\d{2}$/);

/** Prospective holding evidence, never reconstructed from today's catalogue. */
export const payrollValuePackagePurchaseSchema = z.object({
  version: z.literal(1),
  saleId: z.string().min(1),
  saleLineId: z.string().min(1),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  paidNet: money,
  credit: money.refine((value) => cents(value) > 0n, "Granted credit must be positive."),
  sellers: commissionSharesSchema.nullable(),
});

function cents(value: string): bigint {
  return BigInt(money.parse(value).replace(".", ""));
}

function amount(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

/**
 * Pure refund quote. Callers must supply source-validated original tax/collections,
 * lock and reconcile the holding, and record cancellation/payout evidence atomically.
 * This neither pays money nor reverses legitimately earned VP_SPEND evidence.
 */
export function payrollValuePackageRefundAmounts(input: {
  purchase: unknown;
  creditRemaining: string;
  originalTaxCents: bigint;
  collectedNet: bigint;
  collectedTax: bigint;
  adminFeeNet: bigint;
}) {
  const purchase = payrollValuePackagePurchaseSchema.parse(input.purchase);
  if (!purchase.currency || !purchase.sellers)
    throw new Error("Complete original value-package purchase evidence is required.");
  const paid = cents(purchase.paidNet);
  const credit = cents(purchase.credit);
  const remaining = cents(input.creditRemaining);
  if (
    remaining > credit ||
    input.originalTaxCents < 0n ||
    input.collectedNet < 0n ||
    input.collectedNet > paid ||
    input.collectedTax < 0n ||
    input.collectedTax > input.originalTaxCents ||
    input.adminFeeNet < 0n
  )
    throw new Error(
      "Value-package credit/collections do not reconcile with original consideration.",
    );

  // Use the same cumulative rounding as VP_SPEND, including its final residual.
  const usedTicks = BigInt(
    payrollValuePackageSpend(
      purchase.paidNet,
      purchase.credit,
      "0",
      amount(credit - remaining),
    ).replace(".", ""),
  );
  const raw = input.collectedNet * 100n - usedTicks - input.adminFeeNet * 100n;
  const net = raw > 0n ? raw / 100n : 0n;
  const tax = input.collectedNet
    ? (input.collectedTax * net + input.collectedNet / 2n) / input.collectedNet
    : 0n;
  return {
    net,
    tax,
    gross: net + tax,
    usedTicks,
    cancelledCreditCents: remaining,
    cancelledGross: paid + input.originalTaxCents - input.collectedNet - input.collectedTax,
  };
}
