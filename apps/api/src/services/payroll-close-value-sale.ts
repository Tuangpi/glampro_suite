import { payrollSessionCreditFunding } from "./payroll-session-credit-funding.js";
import { payrollCreditInstalmentFunding } from "./payroll-credit-instalment-funding.js";
import { loadPayrollSalePackageCoverage } from "./payroll-close-sale-coverage.js";
import { verifyPayrollPackageTenders } from "./payroll-close-package-tender.js";
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
import { loadSaleVoidCashConfirmation } from "./sale-void-cash.js";
import {
  payrollFullCreditFunding,
  payrollMixedCreditFunding,
} from "./payroll-full-credit-funding.js";
import { resolvePayrollCloseSources } from "./payroll-close-sources.js";
import type { PayrollNoCashSaleVoid } from "./payroll-close-voids.js";
import type { PayrollNoCashReversal } from "./payroll-close-reversals.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const fail = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: VALUE_SALE_ALLOCATION_UNCONFIRMED.");
};
/** Names the unsupported M1 path explicitly so the close reports why it refuses
 * instead of falling back to the generic allocation failure. */
const refuse = (code: string): never => {
  throw conflict(`Authoritative payroll inputs unavailable: ${code}.`);
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
  coveredPackageQuantity: z.number().int().safe().nonnegative(),
  category: z.string().nullable(),
  fullCreditFunding: z.unknown().optional(),
  mixedCreditFunding: z.unknown().optional(),
  sessionCreditFunding: z.unknown().optional(),
  instalmentCreditFunding: z.unknown().optional(),
});

