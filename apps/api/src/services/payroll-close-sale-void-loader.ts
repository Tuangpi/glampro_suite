import { z } from "zod";
import {
  allocatePayrollSplit,
  commissionAttributionSchema,
  payrollBaseLineSchema,
} from "@glampro_suite/shared";
import { conflict } from "../lib/http-error.js";
import { loadSaleVoidCashConfirmation } from "./sale-void-cash.js";
import { resolvePayrollFocEconomics } from "./payroll-close-foc.js";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";
import { resolvePayrollCloseVoids, type PayrollNoCashSaleVoid } from "./payroll-close-voids.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const fail = (): never => {
  throw conflict(
    "Authoritative payroll inputs unavailable: REFUND_OR_VOID_WORKFLOW_NOT_LOADED: ORDINARY_VOID_HISTORY_UNCONFIRMED.",
  );
};
const month = (at: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  return ["year", "month"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
};

type VoidSale = NonNullable<Awaited<ReturnType<PayrollCloseTransaction["sale"]["findFirst"]>>>;
type VoidLine = Awaited<ReturnType<PayrollCloseTransaction["saleLine"]["findMany"]>>[number];
type VoidEvent = Awaited<
  ReturnType<PayrollCloseTransaction["payrollSourceEvent"]["findMany"]>
>[number];
type VoidRule = Awaited<ReturnType<PayrollCloseTransaction["commissionRule"]["findMany"]>>[number];

/** Shared original economics check for ordinary-only and mixed purchase voids.
 * Cash seller attribution is verified separately from commission performers. */
export function verifyPayrollOrdinaryVoidLine(
  line: VoidLine,
  soldAt: VoidSale["soldAt"],
  original: VoidEvent,
  rules: VoidRule[],
  tenantId: string,
) {
  if (
    !["SERVICE", "PRODUCT"].includes(line.itemType) ||
    !Number.isSafeInteger(line.quantity) ||
    line.quantity <= 0
  )
    return fail();
  const gross = line.lineTotal.minus(line.voucherDiscountAmount);
  const foc = gross.isZero() ? resolvePayrollFocEconomics(line, soldAt, 0) : null;
  if (
    gross.isNegative() ||
    line.taxAmount.isNegative() ||
    line.taxAmount.greaterThan(gross) ||
    (foc && !line.taxAmount.isZero())
  )
    return fail();
  const attribution = commissionAttributionSchema.safeParse(line.attribution);
  if (!attribution.success) return fail();
  const shares =
    line.itemType === "PRODUCT" ? attribution.data.sellers : attribution.data.performers;
  if (!shares) return fail();
  const expected = allocatePayrollSplit(
    foc?.baseAmount ?? gross.minus(line.taxAmount).toFixed(4),
    shares,
  );
  const units = allocatePayrollSplit(`${line.quantity}.0000`, shares);
  const capture = z.object({ lines: z.array(payrollBaseLineSchema) }).safeParse(original.evidence);
  if (
    !capture.success ||
    capture.data.lines.length !== expected.length ||
    new Set(capture.data.lines.map((part) => part.staffId)).size !== expected.length ||
    capture.data.lines.some(
      (part) =>
        part.mode !== "FOLLOW_PLAN" ||
        part.fixedCommission !== undefined ||
        part.commissionType !== (foc ? "FOC" : line.itemType === "PRODUCT" ? "PRD" : "SVC") ||
        part.baseAmount !== expected.find((row) => row.staffId === part.staffId)?.amount ||
        part.units !== units.find((row) => row.staffId === part.staffId)?.amount,
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
}

/** Ordinary-only operational voids with explicit no-movement attestation. No
 * inferred payout or prepaid restoration, and no current-rate/attribution fallback. */
export async function loadPayrollOrdinarySaleVoid(
  tx: PayrollCloseTransaction,
  tenantId: string,
  saleId: string,
  timeZone: string,
) {
  const [sale, payments, redemptions, events, rules] = await Promise.all([
    tx.sale.findFirst({
      where: { tenantId, id: saleId },
      include: { lines: { orderBy: { id: "asc" } } },
    }),
    tx.salePayment.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.customerRedemption.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.payrollSourceEvent.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.commissionRule.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
  ]);
  if (
    !sale ||
    sale.tenantId !== tenantId ||
    sale.status !== "VOID" ||
    !sale.outletId ||
    sale.collectionCurrency !== "SGD" ||
    !sale.voidedAt ||
    !Number.isFinite(sale.voidedAt.getTime()) ||
    !sale.voidedById ||
    !sale.voidReason?.trim() ||
    !Number.isFinite(sale.soldAt.getTime()) ||
    sale.soldAt > sale.voidedAt ||
    !sale.lines.length ||
    new Set(sale.lines.map((line) => line.id)).size !== sale.lines.length ||
    redemptions.length ||
    sale.lines.some(
      (line) =>
        line.tenantId !== tenantId ||
        line.saleId !== saleId ||
        !["SERVICE", "PRODUCT"].includes(line.itemType),
    ) ||
    payments.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        row.sessionId !== null ||
        !["CASH", "CARD", "PAYNOW", "NETS", "BANK_TRANSFER"].includes(row.method) ||
        row.amount.isNegative() ||
        !row.amount.mul(100).isInteger() ||
        !Number.isFinite(row.createdAt.getTime()) ||
        row.createdAt < sale.soldAt ||
        row.createdAt > sale.voidedAt!,
    ) ||
    new Set(payments.map((row) => row.id)).size !== payments.length ||
    new Set(events.map((row) => row.id)).size !== events.length ||
    events.length !== sale.lines.length * 2 ||
    events.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        row.outletId !== sale.outletId ||
        !["SALE_LINE", "REVERSAL"].includes(row.sourceType),
    )
  )
    return fail();
  const cashConfirmation = await loadSaleVoidCashConfirmation(tx, tenantId, saleId);
  const periodKey = month(sale.voidedAt, timeZone);
  const reversals: PayrollNoCashSaleVoid["reversals"] = [];
  for (const line of sale.lines) {
    const originals = events.filter(
      (row) => row.sourceType === "SALE_LINE" && row.sourceId === line.id,
    );
    if (originals.length !== 1 || line.quantity <= 0) return fail();
    const original = originals[0];
    const reversed = events.filter(
      (row) => row.sourceType === "REVERSAL" && row.sourceId === original.id,
    );
    if (reversed.length !== 1) return fail();
    const reversal = reversed[0];
    if (
      original.occurredAt.getTime() !== sale.soldAt.getTime() ||
      original.createdAt > sale.voidedAt ||
      reversal.sourceKey !== `void:${saleId}:${original.id}` ||
      reversal.actorId !== sale.voidedById ||
      reversal.reason !== "Source sale voided" ||
      reversal.occurredAt < sale.voidedAt ||
      reversal.occurredAt > new Date(cashConfirmation.confirmation.recordedAt) ||
      month(reversal.occurredAt, timeZone) !== periodKey
    )
      return fail();
    verifyPayrollOrdinaryVoidLine(line, sale.soldAt, original, rules, tenantId);
    reversals.push({
      eventId: reversal.id,
      originalEventId: original.id,
      originalSourceId: line.id,
      originalSourceType: "SALE_LINE",
    });
  }
  const noCashSaleVoid: PayrollNoCashSaleVoid = {
    id: cashConfirmation.audit.id,
    tenantId,
    saleId,
    outletId: sale.outletId,
    occurredAt: sale.voidedAt,
    currency: "SGD",
    cashDisposition: "NO_MOVEMENT",
    netCents: "0",
    taxCents: "0",
    grossCents: "0",
    evidence: cashConfirmation,
    reversals,
  };
  const current = events.filter((row) => month(row.occurredAt, timeZone) === periodKey);
  const lineage = events.filter((row) => month(row.occurredAt, timeZone) !== periodKey);
  const result = resolvePayrollCloseVoids({
    tenantId,
    timeZone,
    periodKey,
    events: current as Parameters<typeof resolvePayrollCloseVoids>[0]["events"],
    lineageEvents: lineage as Parameters<typeof resolvePayrollCloseVoids>[0]["lineageEvents"],
    noCashSaleVoids: [noCashSaleVoid],
  });
  if (!result.reconciliation) return fail();
  return { sale, events, noCashSaleVoid, evidence: cashConfirmation };
}
