import { Prisma } from "../../generated/prisma/client.js";
import { payrollMixedCreditFunding } from "./payroll-full-credit-funding.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";

/** Checkout-only contract. Debt is not cash and is never attributed to a line.
 * The synthetic balancing tender is validation-only and is not persisted as money. */
export function payrollCreditInstalmentFunding(
  sale: Parameters<typeof payrollMixedCreditFunding>[0],
  lines: Parameters<typeof payrollMixedCreditFunding>[1],
  payments: Parameters<typeof payrollMixedCreditFunding>[2],
  receipts: Parameters<typeof payrollMixedCreditFunding>[3],
) {
  if (
    sale.collectionCurrency !== "SGD" ||
    sale.paymentStatus !== "UNPAID" ||
    !sale.paidAmount.isPositive() ||
    !sale.paidAmount.lessThan(sale.totalAmount) ||
    !sale.paidAmount.mul(100).isInteger() ||
    !payments.some((row) => row.method === "PREPAID_CREDIT") ||
    payments.some((row) => row.id === "payroll-uncollected-balance") ||
    !payments
      .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0))
      .equals(sale.paidAmount)
  )
    return null;
  const uncollected = sale.totalAmount.minus(sale.paidAmount);
  const balanced = payrollMixedCreditFunding(
    { ...sale, paymentStatus: "PAID", paidAmount: sale.totalAmount },
    lines,
    [
      ...payments,
      {
        id: "payroll-uncollected-balance",
        method: "PREPAID_CREDIT",
        amount: uncollected,
        sessionId: null,
      },
    ],
    receipts,
  );
  // A receipt with no external money has no collection inventory to validate.
  if (!balanced && (receipts.length || payments.some((row) => row.method !== "PREPAID_CREDIT")))
    return null;
  if (
    !lines.length ||
    new Set(lines.map((row) => row.id)).size !== lines.length ||
    lines.some(
      (row) =>
        !["SERVICE", "PRODUCT"].includes(row.itemType) ||
        [row.lineTotal, row.voucherDiscountAmount, row.taxAmount].some(
          (amount) => amount.isNegative() || !amount.mul(100).isInteger(),
        ),
    ) ||
    !lines
      .reduce(
        (sum, row) => sum.plus(row.lineTotal).minus(row.voucherDiscountAmount),
        new Prisma.Decimal(0),
      )
      .equals(sale.totalAmount) ||
    new Set(payments.map((row) => row.id)).size !== payments.length ||
    payments.some(
      (row) =>
        !row.amount.isPositive() || !row.amount.mul(100).isInteger() || row.sessionId !== null,
    )
  )
    return null;
  try {
    for (const line of lines)
      packagePurchaseValue(
        line.lineTotal.toFixed(2),
        line.voucherDiscountAmount.toFixed(2),
        line.taxAmount.toFixed(2),
      );
  } catch {
    return null;
  }
  return {
    version: 1,
    paymentIds: payments.map((row) => row.id).sort(),
    creditGrossCents: payments
      .filter((row) => row.method === "PREPAID_CREDIT")
      .reduce((sum, row) => sum + BigInt(row.amount.mul(100).toFixed(0)), 0n)
      .toString(),
    unpaidGrossCents: uncollected.mul(100).toFixed(0),
    collections: balanced?.collections ?? [],
  };
}
