import { z } from "zod";
import { readPayrollPackagePurchase, payrollPackageSessionBase } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { forbidden } from "../lib/http-error.js";
import { normalizeSessionRanges } from "../lib/package-valuation.js";

type HoldingEvidence = {
  id: string;
  customerId: string;
  packageId: string;
  saleLineId: string | null;
  quantity: number;
  quantityRemaining: number;
  expiresAt: Date | null;
  payrollPurchaseSnapshot: unknown;
  payrollAvailableOrdinals: unknown;
};

const ordinals = z.array(z.object({ first: z.number().int(), last: z.number().int() }));

/** Original four-decimal commission bases, not catalogue values or payable awards. */
export function packageLiabilityRow(holding: HoldingEvidence, asOf: Date) {
  const result = {
    holdingId: holding.id,
    customerId: holding.customerId,
    packageId: holding.packageId,
    sessionsRemaining: holding.quantityRemaining,
    expiresAt: holding.expiresAt?.toISOString() ?? null,
    expired: Boolean(holding.expiresAt && holding.expiresAt <= asOf),
    currency: null as string | null,
    remainingNet: null as string | null,
    commissionExposure: null as string | null,
    reason: "Original purchase economics or remaining ordinals unavailable." as string | null,
    exposureReason: "Original commission policy unavailable." as string | null,
  };
  if (!holding.payrollPurchaseSnapshot || !holding.payrollAvailableOrdinals) return result;
  try {
    const purchase = readPayrollPackagePurchase(holding.payrollPurchaseSnapshot);
    const ranges = normalizeSessionRanges(
      purchase.grantedSessions,
      ordinals.parse(holding.payrollAvailableOrdinals),
    );
    if (
      purchase.packageId !== holding.packageId ||
      purchase.saleLineId !== holding.saleLineId ||
      purchase.grantedSessions !== holding.quantity ||
      ranges.reduce((sum, range) => sum + range.last - range.first + 1, 0) !==
        holding.quantityRemaining
    )
      return result;
    result.currency = purchase.currency;
    if (!purchase.currency) return result;
    result.remainingNet = ranges
      .reduce(
        (sum, range) =>
          sum.add(
            payrollPackageSessionBase(purchase, range.first, range.last, [
              { staffId: "report-basis-only", share: 10000 },
            ]).baseAmount,
          ),
        new Prisma.Decimal(0),
      )
      .toFixed(4);
    result.reason = null;
    const policy = purchase.commissionSettings?.redemption;
    if (policy?.mode === "EXCLUDE" || policy?.mode === "FIXED") {
      result.commissionExposure =
        policy.mode === "EXCLUDE"
          ? "0.00"
          : new Prisma.Decimal(policy.amount).mul(holding.quantityRemaining).toFixed(2);
      result.exposureReason = null;
    } else if (policy?.mode === "FOLLOW_PLAN") {
      result.exposureReason =
        "Future performer, effective rules and plan context are unknown; no award is inferred.";
    }
    return result;
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof RangeError ||
      (error instanceof Error &&
        [
          "Package purchase snapshot economics are inconsistent.",
          "Package purchase net and GST must equal gross consideration.",
        ].includes(error.message))
    )
      return result;
    throw error;
  }
}

export async function packageLiability() {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId()) throw forbidden();
  return prisma.$transaction(
    async (tx) => {
      const actor = await tx.user.findFirst({
        where: { id: scope.actorId, disabled: false },
        select: { globalRole: true },
      });
      if (!actor || !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole)) throw forbidden();
      const asOf = new Date();
      const holdings = await tx.customerPackageHolding.findMany({
        where: { quantityRemaining: { gt: 0 } },
        orderBy: { id: "asc" },
      });
      return {
        asOf: asOf.toISOString(),
        rows: holdings.map((holding) => packageLiabilityRow(holding, asOf)),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
