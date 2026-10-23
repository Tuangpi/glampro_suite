import type { prisma } from "./prisma.js";
import { currentScope } from "./tenant-context.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** One lock order for membership, sharing, transfers, POS and reversals in a salon.
 * The receipt sequence already serializes sale completion per salon. This lock
 * also makes membership revocation linearizable with credit spending.
 */
export async function lockPrepaid(
  tx: Transaction,
  tenantId: string,
  actorId?: string,
  reason?: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prepaid:${tenantId}`}, 0))`;
  const scope = currentScope();
  const actor = actorId ?? (scope?.kind === "tenant" ? scope.actorId : undefined) ?? "";
  await tx.$queryRaw`SELECT set_config('glampro.actor_id', ${actor}, true), set_config('glampro.prepaid_reason', ${reason ?? ""}, true)`;
}

export async function prepaidSaleContext(tx: Transaction, saleId: string) {
  await tx.$queryRaw`SELECT set_config('glampro.sale_id', ${saleId}, true)`;
}
