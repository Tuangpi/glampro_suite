import { loadPayrollPrepaidSettlement } from "./payroll-close-prepaid-settlement.js";
import { Prisma } from "../../generated/prisma/client.js";
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
import { verifyPayrollValueRestoration } from "./payroll-close-value-restoration.js";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";
import { resolvePayrollCloseSources } from "./payroll-close-sources.js";
import { replayPayrollValueOwnership } from "./payroll-close-value-ownership.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const unavailable = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: VALUE_SPEND_HISTORY_UNCONFIRMED.");
};

/** Internal, non-activating full holding replay. No caller evidence or
 * paging. Transfers, explicit sharing and evidenced void restorations reconcile;
 * purchase refunds and purchase voids still refuse.
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
  if (!holding?.saleLineId || holding.tenantId !== tenantId || holding.familyId)
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
        row.itemType !== "VALUE_PACKAGE",
    ) ||
    events.some((row) => row.tenantId !== tenantId) ||
    new Set(events.map((row) => row.id)).size !== events.length
  )
    return unavailable();
  const redemptionIds = new Set(redemptions.map((row) => row.id));
  const allocationIds = new Set(receipts.flatMap((row) => row.allocations.map((part) => part.id)));
  const originals = events.filter(
    (row) =>
      row.sourceId === holdingId ||
      redemptionIds.has(row.sourceId) ||
      allocationIds.has(row.sourceId),
  );
  const refundEvents = originals.filter((row) => row.sourceType === "VALUE_PACKAGE_REFUND");
  if (refundEvents.length > 1) return unavailable();
  const refund = refundEvents.length
    ? await loadPayrollPrepaidSettlement(tx, {
        tenantId,
        holding,
        event: refundEvents[0],
        timeZone: tenant.timeZone,
      })
    : null;
  if (
    refund &&
    (!holding.amountRemaining.isZero() || holding.updatedBy !== refund.settlement.actorId)
  )
    return unavailable();
  const preRemaining = refund
    ? new Prisma.Decimal(String(refund.preHolding.amountRemaining))
    : holding.amountRemaining;
  const cancellationRows =
    refund && preRemaining.isPositive()
      ? balanceEvents.filter(
          (row) =>
            row.kind === "SPEND" &&
            row.saleId === refund.event.saleId &&
            row.actorId === refund.settlement.actorId &&
            row.reason === refund.settlement.reason &&
            row.amountBefore.equals(preRemaining) &&
            row.amountAfter.isZero() &&
            row.customerId === holding.customerId &&
            row.previousCustomerId === holding.customerId &&
            row.sharedFamilyId === holding.sharedFamilyId &&
            row.previousSharedFamilyId === holding.sharedFamilyId &&
            (row.expiresAt?.getTime() ?? null) === (holding.expiresAt?.getTime() ?? null) &&
            row.createdAt <= refund.event.occurredAt &&
            row.delta.equals(preRemaining.negated()),
        )
      : [];
  if (refund && cancellationRows.length !== (preRemaining.isPositive() ? 1 : 0))
    return unavailable();
  const historyBalances = balanceEvents.filter(
    (row) => !cancellationRows.some((entry) => entry.id === row.id),
  );
  if (
    refund &&
    (redemptions.some(
      (row) =>
        row.usedAt >= refund.event.occurredAt ||
        (row.revertedAt !== null && row.revertedAt >= refund.event.occurredAt),
    ) ||
      historyBalances.some((row) => row.createdAt > refund.event.occurredAt))
  )
    return unavailable();
  const originalIds = new Set(originals.map((row) => row.id));
  const reversals = events.filter(
    (row) => row.sourceType === "REVERSAL" && originalIds.has(row.sourceId),
  );
  const related = [...originals, ...reversals];
  const reversalIds = new Set(reversals.map((row) => row.id));
  if (
    originals.some(
      (row) =>
        !["COLLECTION", "VALUE_SPEND", ...(refund ? ["VALUE_PACKAGE_REFUND"] : [])].includes(
          row.sourceType,
        ),
    ) ||
    reversals.some(
      (row) =>
        originals.find((original) => original.id === row.sourceId)?.sourceType !== "VALUE_SPEND",
    ) ||
    events.some((row) => row.sourceType === "REVERSAL" && reversalIds.has(row.sourceId))
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
  const customerIds = [
    ...new Set([
      sale.customerId!,
      holding.customerId,
      ...historyBalances.flatMap((row) => [
        row.customerId,
        ...(row.previousCustomerId ? [row.previousCustomerId] : []),
      ]),
      ...redemptions.map((row) => row.customerId),
    ]),
  ].sort();
  const [members, membershipEvents] = await Promise.all([
    tx.prepaidFamilyMember.findMany({
      where: { tenantId, customerId: { in: customerIds } },
      orderBy: { id: "asc" },
    }),
    tx.prepaidFamilyEvent.findMany({
      where: { tenantId, customerId: { in: customerIds } },
      orderBy: { id: "asc" },
    }),
  ]);
  const familyIds = [
    ...new Set(
      [
        ...members.map((row) => row.familyId),
        ...membershipEvents.flatMap((row) => [row.fromFamilyId, row.toFamilyId]),
        ...historyBalances.flatMap((row) => [row.sharedFamilyId, row.previousSharedFamilyId]),
      ].filter((id): id is string => id !== null),
    ),
  ].sort();
  const families = await tx.prepaidFamily.findMany({
    where: { tenantId, id: { in: familyIds } },
    orderBy: { id: "asc" },
  });
  const sharing = { customerIds, members, events: membershipEvents, families };
  // The database balance ledger is independent of captures. Start at an actual
  // prospective GRANT, never legacy OPENING, and consume every SPEND exactly once.
  if (
    new Set(historyBalances.map((row) => row.id)).size !== historyBalances.length ||
    historyBalances.length !==
      redemptions.length +
        redemptions.filter((row) => row.revertedAt !== null).length +
        transfers.length +
        historyBalances.filter((row) => row.kind === "SHARING").length +
        historyBalances.filter((row) => row.kind === "EXPIRY_CHANGE").length +
        1 ||
    historyBalances.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.holdingId !== holdingId ||
        !row.delta.equals(row.amountAfter.minus(row.amountBefore)) ||
        !["GRANT", "SPEND", "RESTORE", "TRANSFER", "SHARING", "EXPIRY_CHANGE"].includes(row.kind),
    )
  )
    return unavailable();
  const { owners: spendOwners, expiresAtByBalanceId } = replayPayrollValueOwnership({
    tenantId,
    holdingId,
    originalCustomerId: sale.customerId!,
    customerId: holding.customerId,
    amount: holding.amount,
    amountRemaining: preRemaining,
    expiresAt: holding.expiresAt,
    balances: historyBalances,
    transfers,
    sharedFamilyId: holding.sharedFamilyId,
    sharing,
    redemptions,
  });
  const grants = historyBalances.filter((row) => row.kind === "GRANT");
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
  const usedBalanceIds = new Set<string>([grants[0].id]);
  const usages = [];
  const verified: ReturnType<typeof verifyPayrollValueSpend>[] = [];
  const restorations: ReturnType<typeof verifyPayrollValueRestoration>[] = [];
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
      sibling.usedAt.getTime() !== event.occurredAt.getTime()
    )
      return unavailable();
  }
  // Ownership replay determines order from independent operational balance facts,
  // not captured spentBefore (which repeats after a restoration).
  for (const [balanceId, customerId] of spendOwners) {
    const balance = historyBalances.find((row) => row.id === balanceId)!;
    if (!balance.amountBefore.equals(remaining)) return unavailable();
    if (balance.kind === "RESTORE") {
      if (!restorations.some((row) => row.restorationBalanceId === balance.id))
        return unavailable();
      remaining = balance.amountAfter;
      usedBalanceIds.add(balance.id);
      continue;
    }
    const candidates = redemptions.filter(
      (row) =>
        row.saleId === balance.saleId &&
        row.customerId === customerId &&
        row.amount?.equals(balance.delta.negated()) &&
        !verified.some((source) => source.redemptionId === row.id),
    );
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
    const changes = historyBalances.filter(
      (row) =>
        !usedBalanceIds.has(row.id) &&
        row.id === balanceId &&
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
          (usage.status === "VOID" ? row.revertedAt === null : row.revertedAt !== null),
      ) ||
      !usageRedemptions.some((row) => row.id === redemption.id) ||
      !creditTenders.length ||
      creditTenders.reduce((sum, row) => sum + BigInt(row.amount.mul(100).toFixed(0)), 0n) !==
        usageRedemptions.reduce((sum, row) => sum + BigInt(row.amount!.mul(100).toFixed(0)), 0n)
    )
      return unavailable();
    const spend = {
      tenantId,
      timeZone: tenant.timeZone,
      purchase,
      spentBefore: holding.amount.minus(remaining).toFixed(2),
      holding: { ...holding, customerId, expiresAt: expiresAtByBalanceId.get(balanceId)! },
      redemption,
      sale: usage,
      event: event as Parameters<typeof verifyPayrollValueSpend>[0]["event"],
      rules,
    };
    const sourceReversals = reversals.filter((row) => row.sourceId === event.id);
    if (redemption.revertedAt) {
      const restores = historyBalances.filter(
        (row) => row.kind === "RESTORE" && row.saleId === usage.id,
      );
      if (restores.length !== 1 || !expiresAtByBalanceId.has(restores[0].id)) return unavailable();
      const restoration = verifyPayrollValueRestoration({
        spend,
        balances: historyBalances,
        reversals: sourceReversals,
        refundIds: usageRefunds.map((row) => row.id),
        restorationExpiresAt: expiresAtByBalanceId.get(restores[0].id)!,
      });
      restorations.push(restoration);
      verified.push(restoration);
    } else {
      if (sourceReversals.length) return unavailable();
      verified.push(verifyPayrollValueSpend(spend));
    }
    if (
      verified.length > 1 &&
      redemption.usedAt <
        redemptions.find((row) => row.id === verified[verified.length - 2].redemptionId)!.usedAt
    )
      return unavailable();
    usedBalanceIds.add(changes[0].id);
    remaining = remaining.minus(redemption.amount);
    usages.push({ sale: usage, tenders, redemptions: usageRedemptions });
  }
  if (
    !remaining.equals(preRemaining) ||
    usedBalanceIds.size +
      transfers.length +
      historyBalances.filter((row) => row.kind === "SHARING").length !==
      historyBalances.length -
        historyBalances.filter((row) => row.kind === "EXPIRY_CHANGE").length ||
    verified.length !== redemptions.length ||
    restorations.length !== reversals.length ||
    related.filter((row) => row.sourceType === "VALUE_SPEND").length !== redemptions.length
  )
    return unavailable();
  return {
    verified,
    refund,
    restorations,
    evidence: {
      tenant,
      holding,
      sale,
      line,
      purchase,
      redemptions,
      balanceEvents,
      transfers,
      sharing,
      receipts,
      payments,
      outstanding,
      related,
      rules,
      usages,
    },
  };
}
