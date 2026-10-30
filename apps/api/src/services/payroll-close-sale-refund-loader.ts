import { z } from "zod";
import {
  allocatePayrollSplit,
  commissionAttributionSchema,
  payrollBaseLineSchema,
} from "@glampro_suite/shared";
import { conflict } from "../lib/http-error.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";
import { allocateCollection } from "../lib/commission-collection.js";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";
import { resolvePayrollFocEconomics } from "./payroll-close-foc.js";
import {
  resolvePayrollCloseSaleRefunds,
  type PayrollSaleRefund,
} from "./payroll-close-sale-refunds.js";
import { payrollInputHash } from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const fail = (): never => {
  throw conflict(
    "Authoritative payroll inputs unavailable: REFUND_OR_VOID_WORKFLOW_NOT_LOADED: SALE_REFUND_HISTORY_UNCONFIRMED.",
  );
};
const methods = z.enum(["CASH", "CARD", "PAYNOW", "NETS", "BANK_TRANSFER"]);
const payoutsSchema = z
  .array(z.object({ method: methods, amount: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/) }))
  .min(1);
const cents = (value: string) => BigInt(value.replace(".", ""));
const hash = (value: unknown) => payrollInputHash(JSON.parse(JSON.stringify(value)));

/** Full upfront money-only ordinary refunds, including independently valued FOC
 * service lines and audited zero tenders (which never create collections).
 * No inferred payout, prepaid funding or instalments.
 * Source performers and cash sellers are independent. */
