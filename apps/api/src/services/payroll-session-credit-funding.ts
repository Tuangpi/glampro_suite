import {
  payrollFullCreditFunding,
  payrollMixedCreditFunding,
} from "./payroll-full-credit-funding.js";
import { verifyPayrollPackageTenders } from "./payroll-close-package-tender.js";
import { Prisma } from "../../generated/prisma/client.js";

/** Validation-only balancing tender for a receipt that is not paid in full. It is
 * never persisted as a payment and never attributed to a line. */
const uncollectedPaymentId = "payroll-uncollected-balance";

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
  verifiedWholeSaleVoid = false,
) {
  if (
    sale.paymentStatus !== "PAID" ||
    !sale.paidAmount.equals(sale.totalAmount) ||
    lines.some((line) => !["SERVICE", "PRODUCT"].includes(line.itemType)) ||
    !redemptionCount
  )
    return null;
  const tender = verifyPayrollPackageTenders(
    sale,
    payments,
    coverage,
    redemptionCount,
    true,
    verifiedWholeSaleVoid,
  );
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

/** The instalment counterpart of `payrollSessionCreditFunding`: the same frozen
 * session coverage, plus credit, allocated external money and an explicitly recorded
 * balance. The uncollected remainder is debt — it is validated as tender inventory
 * only, never as cash and never attributed to a line, so later collections stay
 * independently allocated. */
export function payrollSessionInstalmentFunding(
  sale: Parameters<typeof payrollSessionCreditFunding>[0],
  lines: Parameters<typeof payrollSessionCreditFunding>[1],
  payments: Parameters<typeof payrollSessionCreditFunding>[2],
  receipts: Parameters<typeof payrollSessionCreditFunding>[3],
  coverage: Parameters<typeof payrollSessionCreditFunding>[4],
  redemptionCount: number,
) {
  if (
    sale.collectionCurrency !== "SGD" ||
    sale.paymentStatus !== "UNPAID" ||
    !sale.totalAmount.isPositive() ||
    !sale.totalAmount.mul(100).isInteger() ||
    !sale.paidAmount.isPositive() ||
    !sale.paidAmount.mul(100).isInteger() ||
    !sale.paidAmount.lessThan(sale.totalAmount) ||
    !lines.length ||
    lines.some((line) => !["SERVICE", "PRODUCT"].includes(line.itemType)) ||
    !payments.length ||
    new Set(payments.map((row) => row.id)).size !== payments.length ||
    payments.some(
      (row) =>
        row.id === uncollectedPaymentId ||
        !row.amount.isPositive() ||
        !row.amount.mul(100).isInteger(),
    ) ||
    // Complete receipt inventory: the tenders are exactly what was collected.
    !payments
      .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0))
      .equals(sale.paidAmount) ||
    !redemptionCount
  )
    return null;
  const tender = verifyPayrollPackageTenders(sale, payments, coverage, redemptionCount, true);
  const ordinary = lines.filter(
    (line) => (coverage.find((row) => row.saleLineId === line.id)?.remainingQuantity ?? 0) > 0,
  );
  if (!ordinary.length) return null;
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
  const uncollected = sale.totalAmount.minus(sale.paidAmount);
  const debt = {
    id: uncollectedPaymentId,
    method: "PREPAID_CREDIT",
    amount: uncollected,
    sessionId: null,
  };
  const packageAmount = new Prisma.Decimal(tender.grossCents).div(100);
  const totalAmount = sale.totalAmount.minus(packageAmount);
  if (!totalAmount.isPositive()) return null;
  const partial = coverage.some((row) => row.coveredQuantity > 0 && row.remainingQuantity > 0);
  const remainingPayments = payments.filter((row) => row.method !== "PACKAGE");
  const settled = {
    ...sale,
    paymentStatus: "PAID",
    totalAmount,
    // The synthetic balance settles the receipt for validation only.
    paidAmount: totalAmount,
  };
  const funding = partial
    ? // A split line may have credit on either segment, so the whole receipt is read.
      payrollMixedCreditFunding(
        { ...sale, paymentStatus: "PAID", paidAmount: sale.totalAmount },
        lines,
        [...payments, debt],
        receipts,
        true,
      )
    : (payrollFullCreditFunding(settled, ordinary, [...remainingPayments, debt]) ??
      payrollMixedCreditFunding(settled, ordinary, [...remainingPayments, debt], receipts));
  // No external money means no allocation to reconcile, but any collected cash or an
  // unprovable credit/debt split still refuses.
  if (
    !funding &&
    (receipts.length || payments.some((row) => !["PREPAID_CREDIT", "PACKAGE"].includes(row.method)))
  )
    return null;
  return {
    version: 2 as const,
    packagePaymentIds: tender.paymentIds,
    packageGrossCents: tender.grossCents,
    coverage,
    paymentIds: payments.map((row) => row.id).sort(),
    creditGrossCents: payments
      .filter((row) => row.method === "PREPAID_CREDIT")
      .reduce((sum, row) => sum + BigInt(row.amount.mul(100).toFixed(0)), 0n)
      .toString(),
    unpaidGrossCents: uncollected.mul(100).toFixed(0),
    // The synthetic balance is validation-only, so it never appears as a collection.
    collections: funding && "collections" in funding ? funding.collections : [],
  };
}
