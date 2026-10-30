import type { Prisma } from "../../generated/prisma/client.js";

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
