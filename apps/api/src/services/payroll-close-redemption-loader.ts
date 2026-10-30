import { minimumPayrollPackageDeposit } from "@glampro_suite/shared";
import { conflict, forbidden } from "../lib/http-error.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { allocateCollection } from "../lib/commission-collection.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import {
  verifyPayrollPackagePurchase,
  verifyPayrollPackageCollection,
} from "./payroll-close-package-purchase.js";
import { verifyPayrollPackageRedemptionInventory } from "./payroll-close-package-redemption.js";
import { verifyPayrollPackageOwnership } from "./payroll-close-package-ownership.js";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";
import { resolvePayrollCloseSources } from "./payroll-close-sources.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const unavailable = (): never => {
  throw conflict(
    "Authoritative payroll inputs unavailable: PACKAGE_REDEMPTION_HISTORY_UNCONFIRMED.",
  );
};

/** Internal, non-activating complete holding history. No client-supplied records.
 * Holds the same tenant lock as source writes. Supports ownership-reconciled, unreversed,
 * paid-session or sale-bound manager-override history; refunds and corrections remain
 * blocked. This does not reconcile coverage against OTHER holdings on a sale, and
 * must not on its own enable the monthly close's usage-coverage gate.
 */
export async function loadPayrollPackageRedemptionHistory(
  tx: PayrollCloseTransaction,
  holdingId: string,
) {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Package payroll history requires a salon-wide authenticated actor.");
  const tenantId = scope.tenantId;
  await lockCommissionConfiguration(tx, tenantId);
  const actor = await tx.user.findFirst({
    where: { tenantId, id: scope.actorId, disabled: false },
  });
  if (
    !actor ||
    !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole) ||
    (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
  )
    throw forbidden("Package payroll history is not permitted.");
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const holding = await tx.customerPackageHolding.findFirst({ where: { tenantId, id: holdingId } });
  if (!holding?.saleLineId) return unavailable();
  const line = await tx.saleLine.findFirst({ where: { tenantId, id: holding.saleLineId } });
  if (!line || line.itemType !== "PACKAGE") return unavailable();
  const sale = await tx.sale.findFirst({
    where: { tenantId, id: line.saleId },
    include: { lines: true },
  });
  if (
    !sale ||
    sale.tenantId !== tenantId ||
    sale.status !== "COMPLETED" ||
    sale.collectionCurrency !== "SGD"
  )
    return unavailable();
  const siblings = await tx.customerPackageHolding.findMany({
    where: { tenantId, saleLineId: line.id },
    orderBy: { id: "asc" },
  });
  if (siblings.length !== 1 || siblings[0].id !== holding.id) return unavailable();
  const purchase = verifyPayrollPackagePurchase(siblings, line, sale, tenantId);
  const [
    redemptions,
    receipts,
    payments,
    outstanding,
    transfers,
    snapshots,
    events,
    rules,
    refunds,
    overrides,
  ] = await Promise.all([
    tx.customerRedemption.findMany({ where: { tenantId, holdingId }, orderBy: { id: "asc" } }),
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
    tx.sessionPackageTransferEvent.findMany({
      where: { tenantId, holdingId },
      orderBy: { id: "asc" },
    }),
    // No relational FK exists here. Inventory the tenant, then match against
    // independently inventoried operational redemptions below.
    tx.commissionRedemptionSnapshot.findMany({
      where: { tenantId },
      orderBy: { id: "asc" },
    }),
    // Full salon inventory detects orphan corrections/reversals referencing captures.
    tx.payrollSourceEvent.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    tx.commissionRule.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    tx.saleRefund.findMany({ where: { tenantId, saleId: sale.id }, orderBy: { id: "asc" } }),
    tx.auditLog.findMany({
      where: { tenantId, targetId: holdingId, action: "package.unpaid-session.override" },
      orderBy: { id: "asc" },
    }),
  ]);
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
    refunds.length ||
    snapshots.some((row) => row.tenantId !== tenantId) ||
    events.some((row) => row.sourceType === "REVERSAL" && relatedIds.has(row.sourceId)) ||
    related.some((row) => !["REDEMPTION", "COLLECTION"].includes(row.sourceType)) ||
    new Set(receipts.map((row) => `${row.sourceType}:${row.sourceId}`)).size !== receipts.length
  )
    return unavailable();

  const ownership = verifyPayrollPackageOwnership({
    tenantId,
    purchase,
    holding,
    transfers,
    redemptions,
  });

  const paymentFacts = [
    ...payments
      .filter((row) => !row.amount.isZero())
      .map((row) => {
        if (
          row.tenantId !== tenantId ||
          row.saleId !== sale.id ||
          row.sessionId !== null ||
          ["PACKAGE", "PREPAID_CREDIT"].includes(row.method) ||
          row.amount.isNegative()
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
          row.paidAmount.isNegative()
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
      paymentFacts.length
  )
    return unavailable();
  const collected = new Map<string, bigint>();
  const collections = [];
  let packageReceipt = 0;
  for (const [index, receipt] of receipts.entries()) {
    const matches = paymentFacts.filter(
      (row) => row.sourceType === receipt.sourceType && row.sourceId === receipt.sourceId,
    );
    if (
      receipt.tenantId !== tenantId ||
      receipt.saleId !== sale.id ||
      receipt.currency !== "SGD" ||
      receipt.occurredAt < sale.soldAt ||
      receipt.createdAt < receipt.occurredAt ||
      (index > 0 &&
        (receipt.createdAt <= receipts[index - 1].createdAt ||
          receipt.occurredAt < receipts[index - 1].occurredAt)) ||
      matches.length !== 1 ||
      matches[0].cents !== receipt.grossCents.toString() ||
      matches[0].at.getTime() !== receipt.occurredAt.getTime()
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
    for (const part of receipt.allocations) {
      const delta = expected.find((row) => row.lineId === part.saleLineId);
      if (
        part.tenantId !== tenantId ||
        part.collectionId !== receipt.id ||
        !delta ||
        part.netCents !== delta.netCents ||
        part.taxCents !== delta.taxCents
      )
        return unavailable();
      collected.set(part.saleLineId, (collected.get(part.saleLineId) ?? 0n) + part.grossCents);
      if (part.saleLineId !== line.id) continue;
      if (
        packageReceipt === 0 &&
        (receipt.sourceType !== "SALE_PAYMENT" ||
          part.grossCents <
            minimumPayrollPackageDeposit(
              BigInt(purchase.grossCents),
              purchase.commissionSettings.minimumDepositPct,
            ))
      )
        return unavailable();
      const captures = related.filter(
        (row) => row.sourceType === "COLLECTION" && row.sourceId === part.id,
      );
      if (captures.length !== 1) return unavailable();
      const event = captures[0];
      if (
        event.tenantId !== tenantId ||
        event.saleId !== sale.id ||
        event.outletId !== sale.outletId ||
        event.sourceKey !== `collection:${part.id}` ||
        event.occurredAt.getTime() !== receipt.occurredAt.getTime()
      )
        return unavailable();
      const periodKey = new Intl.DateTimeFormat("en", {
        timeZone: tenant.timeZone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(event.occurredAt);
      if (
        !resolvePayrollCloseSources({
          tenantId,
          timeZone: tenant.timeZone,
          periodKey: ["year", "month"]
            .map((type) => periodKey.find((row) => row.type === type)!.value)
            .join("-"),
          events: [{ ...event, sourceType: "COLLECTION" }],
          lineageEvents: [],
        }).sources
      )
        return unavailable();
      verifyPayrollPackageCollection(
        event.evidence,
        purchase,
        line.quantity,
        part.netCents,
        packageReceipt++,
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
      collections.push({
        id: part.id,
        tenantId,
        saleLineId: line.id,
        netCents: part.netCents,
        occurredAt: receipt.occurredAt,
      });
    }
  }
  if (!collections.length) return unavailable();
  const inputs = [];
  for (const redemption of redemptions) {
    const captures = snapshots.filter((row) => row.redemptionId === redemption.id);
    const sources = related.filter((row) => row.sourceId === redemption.id);
    if (captures.length !== 1 || sources.length !== 1) return unavailable();
    const usage = await tx.sale.findFirst({
      where: { tenantId, id: redemption.saleId },
      include: { lines: true },
    });
    if (
      !usage ||
      usage.tenantId !== tenantId ||
      usage.collectionCurrency !== "SGD" ||
      usage.customerId !== redemption.customerId ||
      (holding.expiresAt && redemption.usedAt >= holding.expiresAt)
    )
      return unavailable();
    inputs.push({
      tenantId,
      timeZone: tenant.timeZone,
      purchase,
      redemptionRules: holding.redemptionRules,
      redemption,
      snapshot: captures[0],
      event: sources[0],
      sale: usage,
      coverageLines: usage.lines,
      rules,
    });
  }
  const verified = verifyPayrollPackageRedemptionInventory({
    tenantId,
    purchase,
    holding,
    redemptions: inputs,
    collections,
    overrides,
  });
  return {
    verified,
    evidence: {
      holding,
      sale,
      line,
      receipts,
      payments,
      outstanding,
      transfers,
      overrides,
      ownership,
      snapshots: snapshots.filter((row) => redemptionIds.has(row.redemptionId)),
      related,
      redemptions,
      rules,
      usages: inputs.map((row) => row.sale),
    },
  };
}
