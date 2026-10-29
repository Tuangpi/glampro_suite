import { Prisma } from "../../generated/prisma/client.js";
import { conflict } from "../lib/http-error.js";

/** SalePayment has no holding link. Reconcile the complete sale-level inventory,
 * never infer a particular payment-to-holding pairing or fresh cash collection.
 * POS allocates residual cents to the first covered units of each line.
 */
export function verifyPayrollPackageTenders(
  sale: {
    tenantId: string;
    id: string;
    status: string;
    collectionCurrency: string | null;
    lines: {
      id: string;
      quantity: number;
      lineTotal: Prisma.Decimal;
      voucherDiscountAmount: Prisma.Decimal;
    }[];
  },
  payments: {
    id: string;
    tenantId: string;
    saleId: string;
    method: string;
    amount: Prisma.Decimal;
    sessionId: string | null;
  }[],
  coverage: { saleLineId: string; coveredQuantity: number; remainingQuantity: number }[],
  redemptionCount: number,
) {
  const fail = (): never => {
    throw conflict("Authoritative payroll inputs unavailable: PACKAGE_TENDER_UNCONFIRMED.");
  };
  if (
    sale.status !== "COMPLETED" ||
    sale.collectionCurrency !== "SGD" ||
    new Set(payments.map((row) => row.id)).size !== payments.length ||
    payments.some((row) => row.tenantId !== sale.tenantId || row.saleId !== sale.id) ||
    payments.some((row) => row.method === "PREPAID_CREDIT") ||
    new Set(coverage.map((row) => row.saleLineId)).size !== coverage.length ||
    coverage.length !== sale.lines.length
  )
    return fail();
  let expected = 0n;
  for (const line of sale.lines) {
    const part = coverage.find((row) => row.saleLineId === line.id);
    if (
      !part ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isSafeInteger(part.coveredQuantity) ||
      part.coveredQuantity < 0 ||
      part.coveredQuantity > line.quantity ||
      part.remainingQuantity !== line.quantity - part.coveredQuantity
    )
      return fail();
    const cents = line.lineTotal.minus(line.voucherDiscountAmount).mul(100);
    if (!cents.isInteger() || cents.isNegative()) return fail();
    const gross = BigInt(cents.toFixed(0));
    const quantity = BigInt(line.quantity);
    const covered = BigInt(part.coveredQuantity);
    const residual = gross % quantity;
    expected += (gross / quantity) * covered + (covered < residual ? covered : residual);
  }
  const tenders = payments.filter((row) => row.method === "PACKAGE");
  if (
    !Number.isSafeInteger(redemptionCount) ||
    redemptionCount < 0 ||
    tenders.length !== redemptionCount ||
    tenders.some(
      (row) =>
        row.sessionId !== null || row.amount.isNegative() || !row.amount.mul(100).isInteger(),
    ) ||
    tenders.reduce((sum, row) => sum + BigInt(row.amount.mul(100).toFixed(0)), 0n) !== expected
  )
    return fail();
  return { grossCents: expected.toString(), paymentIds: tenders.map((row) => row.id).sort() };
}
