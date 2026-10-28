import { createHash } from "node:crypto";
import { z } from "zod";
import {
  allocatePayrollSplit,
  commissionAttributionSchema,
  payrollBaseLineSchema,
  payrollValuePackagePurchaseSchema,
  payrollValuePackageRefundAmounts,
  refundPayrollPackageSchema,
  type RefundPayrollPackage,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden, notFound } from "../lib/http-error.js";
import { lockPrepaid, prepaidSaleContext } from "../lib/prepaid-lock.js";
import { packageMoneyToCents, packagePurchaseValue } from "../lib/package-valuation.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { validateValuePackageCollectionSources } from "./payroll-value-collection-sources.js";
import { payrollBusinessDate } from "./payroll-source-event.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const negativeBase = (net: bigint) =>
  `-${net / 100n}.${(net % 100n).toString().padStart(2, "0")}00`;

/** Internal seam; caller must wrap this in the source transaction. No provider payout. */
export async function refundPayrollValuePackageInTransaction(
  tx: Transaction,
  holdingId: string,
  value: RefundPayrollPackage,
) {
  const input = refundPayrollPackageSchema.parse(value);
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
  await lockPrepaid(tx, scope.tenantId, scope.actorId, input.reason);
  await lockCommissionConfiguration(tx, scope.tenantId);
  const actor = await tx.user.findFirst({ where: { id: scope.actorId, disabled: false } });
  if (!actor || !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole))
    throw forbidden("A salon owner or manager must approve value-package refunds.");
  const key = `value-package-refund:${input.idempotencyKey}`;
  const hash = createHash("sha256")
    .update(JSON.stringify({ ...input, holdingId, actorId: actor.id }))
    .digest("hex");
  const existing = await tx.payrollSourceEvent.findFirst({ where: { sourceKey: key } });
  if (existing) {
    if (z.object({ requestHash: z.string() }).parse(existing.evidence).requestHash !== hash)
      throw conflict("Refund retry has different evidence.");
    return existing;
  }
  const holding = await tx.customerValuePackageHolding.findFirst({ where: { id: holdingId } });
  if (!holding) throw notFound("That value-package holding does not exist.");
  if (holding.updatedAt.toISOString() !== input.expectedUpdatedAt)
    throw conflict("Holding changed. Reload before refunding.");
  const parsed = payrollValuePackagePurchaseSchema.safeParse(holding.payrollPurchaseSnapshot);
  if (!parsed.success || !parsed.data.currency || !parsed.data.sellers)
    throw conflict("Complete original value-package purchase evidence is required.");
  const purchase = parsed.data;
  if (
    await tx.payrollSourceEvent.findFirst({
      where: { sourceType: "VALUE_PACKAGE_REFUND", sourceId: holdingId },
    })
  )
    throw conflict("Value package already refunded.");
  const sale = await tx.sale.findFirst({
    where: { id: purchase.saleId },
    include: { refund: true },
  });
  const line = await tx.saleLine.findFirst({
    where: {
      id: purchase.saleLineId,
      saleId: purchase.saleId,
      itemType: "VALUE_PACKAGE",
      itemId: holding.valuePackageId,
    },
  });
  if (
    !sale ||
    sale.status !== "COMPLETED" ||
    sale.refund ||
    sale.collectionCurrency !== purchase.currency ||
    !line ||
    holding.saleLineId !== line.id
  )
    throw conflict("Original value-package source lineage is unavailable.");
  const original = packagePurchaseValue(
    line.lineTotal.toFixed(2),
    line.voucherDiscountAmount.toFixed(2),
    line.taxAmount.toFixed(2),
  );
  const attribution = commissionAttributionSchema.safeParse(line.attribution);
  const canonical = (shares: { staffId: string; share: number }[]) =>
    JSON.stringify([...shares].sort((a, b) => a.staffId.localeCompare(b.staffId)));
  if (
    original.netCents !== packageMoneyToCents(purchase.paidNet) ||
    holding.amount.toFixed(2) !== purchase.credit ||
    !attribution.success ||
    !attribution.data.sellers ||
    canonical(attribution.data.sellers) !== canonical(purchase.sellers!)
  )
    throw conflict("Original value-package economics or sellers do not reconcile.");
  const redemptions = await tx.customerRedemption.findMany({
    where: { holdingId, itemType: "VALUE_PACKAGE", revertedAt: null },
  });
  if (
    redemptions.some((row) => !row.amount || row.amount.lessThan(0)) ||
    redemptions.reduce((sum, row) => sum + packageMoneyToCents(row.amount!.toFixed(2)), 0n) !==
      packageMoneyToCents(purchase.credit) - packageMoneyToCents(holding.amountRemaining.toFixed(2))
  )
    throw conflict("Original value-package usage does not reconcile with remaining credit.");
  const allocations = await tx.commissionCollectionAllocation.findMany({
    where: { saleLineId: line.id },
    include: { collection: true },
  });
  if (
    allocations.some(
      (row) =>
        row.netCents < 0n ||
        row.taxCents < 0n ||
        row.grossCents !== row.netCents + row.taxCents ||
        row.collection.saleId !== sale.id ||
        row.collection.currency !== purchase.currency,
    )
  )
    throw conflict("Original value-package collection components do not reconcile.");
  let amounts: ReturnType<typeof payrollValuePackageRefundAmounts>;
  try {
    amounts = payrollValuePackageRefundAmounts({
      purchase,
      creditRemaining: holding.amountRemaining.toFixed(2),
      originalTaxCents: original.taxCents,
      collectedNet: allocations.reduce((sum, row) => sum + row.netCents, 0n),
      collectedTax: allocations.reduce((sum, row) => sum + row.taxCents, 0n),
      adminFeeNet: BigInt(input.adminFeeNetCents),
    });
  } catch {
    throw conflict("Value-package refund economics do not reconcile.");
  }
  if (amounts.gross !== BigInt(input.payoutGrossCents))
    throw conflict(
      "Payout does not match original value-package consideration, usage, fee and GST.",
      "VALUE_PACKAGE_REFUND_PAYOUT_MISMATCH",
      { expectedGrossCents: amounts.gross.toString() },
    );
  const { sources, originalLines } = await validateValuePackageCollectionSources(tx, {
    saleId: sale.id,
    currency: purchase.currency!,
    outletId: sale.outletId,
    sellers: purchase.sellers!,
    allocations,
    requireRates: amounts.net > 0n,
  });
  const outstanding = await tx.customerOutstanding.findFirst({ where: { saleId: sale.id } });
  const cancelled = new Prisma.Decimal(amounts.cancelledGross.toString()).div(100);
  if (
    amounts.cancelledGross > 0n &&
    (!outstanding || cancelled.greaterThan(outstanding.unpaidAmount))
  )
    throw conflict("Outstanding value-package balance no longer reconciles.");
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: scope.tenantId },
    select: { timeZone: true },
  });
  const at = new Date();
  await prepaidSaleContext(tx, sale.id);
  const lines =
    amounts.net > 0n
      ? allocatePayrollSplit(negativeBase(amounts.net), purchase.sellers!).map((part) =>
          payrollBaseLineSchema.parse({
            ...originalLines.get(part.staffId)!,
            id: `${key}:${part.staffId}`,
            baseAmount: part.amount,
            units: "0.0000",
            status: "EARNED",
            businessDate: payrollBusinessDate(at, tenant.timeZone),
          }),
        )
      : [];
  const event = await tx.payrollSourceEvent.create({
    data: {
      tenantId: scope.tenantId,
      sourceKey: key,
      sourceType: "VALUE_PACKAGE_REFUND",
      sourceId: holdingId,
      saleId: sale.id,
      outletId: sale.outletId,
      actorId: actor.id,
      reason: input.reason,
      occurredAt: at,
      evidence: {
        version: 1,
        status: "CAPTURED",
        postingStatus: "PENDING_RELEASE",
        requestHash: hash,
        currency: purchase.currency,
        netCents: amounts.net.toString(),
        taxCents: amounts.tax.toString(),
        grossCents: amounts.gross.toString(),
        usedBaseTicks: amounts.usedTicks.toString(),
        cancelledCreditCents: amounts.cancelledCreditCents.toString(),
        cancelledGrossCents: amounts.cancelledGross.toString(),
        adminFeeNetCents: input.adminFeeNetCents,
        payoutMethod: input.payoutMethod,
        purchase,
        originalSourceIds: sources.map((row) => row.id),
        lines,
      },
    },
  });
  await tx.customerValuePackageHolding.update({
    where: { id: holdingId },
    data: { amountRemaining: 0, updatedBy: actor.id },
  });
  if (outstanding && amounts.cancelledGross > 0n)
    await tx.customerOutstanding.update({
      where: { id: outstanding.id },
      data: { unpaidAmount: { decrement: cancelled } },
    });
  return event;
}

export async function refundPayrollValuePackage(holdingId: string, input: RefundPayrollPackage) {
  return prisma.$transaction((tx) => refundPayrollValuePackageInTransaction(tx, holdingId, input));
}

/** Caller already holds the prepaid lock; never resurrect cancelled credit. */
export async function assertPayrollValuePackageRestorable(tx: Transaction, holdingId: string) {
  if (
    await tx.payrollSourceEvent.findFirst({
      where: { sourceType: "VALUE_PACKAGE_REFUND", sourceId: holdingId },
    })
  )
    throw conflict(
      "Refunded value-package credit cannot be restored without refund reconciliation.",
    );
}
