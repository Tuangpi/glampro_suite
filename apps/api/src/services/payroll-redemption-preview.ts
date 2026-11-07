import { z } from "zod";
import {
  commissionSharesSchema,
  readPayrollPackagePurchase,
  payrollPackageSessionBase,
  paidPayrollPackageSessions,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { currentScope } from "../lib/tenant-context.js";
import { forbidden, notFound } from "../lib/http-error.js";
import { verifiedPayrollCloseSnapshot } from "./payroll-close-store.js";
import { salonPeriodKey } from "./payroll-progress.js";
import { payrollBusinessDate } from "./payroll-source-event.js";
import { payrollOrdinalSchema } from "./payroll-package-session.js";
import { takePackageSessions } from "../lib/package-valuation.js";
import { resolveCommission } from "./commission-rules.js";
import { previewTillCommission } from "./payroll-till-preview.js";

export const redemptionPreviewSchema = z.strictObject({
  holdingId: z.string().trim().min(1).max(128),
  customerId: z.string().trim().min(1).max(128),
  quantity: z.number().int().min(1).max(10000),
  shares: commissionSharesSchema,
});

/** Read original economics and next ordinals without drawing or reserving sessions. */
export async function previewPayrollRedemption(raw: unknown) {
  const input = redemptionPreviewSchema.parse(raw);
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
  return prisma.$transaction(
    async (tx) => {
      const actor = await tx.user.findFirst({ where: { id: scope.actorId, disabled: false } });
      if (!actor || !["SUPER_ADMIN", "MANAGER", "STAFF"].includes(actor.globalRole))
        throw forbidden();
      const holding = await tx.customerPackageHolding.findFirst({
        where: { id: input.holdingId, customerId: input.customerId },
      });
      if (!holding) throw notFound("Customer package holding not found.");
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: scope.tenantId },
        select: { timeZone: true },
      });
      const now = new Date();
      const period = salonPeriodKey(tenant.timeZone, now);
      const verified = await verifiedPayrollCloseSnapshot(tx, period);
      const people = await tx.user.findMany({
        where: { id: { in: input.shares.map((row) => row.staffId) }, disabled: false },
      });
      if (people.length !== input.shares.length)
        throw forbidden("Attribution staff are unavailable.");
      let baseAmount: string | null = null;
      let rows = input.shares.map((row) => ({
        staffId: row.staffId,
        amount: null as string | null,
      }));
      let reason: string | null =
        "Original purchase, paid-session evidence or calculated month is unavailable.";
      if (
        holding.payrollPurchaseSnapshot &&
        holding.payrollAvailableOrdinals &&
        verified?.state.calculation &&
        (!holding.expiresAt || holding.expiresAt > now)
      ) {
        try {
          const purchase = readPayrollPackagePurchase(holding.payrollPurchaseSnapshot);
          const available = payrollOrdinalSchema.parse(holding.payrollAvailableOrdinals);
          const remaining = available.reduce((sum, row) => sum + row.last - row.first + 1, 0);
          const collections = await tx.commissionCollectionAllocation.findMany({
            where: { saleLineId: purchase.saleLineId },
          });
          const paid = paidPayrollPackageSessions(
            purchase,
            collections.reduce((sum, row) => sum + row.netCents, 0n),
          );
          const refunded = await tx.payrollSourceEvent.findFirst({
            where: { sourceType: "PACKAGE_REFUND", sourceId: holding.id },
          });
          if (
            purchase.missingEvidence.length ||
            purchase.packageId !== holding.packageId ||
            remaining !== holding.quantityRemaining ||
            purchase.grantedSessions - remaining + input.quantity > paid ||
            refunded
          )
            throw new Error("Unavailable purchase evidence");
          const draw = takePackageSessions(purchase.grantedSessions, available, input.quantity);
          baseAmount = draw.allocated
            .reduce(
              (sum, range) =>
                sum.add(
                  payrollPackageSessionBase(purchase, range.first, range.last, input.shares)
                    .baseAmount,
                ),
              new Prisma.Decimal(0),
            )
            .toFixed(4);
          const rules = await tx.commissionRule.findMany({ where: { effectiveAt: { lte: now } } });
          const policy = purchase.commissionSettings!.redemption;
          rows = previewTillCommission(
            verified.state,
            {
              commissionType: "PKG_RED",
              baseAmount,
              quantity: input.quantity,
              shares: input.shares,
            },
            {
              outletId: scope.outletId ?? null,
              category: null,
              businessDate: payrollBusinessDate(now, tenant.timeZone),
              mode: policy.mode,
              ...(policy.mode === "FIXED"
                ? {
                    fixedCommission: new Prisma.Decimal(policy.amount)
                      .mul(input.quantity)
                      .toFixed(4),
                  }
                : {}),
              fallbackRates: new Map(
                people.map((person) => [
                  person.id,
                  resolveCommission(
                    rules,
                    {
                      staffId: person.id,
                      itemKind: "PACKAGE_REDEMPTION",
                      itemId: holding.packageId,
                      departmentId: null,
                      legacyServiceRate: person.commissionRate.toString(),
                    },
                    now,
                  ).rate,
                ]),
              ),
            },
          ).rows;
          reason = null;
        } catch (error) {
          // Invalid legacy economics are not zero-valued sessions. Infrastructure
          // failures must still propagate rather than masquerading as missing evidence.
          if (
            !(error instanceof z.ZodError) &&
            !(error instanceof RangeError) &&
            !(
              error instanceof Error &&
              [
                "Unavailable purchase evidence",
                "Package purchase snapshot economics are inconsistent.",
                "Package purchase net and GST must equal gross consideration.",
              ].includes(error.message)
            )
          )
            throw error;
          baseAmount = null;
        }
      }
      return {
        period,
        calculatedAt: verified?.state.calculation?.calculatedAt ?? null,
        scope: actor.globalRole === "STAFF" ? "SELF" : "SALON",
        baseAmount,
        quantity: input.quantity,
        reason,
        rows:
          actor.globalRole === "STAFF" ? rows.filter((row) => row.staffId === scope.actorId) : rows,
        basis: "ORIGINAL_SESSION_SNAPSHOT",
        evidence:
          "Conditional next-session estimate; not reserved. Checkout revalidates funding, coverage and attribution. Excludes incentives and other cart lines; nothing is posted.",
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
