import { createHash } from "node:crypto";
import { z } from "zod";
import {
  allocatePayrollSplit,
  payrollBaseLineSchema,
  readPayrollPackagePurchase,
  payrollPackageRefundAmounts,
  payrollFixedSaleClawback,
  refundPayrollPackageSchema,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { conflict, forbidden, notFound } from "../lib/http-error.js";
import { payrollOrdinalSchema } from "./payroll-package-session.js";
import { payrollBusinessDate } from "./payroll-source-event.js";
import { Prisma } from "../../generated/prisma/client.js";

export { refundPayrollPackageSchema };

/** Returns consideration, stored GST and commission clawbacks separately. No provider payout. */
export async function refundPayrollPackage(
  holdingId: string,
  value: z.infer<typeof refundPayrollPackageSchema>,
) {
  const input = refundPayrollPackageSchema.parse(value);
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
  return prisma.$transaction(async (tx) => {
    await lockPrepaid(tx, scope.tenantId, scope.actorId, input.reason);
    await lockCommissionConfiguration(tx, scope.tenantId);
    const actor = await tx.user.findFirst({ where: { id: scope.actorId, disabled: false } });
    if (!actor || !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole))
      throw forbidden("A salon owner or manager must approve package refunds.");
    const hash = createHash("sha256")
      .update(JSON.stringify({ ...input, holdingId, actorId: actor.id }))
      .digest("hex");
    const key = `package-refund:${input.idempotencyKey}`;
    const existing = await tx.payrollSourceEvent.findFirst({ where: { sourceKey: key } });
    if (existing) {
      if (z.object({ requestHash: z.string() }).parse(existing.evidence).requestHash !== hash)
        throw conflict("Refund retry has different evidence.");
      return existing;
    }
    const holding = await tx.customerPackageHolding.findFirst({ where: { id: holdingId } });
    if (!holding) throw notFound("That holding does not exist.");
    if (holding.updatedAt.toISOString() !== input.expectedUpdatedAt)
      throw conflict("Holding changed. Reload before refunding.");
    if (!holding.payrollPurchaseSnapshot || !holding.payrollAvailableOrdinals)
      throw conflict("Original package evidence is unavailable; no refund may be inferred.");
    const purchase = readPayrollPackagePurchase(holding.payrollPurchaseSnapshot);
    if (purchase.missingEvidence.length)
      throw conflict("Complete original purchase evidence is required for a package refund.");
    const sale = await tx.sale.findFirst({ where: { id: purchase.saleId } });
    if (!sale || sale.status !== "COMPLETED" || sale.collectionCurrency !== purchase.currency)
      throw conflict("Package source sale is unavailable or no longer refundable.");
    const saleLine = await tx.saleLine.findFirst({
      where: {
        id: purchase.saleLineId,
        saleId: sale.id,
        itemType: "PACKAGE",
        itemId: purchase.packageId,
      },
    });
    if (
      !saleLine ||
      holding.saleLineId !== saleLine.id ||
      holding.quantity !== purchase.grantedSessions
    )
      throw conflict("Original package source lineage does not reconcile.");
    if (
      await tx.payrollSourceEvent.findFirst({
        where: { sourceType: "PACKAGE_REFUND", sourceId: holdingId },
      })
    )
      throw conflict("Package already refunded.");
    const allocations = await tx.commissionCollectionAllocation.findMany({
      where: { saleLineId: purchase.saleLineId },
    });
    const collectedNet = allocations.reduce((sum, row) => sum + row.netCents, 0n);
    const collectedTax = allocations.reduce((sum, row) => sum + row.taxCents, 0n);
    const available = payrollOrdinalSchema.parse(holding.payrollAvailableOrdinals);
    if (
      allocations.some(
        (row) =>
          row.netCents < 0n || row.taxCents < 0n || row.grossCents !== row.netCents + row.taxCents,
      )
    )
      throw conflict("Original package collection components do not reconcile.");
    let amounts: ReturnType<typeof payrollPackageRefundAmounts>;
    try {
      amounts = payrollPackageRefundAmounts({
        purchase,
        available,
        quantityRemaining: holding.quantityRemaining,
        collectedNet,
        collectedTax,
        adminFeeNet: BigInt(input.adminFeeNetCents),
      });
    } catch {
      throw conflict("Package refund economics or remaining session evidence does not reconcile.");
    }
    const { net: refundNet, tax, gross, usedTicks, cancelledGross } = amounts;
    if (BigInt(input.payoutGrossCents) !== gross)
      throw conflict(
        "Payout does not match original collected consideration, used sessions, fee and GST.",
        "PACKAGE_REFUND_PAYOUT_MISMATCH",
        {
          expectedGrossCents: gross.toString(),
          netCents: refundNet.toString(),
          taxCents: tax.toString(),
        },
      );
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: scope.tenantId },
      select: { timeZone: true },
    });
    const at = new Date();
    const sources = await tx.payrollSourceEvent.findMany({
      where: { sourceType: "COLLECTION", sourceId: { in: allocations.map((row) => row.id) } },
    });
    const originalLines = sources.flatMap(
      (row) => z.object({ lines: z.array(payrollBaseLineSchema) }).parse(row.evidence).lines,
    );
    const policy = purchase.commissionSettings!.sale;
    const sellerIds = purchase.sellers!.map((seller) => seller.staffId).sort();
    if (
      sources.length !== allocations.length ||
      new Set(sources.map((source) => source.sourceId)).size !== allocations.length ||
      sources.some((source) => {
        const allocation = allocations.find((row) => row.id === source.sourceId);
        const evidence = z
          .object({
            status: z.string(),
            currency: z.string().nullable(),
            lines: z.array(payrollBaseLineSchema),
          })
          .parse(source.evidence);
        const expectedBases = allocation
          ? allocatePayrollSplit(
              `${allocation.netCents / 100n}.${(allocation.netCents % 100n).toString().padStart(2, "0")}00`,
              purchase.sellers!,
            )
          : [];
        return (
          !allocation ||
          source.saleId !== sale.id ||
          evidence.status !== "CAPTURED" ||
          evidence.currency !== purchase.currency ||
          JSON.stringify(evidence.lines.map((line) => line.staffId).sort()) !==
            JSON.stringify(sellerIds) ||
          evidence.lines.some(
            (line) =>
              line.commissionType !== "PKG_SALE" ||
              line.mode !== policy.mode ||
              line.baseAmount !==
                expectedBases.find((base) => base.staffId === line.staffId)?.amount ||
              (line.mode === "FIXED" && !/^\d+\.\d{4}$/.test(line.fixedCommission ?? "")),
          ) ||
          evidence.lines.reduce(
            (sum, line) => sum + BigInt(line.baseAmount.replace(".", "")),
            0n,
          ) !==
            allocation.netCents * 100n
        );
      })
    )
      throw conflict("Complete original collection source evidence is required.");
    const outstanding = await tx.customerOutstanding.findFirst({ where: { saleId: sale.id } });
    const cancelledAmount = new Prisma.Decimal(cancelledGross.toString()).div(100);
    if (
      cancelledGross > 0n &&
      (!outstanding || cancelledAmount.greaterThan(outstanding.unpaidAmount))
    )
      throw conflict("Outstanding package balance no longer reconciles.");
    const bases =
      refundNet > 0n
        ? allocatePayrollSplit(
            `-${refundNet / 100n}.${(refundNet % 100n).toString().padStart(2, "0")}00`,
            purchase.sellers!,
          )
        : [];
    let fixed = [] as ReturnType<typeof allocatePayrollSplit>;
    if (policy.mode === "FIXED" && refundNet > 0n) {
      const originalTicks = originalLines.reduce((sum, row) => {
        if (row.mode !== "FIXED" || row.fixedCommission === undefined)
          throw conflict("Original fixed award evidence is unavailable.");
        return sum + BigInt(row.fixedCommission.replace(".", ""));
      }, 0n);
      if (originalTicks < 0n) throw conflict("Original fixed award evidence is inconsistent.");
      const originalAward = `${originalTicks / 10000n}.${(originalTicks % 10000n).toString().padStart(4, "0")}`;
      fixed = allocatePayrollSplit(
        payrollFixedSaleClawback(originalAward, refundNet, BigInt(purchase.netCents)),
        purchase.sellers!,
      );
    }
    const lines = bases.map((base) => {
      const original = originalLines.find((row) => row.staffId === base.staffId);
      if (!original) throw conflict("Original seller source-time rate evidence is unavailable.");
      return payrollBaseLineSchema.parse({
        ...original,
        id: `${key}:${base.staffId}`,
        baseAmount: base.amount,
        units: "0.0000",
        businessDate: payrollBusinessDate(at, tenant.timeZone),
        ...(policy.mode === "FIXED"
          ? { fixedCommission: fixed.find((row) => row.staffId === base.staffId)!.amount }
          : {}),
      });
    });
    const event = await tx.payrollSourceEvent.create({
      data: {
        tenantId: scope.tenantId,
        sourceKey: key,
        sourceType: "PACKAGE_REFUND",
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
          netCents: refundNet.toString(),
          taxCents: tax.toString(),
          grossCents: gross.toString(),
          adminFeeNetCents: input.adminFeeNetCents,
          usedBaseTicks: usedTicks.toString(),
          originalSourceIds: sources.map((row) => row.id),
          payoutMethod: input.payoutMethod,
          lines,
          purchase,
          remainingOrdinals: available,
        },
      },
    });
    // Cancel unused sessions. Earned redemption evidence and original seller snapshots remain untouched.
    await tx.customerPackageHolding.update({
      where: { id: holdingId },
      data: { quantityRemaining: 0, payrollAvailableOrdinals: [] },
    });
    if (outstanding && cancelledGross > 0n) {
      await tx.customerOutstanding.update({
        where: { id: outstanding.id },
        data: { unpaidAmount: { decrement: cancelledAmount } },
      });
    }
    return event;
  });
}
