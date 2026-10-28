import {
  payrollHoldingDetailSchema,
  readPayrollPackagePurchase,
  paidPayrollPackageSessions,
  payrollPackageSessionBase,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { notFound } from "../lib/http-error.js";
import { payrollOrdinalSchema } from "./payroll-package-session.js";
import { redemptionCommissionEvidenceSchema } from "./redemption-commission-evidence.js";

export async function getPayrollHoldingDetail(customerId: string, holdingId: string) {
  return prisma.$transaction(
    async (tx) => {
      const holding = await tx.customerPackageHolding.findFirst({
        where: { id: holdingId, customerId },
      });
      if (!holding) throw notFound("That customer package does not exist.");
      const purchase = holding.payrollPurchaseSnapshot
        ? readPayrollPackagePurchase(holding.payrollPurchaseSnapshot)
        : null;
      // All history remains scoped to the current tenant; owners may have transferred since purchase.
      const allocations = purchase
        ? await tx.commissionCollectionAllocation.findMany({
            where: { saleLineId: purchase.saleLineId },
            include: { collection: true },
          })
        : [];
      const redemptions = await tx.customerRedemption.findMany({
        where: { holdingId, itemType: "PACKAGE" },
        orderBy: [{ usedAt: "asc" }, { id: "asc" }],
      });
      const snapshots = await tx.commissionRedemptionSnapshot.findMany({
        where: { redemptionId: { in: redemptions.map((row) => row.id) } },
        orderBy: { revision: "desc" },
      });
      const net = allocations.reduce((sum, row) => sum + row.netCents, 0n),
        tax = allocations.reduce((sum, row) => sum + row.taxCents, 0n);
      const refunded = !!(await tx.payrollSourceEvent.findFirst({
        where: { sourceType: "PACKAGE_REFUND", sourceId: holdingId },
      }));
      let usedBaseTicks: string | null = null;
      if (purchase && holding.payrollAvailableOrdinals && !refunded) {
        let remaining = 0n;
        for (const range of payrollOrdinalSchema.parse(holding.payrollAvailableOrdinals))
          remaining += BigInt(
            payrollPackageSessionBase(
              purchase,
              range.first,
              range.last,
              purchase.sellers ?? [{ staffId: "economics-only", share: 10000 }],
            ).baseAmount.replace(".", ""),
          );
        usedBaseTicks = (BigInt(purchase.netCents) * 100n - remaining).toString();
      }
      return payrollHoldingDetailSchema.parse({
        holdingId,
        updatedAt: holding.updatedAt.toISOString(),
        purchaseSaleId: purchase?.saleId ?? null,
        currency: purchase?.currency ?? null,
        netCents: purchase?.netCents ?? null,
        balanceDueCents: purchase
          ? refunded
            ? "0"
            : (BigInt(purchase.grossCents) - net - tax).toString()
          : null,
        collectedNetCents: purchase ? net.toString() : null,
        collectedTaxCents: purchase ? tax.toString() : null,
        usedBaseTicks,
        sessionValue: purchase?.sessionBaseFloor ?? null,
        grantedSessions: holding.quantity,
        remainingSessions: holding.quantityRemaining,
        paidSessionsRemaining: purchase
          ? Math.max(
              0,
              paidPayrollPackageSessions(purchase, net) -
                (holding.quantity - holding.quantityRemaining),
            )
          : null,
        sellers: purchase?.sellers ?? null,
        settings: purchase?.commissionSettings ?? null,
        missingEvidence: purchase?.missingEvidence ?? ["ORIGINAL_PURCHASE_EVIDENCE"],
        refunded,
        payments: allocations.map((row) => ({
          id: row.collectionId,
          occurredAt: row.collection.occurredAt.toISOString(),
          grossCents: row.grossCents.toString(),
          netCents: row.netCents.toString(),
          taxCents: row.taxCents.toString(),
        })),
        sessions: redemptions.map((row) => {
          const latest = snapshots.find((snapshot) => snapshot.redemptionId === row.id);
          const evidence = latest
            ? redemptionCommissionEvidenceSchema.parse(latest.evidence)
            : null;
          return {
            id: row.id,
            saleId: row.saleId,
            quantity: row.quantity,
            usedAt: row.usedAt.toISOString(),
            revertedAt: row.revertedAt?.toISOString() ?? null,
            revision: latest?.revision ?? null,
            performers: evidence?.performers ?? null,
            baseAmount: evidence?.payrollSession?.baseAmount ?? null,
            signature: row.signature,
          };
        }),
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
