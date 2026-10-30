import { z } from "zod";
import {
  allocatePayrollSplit,
  commissionAttributionSchema,
  commissionSharesSchema,
  payrollBaseLineSchema,
} from "@glampro_suite/shared";
import { conflict, forbidden } from "../lib/http-error.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { allocateCollection } from "../lib/commission-collection.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { loadPayrollValueSpendHistory } from "./payroll-close-value-loader.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { resolvePayrollFocEconomics } from "./payroll-close-foc.js";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";
import { resolvePayrollCloseCash } from "./payroll-close-cash.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const fail = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: VALUE_SALE_ALLOCATION_UNCONFIRMED.");
};
const hash = (value: unknown) =>
  payrollInputHash(
    JSON.parse(
      JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
    ),
  );
const captureSchema = z.object({ lines: z.array(payrollBaseLineSchema) });
const economicsSchema = z.object({
  version: z.literal(1),
  saleId: z.string(),
  saleLineId: z.string(),
  itemId: z.string(),
  itemType: z.enum(["SERVICE", "PRODUCT"]),
  soldAt: z.iso.datetime(),
  netLineAmount: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/),
  originalQuantity: z.number().int().safe().positive(),
  coveredPackageQuantity: z.literal(0),
  category: z.string().nullable(),
});

/** Internal sale-wide evidence, NOT monthly readiness or earnings activation.
 * Supports settled service/product receipts with private, unreversed credit only.
 * No inferred tender-to-line allocation, zero bases, outstanding or package usage. */
