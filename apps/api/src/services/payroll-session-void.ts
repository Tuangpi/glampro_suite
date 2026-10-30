import { createHash } from "node:crypto";
import { voidPayrollSessionSchema } from "@glampro_suite/shared";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { conflict, forbidden, notFound } from "../lib/http-error.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { restorePayrollPackageSessions } from "./payroll-package-session.js";
import { restorePackageRedemption } from "./package-valuation-ledger.js";
import { voidRedemptionCommissionEvidence } from "./redemption-commission-evidence.js";

export async function voidPayrollSession(
  saleId: string,
  redemptionId: string,
  value: z.infer<typeof voidPayrollSessionSchema>,
) {
  const input = voidPayrollSessionSchema.parse(value);
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
  return prisma.$transaction(async (tx) => {
    await lockPrepaid(tx, scope.tenantId, scope.actorId, input.reason);
    await lockCommissionConfiguration(tx, scope.tenantId);
    const actor = await tx.user.findFirst({ where: { id: scope.actorId, disabled: false } });
    if (!actor || !["MANAGER", "SUPER_ADMIN"].includes(actor.globalRole))
      throw forbidden("A manager must void sessions.");
    const redemption = await tx.customerRedemption.findFirst({
      where: { id: redemptionId, saleId, itemType: "PACKAGE", sale: { status: "COMPLETED" } },
    });
    if (!redemption?.holdingId) throw notFound("That package session does not exist.");
    const hash = createHash("sha256")
      .update(JSON.stringify({ ...input, saleId, redemptionId, actorId: actor.id }))
      .digest("hex");
    const previous = await tx.auditLog.findFirst({
      where: {
        tenantId: scope.tenantId,
        action: "package.session.void",
        targetId: `session-void:${input.idempotencyKey}`,
      },
    });
    if (previous) {
      if (z.object({ requestHash: z.string() }).parse(previous.metadata).requestHash !== hash)
        throw conflict("Session void retry differs from the original.");
      return { redemptionId, revertedAt: redemption.revertedAt?.toISOString() ?? null };
    }
    const snapshot = await tx.commissionRedemptionSnapshot.findFirst({
      where: { redemptionId },
      orderBy: { revision: "desc" },
    });
    if (redemption.revertedAt || !snapshot || snapshot.revision !== input.expectedRevision)
      throw conflict("Session changed. Reload before voiding.");
    await restorePayrollPackageSessions(tx, redemptionId, redemption.holdingId);
    await restorePackageRedemption(tx, redemption.holdingId, redemptionId);
    await tx.customerPackageHolding.update({
      where: { id: redemption.holdingId },
      data: { quantityRemaining: { increment: redemption.quantity } },
    });
    await voidRedemptionCommissionEvidence(tx, redemptionId, actor.id);
    const at = new Date();
    await tx.customerRedemption.update({ where: { id: redemptionId }, data: { revertedAt: at } });
    await tx.auditLog.create({
      data: {
        tenantId: scope.tenantId,
        action: "package.session.void",
        targetType: "CustomerRedemption",
        targetId: `session-void:${input.idempotencyKey}`,
        // PostgreSQL now() is transaction-start time and can predate restoration.
        createdAt: at,
        metadata: {
          requestHash: hash,
          redemptionId,
          saleId,
          actorId: actor.id,
          actorRole: actor.globalRole,
          request: input,
          reason: input.reason,
        },
      },
    });
    return { redemptionId, revertedAt: at.toISOString() };
  });
}
