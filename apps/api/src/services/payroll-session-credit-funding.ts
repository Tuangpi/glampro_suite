import {
  payrollFullCreditFunding,
  payrollMixedCreditFunding,
} from "./payroll-full-credit-funding.js";
import { verifyPayrollPackageTenders } from "./payroll-close-package-tender.js";
import { Prisma } from "../../generated/prisma/client.js";

/** Prospective evidence only. Verified session coverage reserves the first units'
 * gross cents; external money remains explicitly allocated against original line
 * tax economics, and may not exceed the uncovered units' gross remainder. */
export function payrollSessionCreditFunding(
  sale: Parameters<typeof payrollMixedCreditFunding>[0] &
    Parameters<typeof verifyPayrollPackageTenders>[0],
  lines: (Parameters<typeof payrollMixedCreditFunding>[1][number] & { quantity: number })[],
  payments: Parameters<typeof verifyPayrollPackageTenders>[1],
  receipts: Parameters<typeof payrollMixedCreditFunding>[3],
  coverage: Parameters<typeof verifyPayrollPackageTenders>[2],
  redemptionCount: number,
) {
  if (
    sale.paymentStatus !== "PAID" ||
    !sale.paidAmount.equals(sale.totalAmount) ||
    lines.some((line) => !["SERVICE", "PRODUCT"].includes(line.itemType)) ||
    !redemptionCount
  )
    return null;
  const tender = verifyPayrollPackageTenders(sale, payments, coverage, redemptionCount, true);
  const partial = coverage.some((row) => row.coveredQuantity > 0 && row.remainingQuantity > 0);
  const ordinary = lines.filter(
    (line) => (coverage.find((row) => row.saleLineId === line.id)?.remainingQuantity ?? 0) > 0,
  );
  if (
    receipts.some((row) =>
      row.allocations.some((part) => !ordinary.some((line) => line.id === part.saleLineId)),
    )
  )
    return null;
  for (const line of ordinary) {
    const part = coverage.find((row) => row.saleLineId === line.id)!;
    const gross = line.lineTotal.minus(line.voucherDiscountAmount).mul(100);
    if (!gross.isInteger() || gross.isNegative()) return null;
    const cents = BigInt(gross.toFixed(0));
    const quantity = BigInt(line.quantity);
    const covered = BigInt(part.coveredQuantity);
    const residual = cents % quantity;
    const reserved = (cents / quantity) * covered + (covered < residual ? covered : residual);
    const external = receipts
      .flatMap((row) => row.allocations)
      .filter((row) => row.saleLineId === line.id)
      .reduce((sum, row) => sum + row.grossCents, 0n);
    if (external > cents - reserved) return null;
  }
  const packageAmount = new Prisma.Decimal(tender.grossCents).div(100);
  const totalAmount = sale.totalAmount.minus(packageAmount);
  if (!totalAmount.isPositive()) return null;
  const adjusted = {
    ...sale,
    totalAmount,
    paidAmount: sale.paidAmount.minus(sale.totalAmount.minus(totalAmount)),
  };
  const remainingPayments = payments.filter((row) => row.method !== "PACKAGE");
  const funding =
    payrollFullCreditFunding(adjusted, ordinary, remainingPayments) ??
    (partial
      ? payrollMixedCreditFunding(sale, lines, payments, receipts, true)
      : payrollMixedCreditFunding(adjusted, ordinary, remainingPayments, receipts));
  return funding
    ? {
        version: partial ? 2 : 1,
        packagePaymentIds: tender.paymentIds,
        packageGrossCents: tender.grossCents,
        coverage,
        funding,
      }
    : null;
}