/** Internal sale-wide evidence, NOT monthly readiness or earnings activation.
 * Supports settled service/product receipts with ownership/consent-reconciled,
 * active credit or fully evidenced no-cash sale voids.
 * Zero external bases require frozen funding evidence. No inferred tender-to-line
 * allocation or outstanding. Mixed session/credit usage requires independently
 * verified session coverage and prospective funding evidence, including partial
 * lines whose remaining units are funded by credit and explicitly allocated cash. */
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
        include: { outstanding: true },
        orderBy: { id: "asc" },
      }),
      tx.commissionRule.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    ]);
  if (
    !sale ||
    sale.tenantId !== tenantId ||
    sale.id !== saleId ||
    !["COMPLETED", "VOID"].includes(sale.status) ||
    (sale.status === "COMPLETED" && sale.voidedAt !== null) ||
    sale.collectionCurrency !== "SGD" ||
    !sale.customerId ||
    !sale.outletId ||
    refunds.length ||
    !sale.lines.length ||
    !redemptions.length ||
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
        !row.holdingId ||
        (sale.status === "VOID" ? row.revertedAt === null : row.revertedAt !== null) ||
        (row.itemType === "VALUE_PACKAGE" &&
          (!row.amount?.isPositive() || !row.amount.mul(100).isInteger())),
    ) ||
    payments.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        row.sessionId !== null ||
        row.amount.isNegative() ||
        !row.amount.mul(100).isInteger(),
    ) ||
    events.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        ![
          "SALE_LINE",
          "VALUE_SPEND",
          "REDEMPTION",
          "ORDINARY_COLLECTION",
          ...(sale.status === "VOID" ? ["REVERSAL"] : []),
        ].includes(row.sourceType),
    ) ||
    [sale.lines, payments, redemptions, events, collections].some(
      (rows) => new Set(rows.map((row) => row.id)).size !== rows.length,
    )
  )
    return fail();
  // Each tender kind has its own independently verified history. Instalments
  // still require a separate posting/allocation contract.
  if (redemptions.some((row) => !["PACKAGE", "VALUE_PACKAGE"].includes(row.itemType)))
    return fail();
  const creditRedemptions = redemptions.filter((row) => row.itemType === "VALUE_PACKAGE");
  const checkoutCollections = collections.filter((row) => row.sourceType === "SALE_PAYMENT");
  const instalmentFunding = payrollCreditInstalmentFunding(
    sale,
    sale.lines,
    payments,
    checkoutCollections,
  );
  const instalment = !sale.paidAmount.equals(sale.totalAmount);
  if ((instalment && !instalmentFunding) || (!instalment && outstanding.length))
    refuse("VALUE_SALE_INSTALMENT_FUNDING_UNCONFIRMED");
  const sessionCount = redemptions.length - creditRedemptions.length;
  if (instalment && sessionCount) refuse("VALUE_SALE_INSTALMENT_SESSION_COVERAGE_UNCONFIRMED");
  const coverage = sessionCount ? await loadPayrollSalePackageCoverage(tx, saleId, true) : null;
  const packageTender = coverage
    ? verifyPayrollPackageTenders(sale, payments, coverage.lines, sessionCount, true)
    : null;
  const sessionFunding = coverage
    ? payrollSessionCreditFunding(
        sale,
        sale.lines,
        payments,
        collections,
        coverage.lines,
        sessionCount,
      )
    : null;
  if (coverage && !sessionFunding) return fail();
  const cents = (amount: { mul(value: number): { toFixed(places: number): string } }) =>
    BigInt(amount.mul(100).toFixed(0));
  const creditPayments = payments.filter((row) => row.method === "PREPAID_CREDIT");
  const externalPayments = payments.filter(
    (row) => row.method !== "PREPAID_CREDIT" && row.method !== "PACKAGE" && !row.amount.isZero(),
  );
  const creditCents = creditPayments.reduce((sum, row) => sum + cents(row.amount), 0n);
  const externalCents = externalPayments.reduce((sum, row) => sum + cents(row.amount), 0n);
  if (
    outstanding.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        row.customerId !== sale.customerId ||
        row.outstanding.tenantId !== tenantId ||
        row.outstanding.id !== row.outstandingId ||
        row.outstanding.saleId !== saleId ||
        row.outstanding.customerId !== sale.customerId ||
        row.paidAt < sale.soldAt ||
        !row.paidAmount.isPositive() ||
        !row.paidAmount.mul(100).isInteger(),
    )
  )
    return fail();
  const laterCents = outstanding.reduce((sum, row) => sum + cents(row.paidAmount), 0n);
  if (instalment) {
    const debts = await tx.customerOutstanding.findMany({ where: { tenantId, saleId } });
    if (
      debts.length !== 1 ||
      debts[0].customerId !== sale.customerId ||
      !debts[0].unpaidAmount.mul(100).isInteger() ||
      debts[0].unpaidAmount.isNegative() ||
      cents(debts[0].unpaidAmount) + laterCents !== cents(sale.totalAmount.minus(sale.paidAmount))
    )
      return fail();
  }
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
    creditCents !== creditRedemptions.reduce((sum, row) => sum + cents(row.amount!), 0n) ||
    externalCents + creditCents + BigInt(packageTender?.grossCents ?? "0") !==
      cents(instalment ? sale.paidAmount : sale.totalAmount) ||
    [...purchaseByLine.values()].reduce((sum, row) => sum + row.grossCents, 0n) !==
      cents(sale.totalAmount) ||
    [...purchaseByLine.values()].reduce((sum, row) => sum + row.taxCents, 0n) !==
      cents(sale.taxAmount) ||
    collections.length !== externalPayments.length + outstanding.length ||
    new Set(collections.map((row) => `${row.sourceType}:${row.sourceId}`)).size !==
      collections.length
  )
    return fail();

  const histories = [];
  for (const holdingId of [...new Set(creditRedemptions.map((row) => row.holdingId!))].sort())
    histories.push(await loadPayrollValueSpendHistory(tx, holdingId));
  const spendEvents = events.filter((row) => row.sourceType === "VALUE_SPEND");
  if (spendEvents.length !== creditRedemptions.length) return fail();
  for (const redemption of creditRedemptions) {
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
          hash(row.redemptions) !== hash(creditRedemptions),
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
    const matches =
      receipt.sourceType === "SALE_PAYMENT"
        ? externalPayments
            .filter((row) => row.id === receipt.sourceId)
            .map((row) => ({ amount: row.amount, at: row.createdAt }))
        : receipt.sourceType === "OUTSTANDING_PAYMENT"
          ? outstanding
              .filter((row) => row.id === receipt.sourceId)
              .map((row) => ({ amount: row.paidAmount, at: row.paidAt }))
          : [];
    if (
      receipt.tenantId !== tenantId ||
      receipt.saleId !== saleId ||
      receipt.currency !== "SGD" ||
      matches.length !== 1 ||
      receipt.grossCents !== cents(matches[0].amount) ||
      receipt.occurredAt.getTime() !== matches[0].at.getTime() ||
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
      if (receipt.sourceType === "SALE_PAYMENT")
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
  const mixedFunding = payrollMixedCreditFunding(sale, sale.lines, payments, collections);
  const ordinary = [];
  for (const line of sale.lines) {
    if (coverage?.lines.find((row) => row.saleLineId === line.id)?.remainingQuantity === 0) {
      if (events.some((row) => row.sourceType === "SALE_LINE" && row.sourceId === line.id))
        return fail();
      continue;
    }
    const purchase = purchaseByLine.get(line.id)!;
    const coveredQuantity =
      coverage?.lines.find((row) => row.saleLineId === line.id)?.coveredQuantity ?? 0;
    const economics = economicsSchema.safeParse(line.payrollEconomics);
    if (
      !economics.success ||
      economics.data.saleId !== saleId ||
      economics.data.saleLineId !== line.id ||
      economics.data.itemId !== line.itemId ||
      economics.data.itemType !== line.itemType ||
      economics.data.soldAt !== sale.soldAt.toISOString() ||
      economics.data.originalQuantity !== line.quantity ||
      economics.data.coveredPackageQuantity !== coveredQuantity ||
      economics.data.netLineAmount !==
        `${purchase.netCents / 100n}.${(purchase.netCents % 100n).toString().padStart(2, "0")}`
    )
      return fail();
    if (
      (instalmentFunding &&
        hash(instalmentFunding) !== hash(economics.data.instalmentCreditFunding ?? null)) ||
      (!instalmentFunding && economics.data.instalmentCreditFunding !== undefined) ||
      (sessionFunding &&
        hash(sessionFunding) !== hash(economics.data.sessionCreditFunding ?? null)) ||
      (!sessionFunding && economics.data.sessionCreditFunding !== undefined) ||
      (economics.data.mixedCreditFunding !== undefined &&
        (!mixedFunding || hash(mixedFunding) !== hash(economics.data.mixedCreditFunding)))
    )
      return fail();
    const foc =
      line.itemType === "SERVICE" && purchase.grossCents === 0n
        ? resolvePayrollFocEconomics(line, sale.soldAt, coveredQuantity)
        : null;
    // A zero base needs prospective, immutable funding evidence independently
    // matched to the complete operational tender inventory. No legacy inference.
    if (!foc && !net.has(line.id)) {
      const funding = payrollFullCreditFunding(sale, sale.lines, payments);
      const fullConfirmed =
        funding &&
        economics.data.fullCreditFunding &&
        !collections.length &&
        hash(funding) === hash(economics.data.fullCreditFunding);
      const mixedConfirmed =
        mixedFunding &&
        economics.data.mixedCreditFunding &&
        hash(mixedFunding) === hash(economics.data.mixedCreditFunding);
      const sessionConfirmed =
        sessionFunding &&
        economics.data.sessionCreditFunding &&
        hash(sessionFunding) === hash(economics.data.sessionCreditFunding);
      if (!fullConfirmed && !mixedConfirmed && !sessionConfirmed && !instalmentFunding)
        return fail();
      net.set(line.id, 0n);
    }
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
    const units = allocatePayrollSplit(`${line.quantity - coveredQuantity}.0000`, shares);
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
  const laterOperations = [];
  for (const receipt of collections.filter((row) => row.sourceType === "OUTSTANDING_PAYMENT")) {
    for (const allocation of receipt.allocations) {
      const line = sale.lines.find((row) => row.id === allocation.saleLineId);
      const captured = events.filter(
        (row) => row.sourceType === "ORDINARY_COLLECTION" && row.sourceId === allocation.id,
      );
      if (!instalmentFunding || !line || captured.length !== 1) return fail();
      const event = captured[0];
      const parsed = captureSchema.safeParse(event.evidence);
      const attribution = commissionAttributionSchema.parse(line.attribution);
      const shares = line.itemType === "PRODUCT" ? attribution.sellers : attribution.performers;
      if (
        !shares ||
        !parsed.success ||
        event.sourceKey !== `ordinary-collection:${allocation.id}` ||
        event.occurredAt.getTime() !== receipt.occurredAt.getTime() ||
        event.outletId !== sale.outletId
      )
        return fail();
      const bases = allocatePayrollSplit(
        `${allocation.netCents / 100n}.${(allocation.netCents % 100n).toString().padStart(2, "0")}00`,
        shares,
      );
      if (
        parsed.data.lines.length !== bases.length ||
        new Set(parsed.data.lines.map((row) => row.staffId)).size !== bases.length ||
        parsed.data.lines.some(
          (row) =>
            row.commissionType !== (line.itemType === "PRODUCT" ? "PRD" : "SVC") ||
            row.baseAmount !== bases.find((part) => part.staffId === row.staffId)?.amount ||
            row.units !== "0.0000" ||
            row.mode !== "FOLLOW_PLAN" ||
            row.fixedCommission !== undefined,
        )
      )
        return fail();
      verifyOrdinaryPayrollRateProvenance(
        event.evidence,
        line,
        event.occurredAt,
        event.createdAt,
        rules,
        tenantId,
      );
      laterOperations.push({
        tenantId,
        sourceType: "ORDINARY_COLLECTION" as const,
        sourceId: allocation.id,
        saleId,
        outletId: sale.outletId,
        occurredAt: receipt.occurredAt,
        evidence: { receipt, allocation, line },
      });
    }
  }
  if (
    events.filter((row) => row.sourceType === "ORDINARY_COLLECTION").length !==
    laterOperations.length
  )
    return fail();
  const originals = events.filter(
    (row) => !["REVERSAL", "ORDINARY_COLLECTION"].includes(row.sourceType),
  );
  const reversals = events.filter((row) => row.sourceType === "REVERSAL");
  if (originals.length !== ordinary.length + spendEvents.length + sessionCount) return fail();
  const noCashReversals: PayrollNoCashReversal[] = [];
  let noCashSaleVoid: PayrollNoCashSaleVoid | null = null;
  const cashConfirmation =
    sale.status === "VOID" ? await loadSaleVoidCashConfirmation(tx, tenantId, saleId) : null;
  if (cashConfirmation) {
    if (reversals.length !== originals.length || !sale.voidedAt) return fail();
    const ordinaryReversals: PayrollNoCashSaleVoid["reversals"] = [];
    for (const original of originals) {
      const matches = reversals.filter((row) => row.sourceId === original.id);
      if (matches.length !== 1) return fail();
      const reversal = matches[0];
      if (
        reversal.sourceKey !== `void:${saleId}:${original.id}` ||
        reversal.actorId !== sale.voidedById ||
        reversal.reason !== "Source sale voided" ||
        reversal.occurredAt < sale.voidedAt ||
        reversal.occurredAt > new Date(cashConfirmation.confirmation.recordedAt)
      )
        return fail();
      const parts = new Intl.DateTimeFormat("en", {
        timeZone: tenant.timeZone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(reversal.occurredAt);
      const voidParts = new Intl.DateTimeFormat("en", {
        timeZone: tenant.timeZone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(sale.voidedAt);
      // One no-cash sale disposition cannot be split across monthly inventories.
      // Refuse a void transaction crossing a month boundary until posting-date
      // reconciliation explicitly supports it; never drop one of its reversals.
      if (
        ["year", "month"].some(
          (type) =>
            parts.find((part) => part.type === type)?.value !==
            voidParts.find((part) => part.type === type)?.value,
        )
      )
        return fail();
      if (
        !resolvePayrollCloseSources({
          tenantId,
          timeZone: tenant.timeZone,
          periodKey: ["year", "month"]
            .map((type) => parts.find((part) => part.type === type)!.value)
            .join("-"),
          events: [reversal as Parameters<typeof resolvePayrollCloseSources>[0]["events"][number]],
          lineageEvents: [
            original as Parameters<typeof resolvePayrollCloseSources>[0]["events"][number],
          ],
        }).sources
      )
        return fail();
      if (original.sourceType === "VALUE_SPEND") {
        const restored = histories
          .flatMap((history) => history.restorations)
          .filter((row) => row.eventId === original.id && row.reversalEventId === reversal.id);
        if (restored.length !== 1) return fail();
        noCashReversals.push({
          id: restored[0].restorationBalanceId,
          tenantId,
          eventId: reversal.id,
          originalEventId: original.id,
          originalSourceId: original.sourceId,
          originalSourceType: "VALUE_SPEND",
          saleId,
          outletId: sale.outletId,
          occurredAt: reversal.occurredAt,
          currency: "SGD",
          netCents: "0",
          taxCents: "0",
          grossCents: "0",
          evidence: { restoration: restored[0], cashConfirmation },
        });
      } else if (original.sourceType === "SALE_LINE") {
        ordinaryReversals.push({
          eventId: reversal.id,
          originalEventId: original.id,
          originalSourceId: original.sourceId,
          originalSourceType: "SALE_LINE",
        });
      } else return fail();
    }
    if (ordinaryReversals.length)
      noCashSaleVoid = {
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
        reversals: ordinaryReversals,
      };
  } else if (reversals.length) return fail();
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
    // Original collection cash remains in its collection month. Void effects are
    // independently reconciled by the monthly loader in the reversal month.
    events: originals as Parameters<typeof resolvePayrollCloseCash>[0]["events"],
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
    collections: checkoutCollections.map((row) => ({
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
    cashAttributions: cashAttributions.filter((row) =>
      checkoutCollections.some((receipt) =>
        receipt.allocations.some((part) => part.id === row.allocationId),
      ),
    ),
  });
  if (!cash.cash) return fail();
  return {
    earningsActive: false as const,
    ordinary,
    noCashReversals,
    noCashSaleVoid,
    coverage,
    packageTender,
    creditPaymentIds: creditPayments.map((row) => row.id),
    laterOperations,
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
      cashConfirmation,
      outstanding,
    },
  };
}