export async function loadPayrollValueSaleAllocation(tx: PayrollCloseTransaction, saleId: string) {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Value sale payroll requires a salon-wide authenticated actor.");
  const tenantId = scope.tenantId;
  await lockPrepaid(tx, tenantId);
  await lockCommissionConfiguration(tx, tenantId);
  const actor = await tx.user.findFirst({
    where: { tenantId, id: scope.actorId, disabled: false },
  });
  if (
    !actor ||
    !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole) ||
    (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
  )
    throw forbidden("Value sale payroll is not permitted.");
  const [tenant, sale, payments, redemptions, events, collections, refunds, outstanding, rules] =
    await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      tx.sale.findFirst({ where: { tenantId, id: saleId }, include: { lines: true } }),
      tx.salePayment.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
      tx.customerRedemption.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
      tx.payrollSourceEvent.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
      tx.commissionCollection.findMany({
        where: { tenantId, saleId },
        include: { allocations: { orderBy: { id: "asc" } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      tx.saleRefund.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
      tx.customerOutstandingPayment.findMany({
        where: { tenantId, saleId },
        orderBy: { id: "asc" },
      }),
      tx.commissionRule.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    ]);
  if (
    !sale ||
    sale.tenantId !== tenantId ||
    sale.id !== saleId ||
    sale.status !== "COMPLETED" ||
    sale.voidedAt ||
    sale.collectionCurrency !== "SGD" ||
    !sale.customerId ||
    !sale.outletId ||
    refunds.length ||
    outstanding.length ||
    !sale.lines.length ||
    !redemptions.length ||
    !sale.paidAmount.equals(sale.totalAmount) ||
    sale.lines.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        !["SERVICE", "PRODUCT"].includes(row.itemType) ||
        !Number.isSafeInteger(row.quantity) ||
        row.quantity <= 0,
    ) ||
    redemptions.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        row.customerId !== sale.customerId ||
        row.itemType !== "VALUE_PACKAGE" ||
        !row.holdingId ||
        row.revertedAt ||
        !row.amount?.isPositive() ||
        !row.amount.mul(100).isInteger(),
    ) ||
    payments.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        row.sessionId !== null ||
        row.method === "PACKAGE" ||
        row.amount.isNegative() ||
        !row.amount.mul(100).isInteger(),
    ) ||
    events.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        !["SALE_LINE", "VALUE_SPEND"].includes(row.sourceType),
    ) ||
    [sale.lines, payments, redemptions, events, collections].some(
      (rows) => new Set(rows.map((row) => row.id)).size !== rows.length,
    )
  )
    return fail();
  const cents = (amount: { mul(value: number): { toFixed(places: number): string } }) =>
    BigInt(amount.mul(100).toFixed(0));
  const creditPayments = payments.filter((row) => row.method === "PREPAID_CREDIT");
  const externalPayments = payments.filter(
    (row) => row.method !== "PREPAID_CREDIT" && !row.amount.isZero(),
  );
  const creditCents = creditPayments.reduce((sum, row) => sum + cents(row.amount), 0n);
  const externalCents = externalPayments.reduce((sum, row) => sum + cents(row.amount), 0n);
  const purchaseByLine = new Map(
    sale.lines.map((row) => [
      row.id,
      packagePurchaseValue(
        row.lineTotal.toFixed(2),
        row.voucherDiscountAmount.toFixed(2),
        row.taxAmount.toFixed(2),
      ),
    ]),
  );
  if (
    !creditCents ||
    creditPayments.some((row) => !row.amount.isPositive()) ||
    creditCents !== redemptions.reduce((sum, row) => sum + cents(row.amount!), 0n) ||
    externalCents + creditCents !== cents(sale.totalAmount) ||
    [...purchaseByLine.values()].reduce((sum, row) => sum + row.grossCents, 0n) !==
      cents(sale.totalAmount) ||
    [...purchaseByLine.values()].reduce((sum, row) => sum + row.taxCents, 0n) !==
      cents(sale.taxAmount) ||
    collections.length !== externalPayments.length ||
    new Set(collections.map((row) => `${row.sourceType}:${row.sourceId}`)).size !==
      collections.length
  )
    return fail();

  const histories = [];
  for (const holdingId of [...new Set(redemptions.map((row) => row.holdingId!))].sort())
    histories.push(await loadPayrollValueSpendHistory(tx, holdingId));
  const spendEvents = events.filter((row) => row.sourceType === "VALUE_SPEND");
  if (spendEvents.length !== redemptions.length) return fail();
  for (const redemption of redemptions) {
    const history = histories.find((row) => row.evidence.holding.id === redemption.holdingId)!;
    const originals = history.evidence.redemptions.filter((row) => row.id === redemption.id);
    const captures = history.evidence.related.filter(
      (row) => row.sourceType === "VALUE_SPEND" && row.sourceId === redemption.id,
    );
    const candidate = spendEvents.filter((row) => row.sourceId === redemption.id);
    const usages = history.evidence.usages.filter((row) => row.sale.id === saleId);
    if (
      originals.length !== 1 ||
      hash(originals[0]) !== hash(redemption) ||
      captures.length !== 1 ||
      candidate.length !== 1 ||
      hash(captures[0]) !== hash(candidate[0]) ||
      !history.verified.some((row) => row.redemptionId === redemption.id) ||
      !usages.length ||
      usages.some(
        (row) =>
          hash(row.sale) !== hash(sale) ||
          hash(row.tenders) !== hash(payments) ||
          hash(row.redemptions) !== hash(redemptions),
      )
    )
      return fail();
  }
  const collected = new Map<string, bigint>();
  const net = new Map<string, bigint>();
  const cashAttributions = [];
  const allocations = collections.flatMap((row) => row.allocations);
  if (new Set(allocations.map((row) => row.id)).size !== allocations.length) return fail();
  for (const [index, receipt] of collections.entries()) {
    const matches = externalPayments.filter((row) => row.id === receipt.sourceId);
    if (
      receipt.tenantId !== tenantId ||
      receipt.saleId !== saleId ||
      receipt.currency !== "SGD" ||
      receipt.sourceType !== "SALE_PAYMENT" ||
      matches.length !== 1 ||
      receipt.grossCents !== cents(matches[0].amount) ||
      receipt.occurredAt.getTime() !== matches[0].createdAt.getTime() ||
      receipt.occurredAt < sale.soldAt ||
      receipt.createdAt < receipt.occurredAt ||
      (index > 0 &&
        (receipt.createdAt <= collections[index - 1].createdAt ||
          receipt.occurredAt < collections[index - 1].occurredAt))
    )
      return fail();
    const expected = allocateCollection(
      receipt.grossCents,
      sale.lines.map((line) => ({
        lineId: line.id,
        purchase: purchaseByLine.get(line.id)!,
        collectedGrossCents: collected.get(line.id) ?? 0n,
      })),
      receipt.allocations.map((row) => ({ lineId: row.saleLineId, grossCents: row.grossCents })),
    );
    for (const allocation of receipt.allocations) {
      const delta = expected.find((row) => row.lineId === allocation.saleLineId);
      const line = sale.lines.find((row) => row.id === allocation.saleLineId)!;
      const original = z
        .object({
          version: z.literal(1),
          attributionStatus: z.literal("KNOWN"),
          sellers: commissionSharesSchema,
        })
        .safeParse(allocation.evidence);
      const attribution = commissionAttributionSchema.safeParse(line?.attribution);
      if (
        !delta ||
        allocation.tenantId !== tenantId ||
        allocation.collectionId !== receipt.id ||
        allocation.netCents !== delta.netCents ||
        allocation.taxCents !== delta.taxCents ||
        allocation.grossCents !== allocation.netCents + allocation.taxCents ||
        !original.success ||
        !attribution.success ||
        !attribution.data.sellers ||
        hash(original.data.sellers) !== hash(attribution.data.sellers)
      )
        return fail();
      collected.set(line.id, (collected.get(line.id) ?? 0n) + allocation.grossCents);
      net.set(line.id, (net.get(line.id) ?? 0n) + allocation.netCents);
      cashAttributions.push({
        tenantId,
        allocationId: allocation.id,
        saleLineId: line.id,
        outletId: sale.outletId,
        shares: original.data.sellers,
        evidence: { allocation: allocation.evidence, attribution: line.attribution },
      });
    }
  }
  const ordinary = [];
  for (const line of sale.lines) {
    const purchase = purchaseByLine.get(line.id)!;
    const economics = economicsSchema.safeParse(line.payrollEconomics);
    if (
      !economics.success ||
      economics.data.saleId !== saleId ||
      economics.data.saleLineId !== line.id ||
      economics.data.itemId !== line.itemId ||
      economics.data.itemType !== line.itemType ||
      economics.data.soldAt !== sale.soldAt.toISOString() ||
      economics.data.originalQuantity !== line.quantity ||
      economics.data.netLineAmount !==
        `${purchase.netCents / 100n}.${(purchase.netCents % 100n).toString().padStart(2, "0")}`
    )
      return fail();
    const foc =
      line.itemType === "SERVICE" && purchase.grossCents === 0n
        ? resolvePayrollFocEconomics(line, sale.soldAt)
        : null;
    // No implicit zero when the writer could not establish an external allocation.
    if (!foc && !net.has(line.id)) return fail();
    const candidates = events.filter(
      (row) => row.sourceType === "SALE_LINE" && row.sourceId === line.id,
    );
    if (candidates.length !== 1) return fail();
    const event = candidates[0];
    const captured = captureSchema.safeParse(event.evidence);
    const attribution = commissionAttributionSchema.safeParse(line.attribution);
    if (!captured.success || !attribution.success) return fail();
    const shares =
      line.itemType === "PRODUCT" ? attribution.data.sellers : attribution.data.performers;
    if (!shares) return fail();
    const baseAmount =
      foc?.baseAmount ??
      `${net.get(line.id)! / 100n}.${(net.get(line.id)! % 100n).toString().padStart(2, "0")}00`;
    const bases = allocatePayrollSplit(baseAmount, shares);
    const units = allocatePayrollSplit(`${line.quantity}.0000`, shares);
    if (
      event.sourceKey !== `sale-line:${line.id}` ||
      event.outletId !== sale.outletId ||
      event.occurredAt.getTime() !== sale.soldAt.getTime() ||
      captured.data.lines.length !== bases.length ||
      new Set(captured.data.lines.map((row) => row.staffId)).size !== bases.length ||
      captured.data.lines.some(
        (row) =>
          row.commissionType !== (foc ? "FOC" : line.itemType === "PRODUCT" ? "PRD" : "SVC") ||
          row.mode !== "FOLLOW_PLAN" ||
          row.fixedCommission !== undefined ||
          row.baseAmount !== bases.find((part) => part.staffId === row.staffId)?.amount ||
          row.units !== units.find((part) => part.staffId === row.staffId)?.amount,
      )
    )
      return fail();
    const provenance = verifyOrdinaryPayrollRateProvenance(
      event.evidence,
      { ...line, foc: !!foc },
      event.occurredAt,
      event.createdAt,
      rules,
      tenantId,
    );
    if (provenance.category !== economics.data.category || (foc && purchase.taxCents !== 0n))
      return fail();
    ordinary.push({ saleLineId: line.id, eventId: event.id, baseAmount });
  }
  if (events.length !== ordinary.length + spendEvents.length) return fail();
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: tenant.timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(sale.soldAt);
  const periodKey = ["year", "month"]
    .map((type) => parts.find((row) => row.type === type)!.value)
    .join("-");
  const cash = resolvePayrollCloseCash({
    tenantId,
    timeZone: tenant.timeZone,
    periodKey,
    events: events as Parameters<typeof resolvePayrollCloseCash>[0]["events"],
    lineageEvents: [],
    operations: externalPayments.map((row) => ({
      tenantId,
      sourceType: "SALE_PAYMENT" as const,
      sourceId: row.id,
      saleId,
      currency: "SGD" as const,
      grossCents: cents(row.amount).toString(),
      occurredAt: row.createdAt,
    })),
    collections: collections.map((row) => ({
      ...row,
      sourceType: "SALE_PAYMENT" as const,
      currency: "SGD" as const,
      grossCents: row.grossCents.toString(),
      allocations: row.allocations.map((part) => ({
        ...part,
        itemType: sale.lines.find((line) => line.id === part.saleLineId)!.itemType as
          "SERVICE" | "PRODUCT",
        grossCents: part.grossCents.toString(),
        netCents: part.netCents.toString(),
        taxCents: part.taxCents.toString(),
      })),
    })),
    cashAttributions,
  });
  if (!cash.cash) return fail();
  return {
    earningsActive: false as const,
    ordinary,
    creditPaymentIds: creditPayments.map((row) => row.id),
    cash: cash.cash,
    evidence: {
      sale,
      payments,
      redemptions,
      events,
      collections,
      histories,
      rules,
      cashAttributions,
    },
  };
}
