import {
  prepaidHoldingSchema,
  prepaidTransferEventSchema,
  transferPrepaidSchema,
  type PaginationQuery,
  type TransferPrepaidInput,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error.js";
import { paginated, parsePagination } from "../utils/pagination.js";

export async function listOwnedPrepaid(customerId: string, query: PaginationQuery) {
  if (!(await prisma.customer.findFirst({ where: { id: customerId }, select: { id: true } })))
    throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
  const paging = parsePagination(query);
  const where = { customerId };
  const [rows, total] = await Promise.all([
    prisma.customerValuePackageHolding.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: paging.skip,
      take: paging.take,
      include: { valuePackage: { select: { name: true } } },
    }),
    prisma.customerValuePackageHolding.count({ where }),
  ]);
  return paginated(
    rows.map((row) =>
      prepaidHoldingSchema.parse({
        ...row,
        name: row.valuePackage.name,
        amountRemaining: row.amountRemaining.toFixed(2),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      }),
    ),
    total,
    paging,
  );
}

export async function listPrepaidTransfers(customerId: string, query: PaginationQuery) {
  if (!(await prisma.customer.findFirst({ where: { id: customerId }, select: { id: true } })))
    throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
  const paging = parsePagination(query);
  const where = { OR: [{ fromCustomerId: customerId }, { toCustomerId: customerId }] };
  const [rows, total] = await Promise.all([
    prisma.prepaidTransferEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: paging.skip,
      take: paging.take,
    }),
    prisma.prepaidTransferEvent.count({ where }),
  ]);
  return paginated(rows.map(serializeEvent), total, paging);
}

type EventRow = Awaited<ReturnType<typeof prisma.prepaidTransferEvent.create>>;
function serializeEvent(row: EventRow) {
  return prepaidTransferEventSchema.parse({
    ...row,
    amount: row.amount.toFixed(2),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Transfer and evidence commit together. The holding lock also serializes POS draws/voids. */
export async function transferPrepaid(
  customerId: string,
  holdingId: string,
  rawInput: TransferPrepaidInput,
  actorId: string,
) {
  const input = transferPrepaidSchema.parse(rawInput);
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Prepaid transfer requires tenant scope.");
  if (customerId === input.targetCustomerId)
    throw badRequest("Choose a different customer.", undefined, "TRANSFER_SAME_CUSTOMER");
  return prisma.$transaction(async (tx) => {
    // Recheck the database role, enabled/2FA state and salon write state, not a body actor.
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${scope.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} AND "tenantId" = ${scope.tenantId} FOR SHARE`;
    const actor = await tx.user.findFirst({ where: { id: actorId } });
    if (
      !actor ||
      actor.disabled ||
      !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole) ||
      (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
    )
      throw forbidden("Only an enabled owner or manager can transfer prepaid credit.");
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: scope.tenantId },
      include: { subscriptions: { orderBy: { endDate: "desc" }, take: 1 } },
    });
    if (resolveTenantStatus(tenant.status, tenant.subscriptions[0]?.endDate ?? null) !== "ACTIVE")
      throw forbidden("This salon is read-only.", "TENANT_READ_ONLY");

    // Stable ordering avoids two opposing transfers locking customers in reverse order.
    await tx.$queryRaw`SELECT id FROM customers WHERE "tenantId" = ${scope.tenantId}
      AND id IN (${customerId}, ${input.targetCustomerId}) ORDER BY id FOR SHARE`;
    const customers = await tx.customer.findMany({
      where: { id: { in: [customerId, input.targetCustomerId] } },
      select: { id: true, archivedAt: true },
    });
    if (customers.length !== 2)
      throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
    if (customers.some((row) => row.archivedAt))
      throw conflict("Archived customers cannot send or receive transfers.", "CUSTOMER_ARCHIVED");

    await tx.$queryRaw`SELECT id FROM customer_value_package_holdings
      WHERE id = ${holdingId} AND "tenantId" = ${scope.tenantId} FOR UPDATE`;
    const holding = await tx.customerValuePackageHolding.findFirst({
      where: { id: holdingId, customerId },
    });
    if (!holding)
      throw notFound("That prepaid holding is not owned by this customer.", "HOLDING_NOT_FOUND");
    if (holding.updatedAt.toISOString() !== input.expectedUpdatedAt)
      throw conflict(
        "This balance changed. Reload before confirming a transfer.",
        "TRANSFER_STALE",
      );
    if (holding.expiresAt && holding.expiresAt.getTime() <= Date.now())
      throw conflict("Expired credit cannot be transferred.", "HOLDING_EXPIRED");
    if (holding.amountRemaining.lessThanOrEqualTo(0))
      throw conflict("There is no remaining credit to transfer.", "HOLDING_INSUFFICIENT");
    // Legacy family identifiers have no verified pool semantics. Never move one silently.
    if (holding.familyId)
      throw conflict(
        "Shared credit transfers need the family-pool workflow.",
        "SHARED_TRANSFER_UNAVAILABLE",
      );
    await tx.customerValuePackageHolding.update({
      where: { id: holding.id },
      data: {
        customerId: input.targetCustomerId,
        updatedBy: actorId,
        updatedAt: new Date(Math.max(Date.now(), holding.updatedAt.getTime() + 1)),
      },
    });
    const event = await tx.prepaidTransferEvent.create({
      data: {
        tenantId: scope.tenantId,
        holdingId,
        fromCustomerId: customerId,
        toCustomerId: input.targetCustomerId,
        actorId,
        amount: holding.amountRemaining,
        expiresAt: holding.expiresAt,
        reason: input.reason,
      },
    });
    return serializeEvent(event);
  });
}