export async function loadPayrollSaleRefund(
  tx: PayrollCloseTransaction,
  input: {
    tenantId: string;
    timeZone: string;
    periodKey: string;
    from: Date;
    to: Date;
    refund: Awaited<ReturnType<PayrollCloseTransaction["saleRefund"]["findMany"]>>[number];
  },
) {
  const { tenantId, refund, from, to } = input;
  const sale = await tx.sale.findFirst({
    where: { tenantId, id: refund.saleId },
    include: { lines: true },
  });
  if (
    !sale ||
    sale.id !== refund.saleId ||
    sale.tenantId !== tenantId ||
    sale.status !== "COMPLETED" ||
    !sale.outletId ||
    sale.collectionCurrency !== "SGD" ||
    refund.tenantId !== tenantId ||
    !refund.refundedById ||
    !refund.reason.trim() ||
    !Number.isFinite(refund.refundedAt.getTime()) ||
    refund.refundedAt < from ||
    refund.refundedAt >= to ||
    !Number.isFinite(sale.soldAt.getTime()) ||
    sale.soldAt > refund.refundedAt ||
    !refund.amount.isPositive() ||
    !refund.amount.equals(sale.totalAmount) ||
    !sale.paidAmount.equals(sale.totalAmount) ||
    !sale.lines.length ||
    new Set(sale.lines.map((line) => line.id)).size !== sale.lines.length ||
    sale.lines.some(
      (line) =>
        line.tenantId !== tenantId ||
        line.saleId !== sale.id ||
        !["SERVICE", "PRODUCT"].includes(line.itemType),
    )
  )
    return fail();
  const [payments, outstanding, redemptions, receipts, events, rules, refunds] = await Promise.all([
    tx.salePayment.findMany({ where: { tenantId, saleId: sale.id }, orderBy: { id: "asc" } }),
    tx.customerOutstanding.findMany({ where: { tenantId, saleId: sale.id } }),
    tx.customerRedemption.findMany({ where: { tenantId, saleId: sale.id } }),
    tx.commissionCollection.findMany({
      where: { tenantId, saleId: sale.id },
      include: { allocations: { orderBy: { id: "asc" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.payrollSourceEvent.findMany({
      where: { tenantId, saleId: sale.id },
      orderBy: { id: "asc" },
    }),
    tx.commissionRule.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    tx.saleRefund.findMany({ where: { tenantId, saleId: sale.id } }),
  ]);
  const collectedPayments = payments.filter((row) => row.amount.greaterThan(0));
  const parsedPayouts = payoutsSchema.safeParse(refund.payouts);
  if (
    outstanding.length ||
    redemptions.length ||
    refunds.length !== 1 ||
    hash(refunds[0]) !== hash(refund) ||
    !parsedPayouts.success ||
    !collectedPayments.length ||
    parsedPayouts.data.some((row) => cents(row.amount) <= 0n) ||
    parsedPayouts.data.reduce((sum, row) => sum + cents(row.amount), 0n) !==
      cents(refund.amount.toFixed(2)) ||
    payments.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== sale.id ||
        row.sessionId !== null ||
        !methods.safeParse(row.method).success ||
        row.amount.isNegative() ||
        !row.amount.mul(100).isInteger() ||
        !Number.isFinite(row.createdAt.getTime()) ||
        row.createdAt < sale.soldAt ||
        row.createdAt > refund.refundedAt,
    ) ||
    !payments
      .reduce((sum, row) => sum.plus(row.amount), refund.amount.minus(refund.amount))
      .equals(refund.amount) ||
    receipts.length !== collectedPayments.length ||
    receipts.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== sale.id ||
        row.currency !== "SGD" ||
        row.sourceType !== "SALE_PAYMENT" ||
        !Number.isFinite(row.occurredAt.getTime()) ||
        !Number.isFinite(row.createdAt.getTime()) ||
        row.createdAt < row.occurredAt ||
        row.createdAt > refund.refundedAt ||
        collectedPayments.filter(
          (payment) =>
            payment.id === row.sourceId &&
            payment.createdAt.getTime() === row.occurredAt.getTime() &&
            payment.amount.mul(100).toFixed(0) === row.grossCents.toString(),
        ).length !== 1,
    ) ||
    new Set(receipts.map((row) => row.id)).size !== receipts.length ||
    new Set(receipts.map((row) => row.sourceId)).size !== collectedPayments.length ||
    events.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== sale.id ||
        row.outletId !== sale.outletId ||
        !["SALE_LINE", "REVERSAL"].includes(row.sourceType),
    ) ||
    events.length !== sale.lines.length * 2
  )
    return fail();

  const allocations: PayrollSaleRefund["allocations"] = [];
  let net = 0n;
  let tax = 0n;
  const operationalAllocations = receipts.flatMap((row) => row.allocations);
  if (
    new Set(operationalAllocations.map((row) => row.id)).size !== operationalAllocations.length ||
    new Set(events.map((row) => row.id)).size !== events.length ||
    new Set(payments.map((row) => row.id)).size !== payments.length
  )
    return fail();
  if (operationalAllocations.some((row) => !sale.lines.some((line) => line.id === row.saleLineId)))
    return fail();
  const collected = new Map<string, bigint>();
  for (const receipt of [...receipts].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  )) {
    const expected = allocateCollection(
      receipt.grossCents,
      sale.lines.map((line) => ({
        lineId: line.id,
        purchase: packagePurchaseValue(
          line.lineTotal.toFixed(2),
          line.voucherDiscountAmount.toFixed(2),
          line.taxAmount.toFixed(2),
        ),
        collectedGrossCents: collected.get(line.id) ?? 0n,
      })),
      receipt.allocations.map((row) => ({ lineId: row.saleLineId, grossCents: row.grossCents })),
    );
    for (const part of receipt.allocations) {
      const allocation = expected.find((row) => row.lineId === part.saleLineId);
      if (
        !allocation ||
        allocation.netCents !== part.netCents ||
        allocation.taxCents !== part.taxCents
      )
        return fail();
      collected.set(part.saleLineId, (collected.get(part.saleLineId) ?? 0n) + part.grossCents);
    }
    if (
      receipt.allocations.reduce((sum, row) => sum + row.grossCents, 0n) !== receipt.grossCents ||
      receipt.allocations.some(
        (row) =>
          row.tenantId !== tenantId ||
          row.collectionId !== receipt.id ||
          row.netCents < 0n ||
          row.taxCents < 0n ||
          row.netCents + row.taxCents !== row.grossCents,
      )
    )
      return fail();
  }
  for (const line of sale.lines) {
    const money = packagePurchaseValue(
      line.lineTotal.toFixed(2),
      line.voucherDiscountAmount.toFixed(2),
      line.taxAmount.toFixed(2),
    );
    const foc =
      line.itemType === "SERVICE" && money.grossCents === 0n
        ? resolvePayrollFocEconomics(line, sale.soldAt, 0)
        : null;
    if (
      (foc ? money.netCents !== 0n || money.taxCents !== 0n : money.netCents <= 0n) ||
      money.taxCents < 0n ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    )
      return fail();
    const attribution = commissionAttributionSchema.safeParse(line.attribution);
    if (!attribution.success || !attribution.data.sellers) return fail();
    const shares =
      line.itemType === "PRODUCT" ? attribution.data.sellers : attribution.data.performers;
    if (!shares) return fail();
    const parts = operationalAllocations.filter((row) => row.saleLineId === line.id);
    if (
      (foc ? parts.length !== 0 : !parts.length) ||
      parts.reduce((sum, row) => sum + row.netCents, 0n) !== money.netCents ||
      parts.reduce((sum, row) => sum + row.taxCents, 0n) !== money.taxCents ||
      parts.reduce((sum, row) => sum + row.grossCents, 0n) !== money.grossCents ||
      parts.some((row) => {
        const evidence = z
          .object({
            version: z.literal(1),
            attributionStatus: z.literal("KNOWN"),
            sellers: z.unknown(),
          })
          .safeParse(row.evidence);
        return !evidence.success || hash(evidence.data.sellers) !== hash(attribution.data.sellers);
      })
    )
      return fail();
    const originals = events.filter(
      (row) => row.sourceType === "SALE_LINE" && row.sourceId === line.id,
    );
    if (originals.length !== 1) return fail();
    const original = originals[0];
    const reversals = events.filter(
      (row) => row.sourceType === "REVERSAL" && row.sourceId === original.id,
    );
    if (reversals.length !== 1) return fail();
    const reversal = reversals[0];
    if (
      original.occurredAt.getTime() !== sale.soldAt.getTime() ||
      original.createdAt > refund.refundedAt ||
      reversal.sourceKey !== `refund:${sale.id}:${original.id}` ||
      reversal.actorId !== refund.refundedById ||
      reversal.reason !== refund.reason ||
      reversal.occurredAt < refund.refundedAt ||
      reversal.occurredAt >= to ||
      reversal.occurredAt < from ||
      reversal.createdAt < reversal.occurredAt
    )
      return fail();
    const captured = z
      .object({ lines: z.array(payrollBaseLineSchema) })
      .safeParse(original.evidence);
    const expected = allocatePayrollSplit(
      foc?.baseAmount ??
        `${money.netCents / 100n}.${(money.netCents % 100n).toString().padStart(2, "0")}00`,
      shares,
    );
    const units = allocatePayrollSplit(`${line.quantity}.0000`, shares);
    if (
      !captured.success ||
      captured.data.lines.length !== expected.length ||
      new Set(captured.data.lines.map((row) => row.staffId)).size !== expected.length ||
      captured.data.lines.some(
        (row) =>
          row.commissionType !== (foc ? "FOC" : line.itemType === "PRODUCT" ? "PRD" : "SVC") ||
          row.mode !== "FOLLOW_PLAN" ||
          row.fixedCommission !== undefined ||
          row.baseAmount !== expected.find((part) => part.staffId === row.staffId)?.amount ||
          row.units !== units.find((part) => part.staffId === row.staffId)?.amount,
      )
    )
      return fail();
    const provenance = verifyOrdinaryPayrollRateProvenance(
      original.evidence,
      { ...line, foc: !!foc },
      original.occurredAt,
      original.createdAt,
      rules,
      tenantId,
    );
    if (foc && provenance.category !== foc.economics.category) return fail();
    allocations.push({
      id: `sale-refund:${refund.id}:${line.id}`,
      saleLineId: line.id,
      originalEventId: original.id,
      reversalEventId: reversal.id,
      itemType: line.itemType as "SERVICE" | "PRODUCT",
      netCents: money.netCents.toString(),
      taxCents: money.taxCents.toString(),
      grossCents: money.grossCents.toString(),
      shares,
      ...(foc && {
        foc: {
          soldAt: sale.soldAt.toISOString(),
          line: {
            id: line.id,
            saleId: line.saleId,
            itemId: line.itemId,
            itemType: "SERVICE" as const,
            quantity: line.quantity,
            payrollEconomics: line.payrollEconomics,
          },
        },
      }),
      cashAttribution: {
        allocations: parts.map((row) => ({
          id: row.id,
          netCents: row.netCents.toString(),
          shares: attribution.data.sellers!,
          evidence: row.evidence,
        })),
        evidence: { sellers: attribution.data.sellers },
      },
      evidence: {
        line: JSON.parse(JSON.stringify(line)),
        collectionAllocationIds: parts.map((row) => row.id),
      },
    });
    net += money.netCents;
    tax += money.taxCents;
  }
  if (net + tax !== cents(refund.amount.toFixed(2)) || tax !== cents(sale.taxAmount.toFixed(2)))
    return fail();
  const normalized: PayrollSaleRefund = {
    id: refund.id,
    tenantId,
    saleId: sale.id,
    outletId: sale.outletId,
    currency: "SGD",
    occurredAt: refund.refundedAt,
    netCents: net.toString(),
    taxCents: tax.toString(),
    grossCents: (net + tax).toString(),
    payouts: parsedPayouts.data.map((row) => ({
      method: row.method,
      grossCents: cents(row.amount).toString(),
    })),
    allocations,
    evidence: JSON.parse(
      JSON.stringify({ refund, sale, payments, receipts }, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ),
  };
  const monthly = events.filter((row) => row.occurredAt >= from && row.occurredAt < to);
  const lineage = events.filter((row) => row.occurredAt < from);
  const result = resolvePayrollCloseSaleRefunds({
    tenantId,
    timeZone: input.timeZone,
    periodKey: input.periodKey,
    events: monthly as Parameters<typeof resolvePayrollCloseSaleRefunds>[0]["events"],
    lineageEvents: lineage as Parameters<typeof resolvePayrollCloseSaleRefunds>[0]["lineageEvents"],
    saleRefunds: [normalized],
  });
  if (!result.reconciliation) return fail();
  return { refund: normalized, events, evidence: normalized.evidence };
}
