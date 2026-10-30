import { conflict, forbidden } from "../lib/http-error.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { allocateCollection } from "../lib/commission-collection.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import {
  verifyPayrollValuePurchase,
  verifyPayrollValueCollection,
} from "./payroll-close-value-purchase.js";
import { verifyPayrollValueSpend } from "./payroll-close-value-spend.js";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";
import { resolvePayrollCloseSources } from "./payroll-close-sources.js";
import { resolvePayrollValueOwnership } from "./payroll-close-value-ownership.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const unavailable = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: VALUE_SPEND_HISTORY_UNCONFIRMED.");
};

/** Internal, non-activating full private holding replay. No caller evidence or
 * paging. Private transfers reconcile; sharing, restorations and refunds still refuse.
 * This alone does not reconcile sale-wide ordinary/prepaid commission allocation. */
export async function loadPayrollValueSpendHistory(tx: PayrollCloseTransaction, holdingId: string) {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Value payroll history requires a salon-wide authenticated actor.");
  const tenantId = scope.tenantId;
  // Same order as POS and transfers: prepaid advisory lock, then tenant lock.
  // The tenant lock alone does not serialize the balance/ownership ledger.
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
    throw forbidden("Value payroll history is not permitted.");
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const holding = await tx.customerValuePackageHolding.findFirst({
    where: { tenantId, id: holdingId },
  });
  if (
    !holding?.saleLineId ||
    holding.tenantId !== tenantId ||
    holding.familyId ||
    holding.sharedFamilyId
  )
    return unavailable();
  const line = await tx.saleLine.findFirst({ where: { tenantId, id: holding.saleLineId } });
  if (!line || line.tenantId !== tenantId || line.itemType !== "VALUE_PACKAGE")
    return unavailable();
  const sale = await tx.sale.findFirst({
    where: { tenantId, id: line.saleId },
    include: { lines: true },
  });
  if (
    !sale ||
    sale.tenantId !== tenantId ||
    sale.status !== "COMPLETED" ||
    sale.collectionCurrency !== "SGD" ||
    !sale.outletId ||
    !sale.customerId
  )
    return unavailable();
  const siblings = await tx.customerValuePackageHolding.findMany({
    where: { tenantId, saleLineId: line.id },
    orderBy: { id: "asc" },
  });
  if (siblings.length !== 1 || siblings[0].id !== holdingId) return unavailable();
  const purchase = verifyPayrollValuePurchase(
    siblings,
    line,
    tenantId,
    packagePurchaseValue(
      line.lineTotal.toFixed(2),
      line.voucherDiscountAmount.toFixed(2),
      line.taxAmount.toFixed(2),
    ).netCents,
  );
  const [
    redemptions,
    balanceEvents,
    transfers,
    receipts,
    payments,
    outstanding,
    events,
    rules,
    refunds,
  ] = await Promise.all([
    tx.customerRedemption.findMany({ where: { tenantId, holdingId }, orderBy: { id: "asc" } }),
    tx.prepaidBalanceEvent.findMany({ where: { tenantId, holdingId }, orderBy: { id: "asc" } }),
    tx.prepaidTransferEvent.findMany({ where: { tenantId, holdingId }, orderBy: { id: "asc" } }),
    tx.commissionCollection.findMany({
      where: { tenantId, saleId: sale.id },
      include: { allocations: { orderBy: { id: "asc" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.salePayment.findMany({ where: { tenantId, saleId: sale.id }, orderBy: { id: "asc" } }),
    tx.customerOutstandingPayment.findMany({
      where: { tenantId, saleId: sale.id },
      include: { outstanding: true },
      orderBy: { id: "asc" },
    }),
    // Whole-salon inventory detects orphan usage captures and reversals.
    tx.payrollSourceEvent.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    tx.commissionRule.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    tx.saleRefund.findMany({ where: { tenantId, saleId: sale.id }, orderBy: { id: "asc" } }),
  ]);
  if (
    refunds.length ||
    new Set(redemptions.map((row) => row.id)).size !== redemptions.length ||
    redemptions.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.holdingId !== holdingId ||
        row.itemType !== "VALUE_PACKAGE" ||
        row.revertedAt !== null,
    ) ||
    events.some((row) => row.tenantId !== tenantId) ||
    new Set(events.map((row) => row.id)).size !== events.length
  )
    return unavailable();
  const redemptionIds = new Set(redemptions.map((row) => row.id));
  const allocationIds = new Set(receipts.flatMap((row) => row.allocations.map((part) => part.id)));
  const related = events.filter(
    (row) =>
      row.sourceId === holdingId ||
      redemptionIds.has(row.sourceId) ||
      allocationIds.has(row.sourceId),
  );
  const relatedIds = new Set(related.map((row) => row.id));
  if (
    related.some((row) => !["COLLECTION", "VALUE_SPEND"].includes(row.sourceType)) ||
    events.some((row) => row.sourceType === "REVERSAL" && relatedIds.has(row.sourceId))
  )
    return unavailable();
  const paymentFacts = [
    ...payments
      .filter((row) => !row.amount.isZero())
      .map((row) => {
        if (
          row.tenantId !== tenantId ||
          row.saleId !== sale.id ||
          row.sessionId !== null ||
          ["PACKAGE", "PREPAID_CREDIT"].includes(row.method) ||
          row.amount.isNegative() ||
          !row.amount.mul(100).isInteger()
        )
          return unavailable();
        return {
          sourceType: "SALE_PAYMENT",
          sourceId: row.id,
          at: row.createdAt,
          cents: row.amount.mul(100).toFixed(0),
        };
      }),
    ...outstanding
      .filter((row) => !row.paidAmount.isZero())
      .map((row) => {
        if (
          row.tenantId !== tenantId ||
          row.saleId !== sale.id ||
          row.customerId !== sale.customerId ||
          row.outstandingId !== row.outstanding.id ||
          row.outstanding.tenantId !== tenantId ||
          row.outstanding.saleId !== sale.id ||
          row.outstanding.customerId !== sale.customerId ||
          row.paidAmount.isNegative() ||
          !row.paidAmount.mul(100).isInteger()
        )
          return unavailable();
        return {
          sourceType: "OUTSTANDING_PAYMENT",
          sourceId: row.id,
          at: row.paidAt,
          cents: row.paidAmount.mul(100).toFixed(0),
        };
      }),
  ];
  if (
    paymentFacts.length !== receipts.length ||
    new Set(paymentFacts.map((row) => `${row.sourceType}:${row.sourceId}`)).size !==
      paymentFacts.length ||
    new Set(receipts.map((row) => `${row.sourceType}:${row.sourceId}`)).size !== receipts.length
  )
    return unavailable();
  const collected = new Map<string, bigint>();
  let valueReceiptCount = 0;
  const verifySource = (event: (typeof events)[number]) => {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: tenant.timeZone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(event.occurredAt);
    if (
      !resolvePayrollCloseSources({
        tenantId,
        timeZone: tenant.timeZone,
        periodKey: ["year", "month"]
          .map((type) => parts.find((row) => row.type === type)!.value)
          .join("-"),
        events: [event as Parameters<typeof resolvePayrollCloseSources>[0]["events"][number]],
        lineageEvents: [],
      }).sources
    )
      return unavailable();
  };
  for (const [index, receipt] of receipts.entries()) {
    const matches = paymentFacts.filter(
      (row) => row.sourceType === receipt.sourceType && row.sourceId === receipt.sourceId,
    );
    if (
      receipt.tenantId !== tenantId ||
      receipt.saleId !== sale.id ||
      receipt.currency !== "SGD" ||
      !receipt.grossCents ||
      receipt.occurredAt < sale.soldAt ||
      receipt.createdAt < receipt.occurredAt ||
      (index > 0 &&
        (receipt.createdAt <= receipts[index - 1].createdAt ||
          receipt.occurredAt < receipts[index - 1].occurredAt)) ||
      matches.length !== 1 ||
      matches[0].at.getTime() !== receipt.occurredAt.getTime() ||
      matches[0].cents !== receipt.grossCents.toString()
    )
      return unavailable();
    const expected = allocateCollection(
      receipt.grossCents,
      sale.lines.map((row) => ({
        lineId: row.id,
        purchase: packagePurchaseValue(
          row.lineTotal.toFixed(2),
          row.voucherDiscountAmount.toFixed(2),
          row.taxAmount.toFixed(2),
        ),
        collectedGrossCents: collected.get(row.id) ?? 0n,
      })),
      receipt.allocations.map((row) => ({ lineId: row.saleLineId, grossCents: row.grossCents })),
    );
    for (const allocation of receipt.allocations) {
      const delta = expected.find((row) => row.lineId === allocation.saleLineId);
      if (
        allocation.tenantId !== tenantId ||
        allocation.collectionId !== receipt.id ||
        !delta ||
        allocation.netCents !== delta.netCents ||
        allocation.taxCents !== delta.taxCents ||
        allocation.grossCents !== allocation.netCents + allocation.taxCents
      )
        return unavailable();
      collected.set(
        allocation.saleLineId,
        (collected.get(allocation.saleLineId) ?? 0n) + allocation.grossCents,
      );
      if (allocation.saleLineId !== line.id) continue;
      const captures = related.filter(
        (row) => row.sourceType === "COLLECTION" && row.sourceId === allocation.id,
      );
      if (captures.length !== 1) return unavailable();
      const event = captures[0];
      if (
        event.saleId !== sale.id ||
        event.outletId !== sale.outletId ||
        event.sourceKey !== `collection:${allocation.id}` ||
        event.occurredAt.getTime() !== receipt.occurredAt.getTime()
      )
        return unavailable();
      verifySource(event);
      verifyPayrollValueCollection(
        event.evidence,
        allocation.netCents,
        valueReceiptCount++ === 0 ? `${line.quantity}.0000` : "0.0000",
        purchase.sellers,
      );
      if (
        verifyOrdinaryPayrollRateProvenance(
          event.evidence,
          line,
          event.occurredAt,
          event.createdAt,
          rules,
          tenantId,
        ).category !== null
      )
        return unavailable();
    }
  }
  if (!valueReceiptCount) return unavailable();
  // The database balance ledger is independent of captures. Start at an actual
  // prospective GRANT, never legacy OPENING, and consume every SPEND exactly once.
  if (
    new Set(balanceEvents.map((row) => row.id)).size !== balanceEvents.length ||
    balanceEvents.length !== redemptions.length + transfers.length + 1 ||
    balanceEvents.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.holdingId !== holdingId ||
        row.sharedFamilyId !== null ||
        row.previousSharedFamilyId !== null ||
        (row.expiresAt?.getTime() ?? null) !== (holding.expiresAt?.getTime() ?? null) ||
        !row.delta.equals(row.amountAfter.minus(row.amountBefore)) ||
        !["GRANT", "SPEND", "TRANSFER"].includes(row.kind),
    )
  )
    return unavailable();
  const spendOwners = resolvePayrollValueOwnership({
    tenantId,
    holdingId,
    originalCustomerId: sale.customerId!,
    customerId: holding.customerId,
    amount: holding.amount,
    amountRemaining: holding.amountRemaining,
    expiresAt: holding.expiresAt,
    balances: balanceEvents,
    transfers,
  });
  const grants = balanceEvents.filter((row) => row.kind === "GRANT");
  if (
    grants.length !== 1 ||
    !grants[0].amountBefore.isZero() ||
    !grants[0].amountAfter.equals(purchase.credit) ||
    grants[0].previousCustomerId !== null ||
    grants[0].createdAt > holding.createdAt ||
    grants[0].saleId !== sale.id
  )
    return unavailable();
  // Ledger timestamps are transaction-start times, while Prisma holding writes
  // and payroll captures use wall-clock append times. They need not be equal.
  let remaining = holding.amount;
  const pending = redemptions.slice();
  const usedBalanceIds = new Set<string>([grants[0].id]);
  const usages = [];
  const verified: ReturnType<typeof verifyPayrollValueSpend>[] = [];
  const usageSaleIds = new Set(redemptions.map((row) => row.saleId));
  for (const event of events.filter(
    (row) =>
      row.sourceType === "VALUE_SPEND" &&
      usageSaleIds.has(row.saleId) &&
      !redemptionIds.has(row.sourceId) &&
      (row.evidence as { itemId?: string } | null)?.itemId === holding.valuePackageId,
  )) {
    // A receipt may spend two distinct holdings of the same catalogue package.
    // Catalogue identity alone cannot classify the sibling spend as an orphan.
    const sibling = await tx.customerRedemption.findFirst({
      where: { tenantId, id: event.sourceId, saleId: event.saleId, itemType: "VALUE_PACKAGE" },
    });
    if (
      !sibling?.holdingId ||
      sibling.tenantId !== tenantId ||
      sibling.saleId !== event.saleId ||
      sibling.itemType !== "VALUE_PACKAGE" ||
      sibling.holdingId === holdingId ||
      sibling.itemId !== holding.valuePackageId ||
      sibling.revertedAt ||
      sibling.usedAt.getTime() !== event.occurredAt.getTime()
    )
      return unavailable();
  }
  while (pending.length) {
    const candidates = pending.filter((row) => {
      const event = related.find(
        (event) => event.sourceType === "VALUE_SPEND" && event.sourceId === row.id,
      );
      const source = (event?.evidence as { sourceSnapshot?: { spentBefore?: string } } | undefined)
        ?.sourceSnapshot;
      return source?.spentBefore === holding.amount.minus(remaining).toFixed(2);
    });
    if (candidates.length !== 1) return unavailable();
    const redemption = candidates[0];
    const captures = related.filter(
      (row) => row.sourceType === "VALUE_SPEND" && row.sourceId === redemption.id,
    );
    if (
      captures.length !== 1 ||
      !redemption.amount?.isPositive() ||
      redemption.amount.greaterThan(remaining)
    )
      return unavailable();
    const event = captures[0];
    const changes = balanceEvents.filter(
      (row) =>
        !usedBalanceIds.has(row.id) &&
        row.kind === "SPEND" &&
        row.saleId === redemption.saleId &&
        spendOwners.get(row.id) === redemption.customerId &&
        row.amountBefore.equals(remaining) &&
        row.delta.equals(redemption.amount!.negated()) &&
        row.createdAt <= event.createdAt,
    );
    if (changes.length !== 1) return unavailable();
    if (redemption.usedAt < sale.soldAt || changes[0].createdAt < grants[0].createdAt)
      return unavailable();
    const usage = await tx.sale.findFirst({
      where: { tenantId, id: redemption.saleId },
      include: { lines: true },
    });
    if (!usage) return unavailable();
    const [tenders, usageRefunds] = await Promise.all([
      tx.salePayment.findMany({ where: { tenantId, saleId: usage.id }, orderBy: { id: "asc" } }),
      tx.saleRefund.findMany({ where: { tenantId, saleId: usage.id }, orderBy: { id: "asc" } }),
    ]);
    if (
      usageRefunds.length ||
      tenders.some((row) => row.tenantId !== tenantId || row.saleId !== usage.id)
    )
      return unavailable();
    const usageRedemptions = await tx.customerRedemption.findMany({
      where: { tenantId, saleId: usage.id, itemType: "VALUE_PACKAGE" },
      orderBy: { id: "asc" },
    });
    const creditTenders = tenders.filter((row) => row.method === "PREPAID_CREDIT");
    if (
      creditTenders.some(
        (row) =>
          row.sessionId !== null || !row.amount.isPositive() || !row.amount.mul(100).isInteger(),
      ) ||
      usageRedemptions.some(
        (row) =>
          row.tenantId !== tenantId ||
          row.saleId !== usage.id ||
          !row.amount?.isPositive() ||
          !row.amount.mul(100).isInteger() ||
          row.revertedAt !== null,
      ) ||
      !usageRedemptions.some((row) => row.id === redemption.id) ||
      !creditTenders.length ||
      creditTenders.reduce((sum, row) => sum + BigInt(row.amount.mul(100).toFixed(0)), 0n) !==
        usageRedemptions.reduce((sum, row) => sum + BigInt(row.amount!.mul(100).toFixed(0)), 0n)
    )
      return unavailable();
    verified.push(
      verifyPayrollValueSpend({
        tenantId,
        timeZone: tenant.timeZone,
        purchase,
        spentBefore: holding.amount.minus(remaining).toFixed(2),
        holding: { ...holding, customerId: spendOwners.get(changes[0].id)! },
        redemption,
        sale: usage,
        event: event as Parameters<typeof verifyPayrollValueSpend>[0]["event"],
        rules,
      }),
    );
    if (
      verified.length > 1 &&
      redemption.usedAt <
        redemptions.find((row) => row.id === verified[verified.length - 2].redemptionId)!.usedAt
    )
      return unavailable();
    usedBalanceIds.add(changes[0].id);
    remaining = remaining.minus(redemption.amount);
    pending.splice(
      pending.findIndex((row) => row.id === redemption.id),
      1,
    );
    usages.push({ sale: usage, tenders, redemptions: usageRedemptions });
  }
  if (
    !remaining.equals(holding.amountRemaining) ||
    usedBalanceIds.size + transfers.length !== balanceEvents.length ||
    related.filter((row) => row.sourceType === "VALUE_SPEND").length !== redemptions.length
  )
    return unavailable();
  return {
    verified,
    evidence: {
      tenant,
      holding,
      sale,
      line,
      purchase,
      redemptions,
      balanceEvents,
      transfers,
      receipts,
      payments,
      outstanding,
      related,
      rules,
      usages,
    },
  };
}
