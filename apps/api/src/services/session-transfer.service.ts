import {
  sessionPackageHoldingSchema,
  sessionPackageTransferEventSchema,
  transferSessionPackageSchema,
  type PaginationQuery,
  type TransferSessionPackageInput,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error.js";
import { paginated, parsePagination } from "../utils/pagination.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { transferPackageValuation } from "./package-valuation-ledger.js";

async function assertCustomer(customerId: string) {
  if (!(await prisma.customer.findFirst({ where: { id: customerId }, select: { id: true } })))
    throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
}

export async function listOwnedSessionPackages(customerId: string, query: PaginationQuery) {
  await assertCustomer(customerId);
  const paging = parsePagination(query);
  const where = { customerId };
  const [rows, total] = await Promise.all([
    prisma.customerPackageHolding.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: paging.skip,
      take: paging.take,
      include: { package: { select: { name: true } } },
    }),
    prisma.customerPackageHolding.count({ where }),
  ]);
  return paginated(
    rows.map((row) =>
      sessionPackageHoldingSchema.parse({
        ...row,
        name: row.package.name,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      }),
    ),
    total,
    paging,
  );
}

type EventRow = Awaited<ReturnType<typeof prisma.sessionPackageTransferEvent.create>>;
function serializeEvent(row: EventRow) {
  return sessionPackageTransferEventSchema.parse({
    ...row,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

export async function listSessionPackageTransfers(customerId: string, query: PaginationQuery) {
  await assertCustomer(customerId);
  const paging = parsePagination(query);
  const where = { OR: [{ fromCustomerId: customerId }, { toCustomerId: customerId }] };
  const [rows, total] = await Promise.all([
    prisma.sessionPackageTransferEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: paging.skip,
      take: paging.take,
    }),
    prisma.sessionPackageTransferEvent.count({ where }),
  ]);
  return paginated(rows.map(serializeEvent), total, paging);
}

/** Ownership and evidence commit together; the row lock is shared with POS draws/voids. */
export async function transferSessionPackage(
  customerId: string,
  holdingId: string,
  rawInput: TransferSessionPackageInput,
  actorId: string,
) {
  const input = transferSessionPackageSchema.parse(rawInput);
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Session transfer requires tenant scope.");
  if (customerId === input.targetCustomerId)
    throw badRequest("Choose a different customer.", undefined, "TRANSFER_SAME_CUSTOMER");

  return prisma.$transaction(async (tx) => {
    // Match POS/reversal lock order before acquiring tenant/customer/holding locks.
    await lockPrepaid(tx, scope.tenantId, actorId, input.reason);
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${scope.tenantId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} AND "tenantId" = ${scope.tenantId} FOR SHARE`;
    const actor = await tx.user.findFirst({ where: { id: actorId } });
    if (
      !actor ||
      actor.disabled ||
      !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole) ||
      (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
    )
      throw forbidden("Only an enabled owner or manager can transfer session packages.");
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
    if (resolveTenantStatus(tenant.status, tenant.subscriptions[0]?.endDate ?? null) !== "ACTIVE")
      throw forbidden("This salon is read-only.", "TENANT_READ_ONLY");

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

    await tx.$queryRaw`SELECT id FROM customer_package_holdings
      WHERE id = ${holdingId} AND "tenantId" = ${scope.tenantId} FOR UPDATE`;
    const holding = await tx.customerPackageHolding.findFirst({
      where: { id: holdingId, customerId },
    });
    if (!holding)
      throw notFound("That session holding is not owned by this customer.", "HOLDING_NOT_FOUND");
    if (holding.updatedAt.toISOString() !== input.expectedUpdatedAt)
      throw conflict(
        "This holding changed. Reload before confirming a transfer.",
        "TRANSFER_STALE",
      );
    if (holding.expiresAt && holding.expiresAt.getTime() <= Date.now())
      throw conflict("Expired sessions cannot be transferred.", "HOLDING_EXPIRED");
    if (holding.quantityRemaining <= 0 || holding.quantityRemaining > holding.quantity)
      throw conflict("There are no valid remaining sessions to transfer.", "HOLDING_INSUFFICIENT");

    await tx.customerPackageHolding.update({
      where: { id: holdingId },
      data: {
        customerId: input.targetCustomerId,
        updatedAt: new Date(Math.max(Date.now(), holding.updatedAt.getTime() + 1)),
      },
    });
    const event = await tx.sessionPackageTransferEvent.create({
      data: {
        tenantId: scope.tenantId,
        holdingId,
        fromCustomerId: customerId,
        toCustomerId: input.targetCustomerId,
        actorId,
        quantity: holding.quantityRemaining,
        expiresAt: holding.expiresAt,
        reason: input.reason,
      },
    });
    await transferPackageValuation(tx, holdingId, event.id, input.targetCustomerId);
    return serializeEvent(event);
  });
}
