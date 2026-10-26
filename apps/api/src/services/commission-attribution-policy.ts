import {
  publishCommissionAttributionPolicySchema,
  type PublishCommissionAttributionPolicy,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden } from "../lib/http-error.js";
import { lockCommissionConfiguration } from "./commission.service.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export async function readCommissionAttributionPolicy(tx: Transaction = prisma) {
  const latest = await tx.commissionAttributionPolicy.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return {
    revision: latest?.id ?? null,
    requireSellers: latest?.requireSellers ?? false,
    requireServicePerformers: latest?.requireServicePerformers ?? false,
    requireRedemptionPerformers: latest?.requireRedemptionPerformers ?? false,
  };
}
export async function publishCommissionAttributionPolicy(
  value: PublishCommissionAttributionPolicy,
  actorId: string,
) {
  const input = publishCommissionAttributionPolicySchema.parse(value);
  const scope = currentScope();
  if (scope?.kind !== "tenant" || (scope.actorId && scope.actorId !== actorId))
    throw forbidden("Attribution policy requires the current salon actor.");
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, scope.tenantId);
    const actor = await tx.user.findFirst({ where: { id: actorId, disabled: false } });
    if (!actor || !["MANAGER", "SUPER_ADMIN"].includes(actor.globalRole))
      throw forbidden("Only salon administrators and managers can publish attribution policy.");
    const latest = await tx.commissionAttributionPolicy.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if ((latest?.id ?? null) !== input.expectedRevision)
      throw conflict("Attribution policy changed. Reload before publishing.");
    const { expectedRevision: _revision, ...data } = input;
    await tx.commissionAttributionPolicy.create({
      data: {
        ...data,
        tenantId: scope.tenantId,
        actorId,
        createdAt: new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1)),
      },
    });
    return readCommissionAttributionPolicy(tx);
  });
}
