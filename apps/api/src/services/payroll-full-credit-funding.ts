import type { Prisma } from "../../generated/prisma/client.js";
import { allocateCollection } from "../lib/commission-collection.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";

/** Prospective checkout evidence for a wholly credit-funded, settled ordinary
 * receipt. Complete independent tender inventory proves zero external money for
 * every line; this never allocates a mixed receipt or repairs missing history. */
export function payrollFullCreditFunding(
  sale: { totalAmount: Prisma.Decimal; collectionCurrency: string | null; paymentStatus: string },
  lines: { itemType: string }[],
  payments: { id: string; method: string; amount: Prisma.Decimal; sessionId: string | null }[],
) {
  if (
    sale.collectionCurrency !== "SGD" ||
    sale.paymentStatus !== "PAID" ||
    !sale.totalAmount.isPositive() ||
    !sale.totalAmount.mul(100).isInteger() ||
    !lines.length ||
    lines.some((line) => !["SERVICE", "PRODUCT"].includes(line.itemType)) ||
    !payments.length ||
    new Set(payments.map((payment) => payment.id)).size !== payments.length ||
    payments.some(
      (payment) =>
        payment.method !== "PREPAID_CREDIT" ||
        payment.sessionId !== null ||
        !payment.amount.isPositive() ||
        !payment.amount.mul(100).isInteger(),
    )
  )
    return null;
  const creditGrossCents = payments.reduce(
    (sum, payment) => sum + BigInt(payment.amount.mul(100).toFixed(0)),
    0n,
  );
  if (creditGrossCents !== BigInt(sale.totalAmount.mul(100).toFixed(0))) return null;
  return {
    version: 1,
    paymentIds: payments.map((payment) => payment.id).sort(),
    creditGrossCents: creditGrossCents.toString(),
    externalNetCents: "0",
  };
}

/** Prospective mixed cash/credit checkout inventory. External money is explicitly
 * allocated; credit is only the exact receipt remainder, never fresh cash.
 * Callers still reconcile holding spends, attribution, scope and historical dates. */
export function payrollMixedCreditFunding(
  sale: Parameters<typeof payrollFullCreditFunding>[0] & { paidAmount: Prisma.Decimal },
  lines: {
    id: string;
    itemType: string;
    lineTotal: Prisma.Decimal;
    voucherDiscountAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
  }[],
  payments: Parameters<typeof payrollFullCreditFunding>[2],
  receipts: {
    id: string;
    sourceType: string;
    sourceId: string;
    grossCents: bigint;
    allocations: {
      id: string;
      saleLineId: string;
      grossCents: bigint;
      netCents: bigint;
      taxCents: bigint;
    }[];
  }[],
  allowPackage = false,
) {
  if (
    sale.collectionCurrency !== "SGD" ||
    sale.paymentStatus !== "PAID" ||
    !sale.totalAmount.isPositive() ||
    !sale.totalAmount.mul(100).isInteger() ||
    !sale.paidAmount.equals(sale.totalAmount) ||
    !lines.length ||
    new Set(lines.map((line) => line.id)).size !== lines.length ||
    lines.some(
      (line) =>
        !["SERVICE", "PRODUCT"].includes(line.itemType) ||
        [line.lineTotal, line.voucherDiscountAmount, line.taxAmount].some(
          (amount) => amount.isNegative() || !amount.mul(100).isInteger(),
        ),
    ) ||
    new Set(payments.map((payment) => payment.id)).size !== payments.length ||
    payments.some(
      (payment) =>
        (![
          "PREPAID_CREDIT",
          "CASH",
          "CARD",
          "BANK_TRANSFER",
          "CHEQUE",
          "OTHER",
          "PAYNOW_SGQR",
          "NETS",
          "GRABPAY",
          "ATOME",
        ].includes(payment.method) &&
          !(allowPackage && payment.method === "PACKAGE")) ||
        payment.sessionId !== null ||
        !payment.amount.isPositive() ||
        !payment.amount.mul(100).isInteger(),
    )
  )
    return null;
  const credit = payments.filter((payment) => payment.method === "PREPAID_CREDIT");
  const packages = payments.filter((payment) => payment.method === "PACKAGE");
  const packageGrossCents = packages.reduce(
    (sum, payment) => sum + BigInt(payment.amount.mul(100).toFixed(0)),
    0n,
  );
  const external = payments.filter(
    (payment) => !["PREPAID_CREDIT", "PACKAGE"].includes(payment.method),
  );
  if (!credit.length || !external.length || receipts.length !== external.length) return null;
  const creditGrossCents = credit.reduce(
    (sum, payment) => sum + BigInt(payment.amount.mul(100).toFixed(0)),
    0n,
  );
  const externalGrossCents = external.reduce(
    (sum, payment) => sum + BigInt(payment.amount.mul(100).toFixed(0)),
    0n,
  );
  const allocations = receipts.flatMap((receipt) => receipt.allocations);
  if (
    creditGrossCents + externalGrossCents + packageGrossCents !==
      BigInt(sale.totalAmount.mul(100).toFixed(0)) ||
    new Set(receipts.map((receipt) => receipt.id)).size !== receipts.length ||
    new Set(receipts.map((receipt) => receipt.sourceId)).size !== receipts.length ||
    new Set(allocations.map((allocation) => allocation.id)).size !== allocations.length
  )
    return null;
  try {
    const purchases = lines.map((line) => ({
      lineId: line.id,
      purchase: packagePurchaseValue(
        line.lineTotal.toFixed(2),
        line.voucherDiscountAmount.toFixed(2),
        line.taxAmount.toFixed(2),
      ),
    }));
    if (
      purchases.reduce((sum, line) => sum + line.purchase.grossCents, 0n) !==
      creditGrossCents + externalGrossCents + packageGrossCents
    )
      return null;
    const collected = new Map<string, bigint>();
    for (const receipt of receipts) {
      const payment = external.find((row) => row.id === receipt.sourceId);
      if (
        receipt.sourceType !== "SALE_PAYMENT" ||
        !payment ||
        receipt.grossCents !== BigInt(payment.amount.mul(100).toFixed(0))
      )
        return null;
      const expected = allocateCollection(
        receipt.grossCents,
        purchases.map((line) => ({
          ...line,
          collectedGrossCents: collected.get(line.lineId) ?? 0n,
        })),
        receipt.allocations.map((part) => ({
          lineId: part.saleLineId,
          grossCents: part.grossCents,
        })),
      );
      for (const part of receipt.allocations) {
        const delta = expected.find((row) => row.lineId === part.saleLineId)!;
        if (part.netCents !== delta.netCents || part.taxCents !== delta.taxCents) return null;
        collected.set(part.saleLineId, (collected.get(part.saleLineId) ?? 0n) + part.grossCents);
      }
    }
  } catch {
    return null;
  }
  return {
    version: 1,
    creditPaymentIds: credit.map((payment) => payment.id).sort(),
    creditGrossCents: creditGrossCents.toString(),
    externalGrossCents: externalGrossCents.toString(),
    ...(allowPackage
      ? {
          packagePaymentIds: packages.map((payment) => payment.id).sort(),
          packageGrossCents: packageGrossCents.toString(),
        }
      : {}),
    collections: receipts
      .map((receipt) => ({
        id: receipt.id,
        paymentId: receipt.sourceId,
        allocations: receipt.allocations
          .map((part) => ({
            id: part.id,
            saleLineId: part.saleLineId,
            grossCents: part.grossCents.toString(),
            netCents: part.netCents.toString(),
            taxCents: part.taxCents.toString(),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
