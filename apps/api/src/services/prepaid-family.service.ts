import {
  changePrepaidMembershipSchema,
  createPrepaidFamilySchema,
  prepaidFamilyEventSchema,
  prepaidFamilySchema,
  type ChangePrepaidMembershipInput,
  type CreatePrepaidFamilyInput,
  type PaginationQuery,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden, notFound } from "../lib/http-error.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";
import { paginated, parsePagination } from "../utils/pagination.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function authorize(tx: Transaction, actorId: string) {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Prepaid families require tenant scope.");
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${scope.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} AND "tenantId" = ${scope.tenantId} FOR SHARE`;
  const actor = await tx.user.findFirst({ where: { id: actorId } });
  if (
    !actor ||
    actor.disabled ||
    !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole) ||
    (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
  )
    throw forbidden("Only an enabled owner or manager can manage prepaid families.");
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: scope.tenantId },
    include: { subscriptions: { orderBy: { endDate: "desc" }, take: 1 } },
  });
  if (resolveTenantStatus(tenant.status, tenant.subscriptions[0]?.endDate ?? null) !== "ACTIVE")
    throw forbidden("This salon is read-only.", "TENANT_READ_ONLY");
  return scope.tenantId;
}

async function lockCustomer(tx: Transaction, tenantId: string, customerId: string) {
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  const customer = await tx.customer.findFirst({ where: { id: customerId } });
  if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
  if (customer.archivedAt)
    throw conflict("Archived customers cannot change family membership.", "CUSTOMER_ARCHIVED");
}

export async function getPrepaidFamily(customerId: string) {
  if (!(await prisma.customer.findFirst({ where: { id: customerId }, select: { id: true } })))
    throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
  const membership = await prisma.prepaidFamilyMember.findFirst({ where: { customerId } });
  if (!membership) return null;
  const family = await prisma.prepaidFamily.findFirstOrThrow({
    where: { id: membership.familyId },
    include: { members: { orderBy: { customerId: "asc" } } },
  });
  const customers = await prisma.customer.findMany({
    where: { id: { in: family.members.map((row) => row.customerId) } },
    select: { id: true, name: true, archivedAt: true },
  });
  return prepaidFamilySchema.parse({
    id: family.id,
    name: family.name,
    members: customers.map((row) => ({
      customerId: row.id,
      name: row.name,
      archived: !!row.archivedAt,
    })),
  });
}

export async function createPrepaidFamily(
  customerId: string,
  raw: CreatePrepaidFamilyInput,
  actorId: string,
) {
  const input = createPrepaidFamilySchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const tenantId = await authorize(tx, actorId);
    await lockCustomer(tx, tenantId, customerId);
    if (await tx.prepaidFamilyMember.findFirst({ where: { customerId } }))
      throw conflict("This customer already belongs to a prepaid family.", "FAMILY_ALREADY_JOINED");
    const family = await tx.prepaidFamily.create({ data: { tenantId, name: input.name } });
    await tx.prepaidFamilyMember.create({ data: { tenantId, familyId: family.id, customerId } });
    await tx.prepaidFamilyEvent.create({
      data: {
        tenantId,
        customerId,
        fromFamilyId: null,
        toFamilyId: family.id,
        actorId,
        reason: input.reason,
      },
    });
  });
  return getPrepaidFamily(customerId);
}

export async function changePrepaidMembership(
  customerId: string,
  raw: ChangePrepaidMembershipInput,
  actorId: string,
) {
  const input = changePrepaidMembershipSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const tenantId = await authorize(tx, actorId);
    await lockCustomer(tx, tenantId, customerId);
    const membership = await tx.prepaidFamilyMember.findFirst({ where: { customerId } });
    const previous = membership?.familyId ?? null;
    if (previous !== input.expectedFamilyId)
      throw conflict(
        "Family membership changed. Reload before confirming.",
        "FAMILY_MEMBERSHIP_STALE",
      );
    if (previous === input.familyId)
      throw conflict("Choose a different family membership.", "FAMILY_MEMBERSHIP_UNCHANGED");
    if (input.familyId && !(await tx.prepaidFamily.findFirst({ where: { id: input.familyId } })))
      throw notFound("That prepaid family does not exist.", "FAMILY_NOT_FOUND");
    await tx.prepaidFamilyMember.deleteMany({ where: { customerId } });
    if (input.familyId)
      await tx.prepaidFamilyMember.create({
        data: { tenantId, customerId, familyId: input.familyId },
      });
    await tx.prepaidFamilyEvent.create({
      data: {
        tenantId,
        customerId,
        fromFamilyId: previous,
        toFamilyId: input.familyId,
        actorId,
        reason: input.reason,
      },
    });
  });
  return getPrepaidFamily(customerId);
}

export async function listPrepaidFamilyEvents(customerId: string, query: PaginationQuery) {
  if (!(await prisma.customer.findFirst({ where: { id: customerId }, select: { id: true } })))
    throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
  const paging = parsePagination(query);
  const where = { customerId };
  const [rows, total] = await Promise.all([
    prisma.prepaidFamilyEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: paging.skip,
      take: paging.take,
    }),
    prisma.prepaidFamilyEvent.count({ where }),
  ]);
  return paginated(
    rows.map((row) =>
      prepaidFamilyEventSchema.parse({ ...row, createdAt: row.createdAt.toISOString() }),
    ),
    total,
    paging,
  );
}
