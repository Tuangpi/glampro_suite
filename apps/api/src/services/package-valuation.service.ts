import {
  activatePackageValuationSchema,
  packageValuationActivationSchema,
  type ActivatePackageValuationInput,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { conflict, forbidden } from "../lib/http-error.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";

function tenantScope() {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Package valuation requires tenant scope.");
  return scope;
}

/** Read immutable company activation evidence; no legacy backfill. */
export async function getPackageValuationActivation() {
  const { tenantId } = tenantScope();
  const row = await prisma.packageValuationActivation.findUnique({ where: { tenantId } });
  return row
    ? packageValuationActivationSchema.parse({ ...row, activatedAt: row.activatedAt.toISOString() })
    : null;
}

/** Activation and future grant writers share POS lock order. No legacy backfill. */
export async function activatePackageValuation(
  rawInput: ActivatePackageValuationInput,
  actorId: string,
) {
  const input = activatePackageValuationSchema.parse(rawInput);
  const scope = tenantScope();
  if (scope.actorId !== actorId)
    throw forbidden("Activation requires the current authenticated actor.");
  return prisma.$transaction(async (tx) => {
    await lockPrepaid(tx, scope.tenantId, actorId, input.reason);
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${scope.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} AND "tenantId" = ${scope.tenantId} FOR SHARE`;
    const actor = await tx.user.findFirst({ where: { id: actorId } });
    if (
      !actor ||
      actor.disabled ||
      !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole) ||
      (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
    ) {
      throw forbidden("Only an enabled owner or manager can activate package valuation.");
    }
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: scope.tenantId },
      include: {
        subscriptions: {
          where: { status: { in: ["ACTIVE", "EXPIRED"] }, startDate: { lte: new Date() } },
          orderBy: { endDate: "desc" },
          take: 1,
        },
      },
    });
    if (resolveTenantStatus(tenant.status, tenant.subscriptions[0]?.endDate ?? null) !== "ACTIVE") {
      throw forbidden("This salon is read-only.", "TENANT_READ_ONLY");
    }
    const existing = await tx.packageValuationActivation.findUnique({
      where: { tenantId: scope.tenantId },
    });
    if (existing) {
      if (
        existing.policyVersion !== input.policyVersion ||
        existing.currency !== input.currency ||
        existing.actorId !== actorId ||
        existing.reason !== input.reason
      ) {
        throw conflict(
          "Package valuation was already activated. Reload its immutable confirmation.",
          "VALUATION_ALREADY_ACTIVATED",
        );
      }
      return packageValuationActivationSchema.parse({
        ...existing,
        activatedAt: existing.activatedAt.toISOString(),
      });
    }
    // DB time is sampled after the shared lock, not the beginning of a waiting transaction.
    const [clock] = await tx.$queryRaw<
      { at: Date }[]
    >`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS at`;
    if (!clock) throw new Error("Database activation clock is unavailable.");
    const row = await tx.packageValuationActivation.create({
      data: {
        tenantId: scope.tenantId,
        policyVersion: input.policyVersion,
        currency: input.currency,
        activatedAt: clock.at,
        actorId,
        reason: input.reason,
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: scope.tenantId,
        action: "package.valuation.activate",
        targetType: "PackageValuationActivation",
        targetId: row.id,
        metadata: {
          actorId,
          currency: input.currency,
          policyVersion: input.policyVersion,
          reason: input.reason,
          activatedAt: row.activatedAt.toISOString(),
        },
      },
    });
    return packageValuationActivationSchema.parse({
      ...row,
      activatedAt: row.activatedAt.toISOString(),
    });
  });
}
