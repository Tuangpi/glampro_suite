/**
 * Rooms and equipment — TK2610-0020 phase D, `/api/resources`.
 *
 * The salon's own description of what a booking can occupy: "Room 1", "Wash
 * chair 2", "Steamer". Two rules this service owns:
 *
 * 1. **A name is unique inside the salon.** Two rows called "Room 1" would make
 *    the auto-assignment pick an arbitrary one of them, and the desk's list would
 *    read as a duplicate. Checked here so the refusal lands on the name field
 *    (`RESOURCE_NAME_TAKEN`), not as a raw unique violation.
 * 2. **A resource is archived, never deleted.** `status: INACTIVE` stops new
 *    bookings from choosing it while every booking already taken in it keeps its
 *    line — the same exit services and staff have.
 *
 * Like every service here, each function runs inside the tenant scope
 * `middleware/auth.ts` opened, so none of them takes a tenant id and a handler
 * naming another salon's room simply finds nothing (AGENTS.md rule 1).
 */
import {
  resourceSummarySchema,
  type CreateResourceInput,
  type ResourceListQuery,
  type ResourceSummary,
  type UpdateResourceInput,
} from "@glampro_suite/shared";

import { badRequest, conflict, notFound } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";

/**
 * What the settings card and the booking engine both read.
 *
 * `services` comes along as ids, not names: the editor ticks boxes against the
 * service list it already has, and a name copied here would go stale the moment
 * the catalogue was renamed.
 */
const RESOURCE_SELECT = {
  id: true,
  name: true,
  kind: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  services: { select: { serviceId: true }, orderBy: { serviceId: "asc" } },
} as const;

function findRow(id: string) {
  return prisma.resource.findFirst({ where: { id }, select: RESOURCE_SELECT });
}

type ResourceRow = NonNullable<Awaited<ReturnType<typeof findRow>>>;

function toSummary(row: ResourceRow): ResourceSummary {
  return resourceSummarySchema.parse({
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    serviceIds: row.services.map((link) => link.serviceId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Every resource, rooms before equipment and then by name.
 *
 * Not paginated on purpose: a salon has a handful of rooms, the settings card
 * renders all of them, and the booking flow needs the whole set to know whether
 * *any* is free. A `page`/`pageSize` pair here would only invite the engine to
 * check a page instead of the truth (ADR 0010's shape).
 *
 * The kind ordering is applied here rather than in SQL: PostgreSQL sorts an enum
 * by its declaration order, which would silently change the picker's grouping the
 * day `ResourceKind` gained a value. A plain `name` sort is the database's part.
 */
export async function listResources(query: ResourceListQuery = {}): Promise<ResourceSummary[]> {
  const rows = await prisma.resource.findMany({
    where: {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}),
    },
    select: RESOURCE_SELECT,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const kindRank: Record<(typeof rows)[number]["kind"], number> = { ROOM: 0, EQUIPMENT: 1 };
  const sorted = [...rows].sort(
    (left, right) =>
      kindRank[left.kind] - kindRank[right.kind] ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  );

  return sorted.map(toSummary);
}

export async function getResource(id: string): Promise<ResourceSummary> {
  const row = await findRow(id);
  if (!row) throw notFound("That room or equipment does not exist.", "RESOURCE_NOT_FOUND");
  return toSummary(row);
}

/**
 * Refuses a name this salon already uses for another resource.
 *
 * The database enforces the same rule (`@@unique([tenantId, name])`), but a raw
 * unique violation reaches the browser as a conflict with no field to point at.
 * A name used by *another salon* is not a conflict: the lookup runs inside the
 * tenant scope, so "Room 1" exists once per salon and that is correct.
 */
async function assertNameAvailable(name: string, excludeId?: string): Promise<void> {
  const existing = await prisma.resource.findFirst({
    where: { name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });

  if (existing) {
    throw conflict(`A room or equipment called "${name}" already exists.`, "RESOURCE_NAME_TAKEN", [
      { path: "body.name", message: "This name is already in use." },
    ]);
  }
}

/**
 * Refuses a service id that is not this salon's.
 *
 * Without it a stale checkbox would write a join row pointing at nothing — or,
 * on a cross-tenant id, at another salon's service — and fail as a foreign key.
 */
async function assertServicesExist(serviceIds: string[]): Promise<void> {
  if (serviceIds.length === 0) return;

  const found = await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true },
  });
  const known = new Set(found.map((service) => service.id));
  const missing = serviceIds.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw badRequest(
      "One of those services does not exist.",
      missing.map((id) => ({ path: "serviceIds", message: `Service ${id} does not exist.` })),
      "SERVICE_NOT_FOUND",
    );
  }
}

/** Deduplicates, because a checkbox list can repeat an id and the join cannot. */
function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

export async function createResource(input: CreateResourceInput): Promise<ResourceSummary> {
  const name = input.name.trim();
  await assertNameAvailable(name);

  const serviceIds = uniqueIds(input.serviceIds ?? []);
  await assertServicesExist(serviceIds);

  const created = await prisma.$transaction(async (tx) => {
    const resource = await tx.resource.create({
      data: {
        // Placeholder: `scopeCreateData` overwrites it with the scope's salon.
        tenantId: "",
        name,
        kind: input.kind,
        status: input.status ?? "ACTIVE",
      },
      select: { id: true },
    });

    // Written as their own top-level rows rather than as a nested create: the
    // tenant scope stamps the tenant on the statement it intercepts, and a nested
    // create is not that statement — it would write the blank placeholder and fail
    // the foreign key.
    if (serviceIds.length > 0) {
      await tx.serviceResource.createMany({
        data: serviceIds.map((serviceId) => ({ tenantId: "", serviceId, resourceId: resource.id })),
      });
    }

    return resource;
  });

  return getResource(created.id);
}

/**
 * Applies a partial update.
 *
 * Absent leaves a field alone; `serviceIds` **replaces** the eligibility set,
 * because a checkbox list can only ever say what is ticked now. The join rows are
 * reconciled in the same transaction as the update, so a resource is never
 * briefly usable by a service the salon just removed.
 */
export async function updateResource(
  id: string,
  input: UpdateResourceInput,
): Promise<ResourceSummary> {
  const existing = await findRow(id);
  if (!existing) throw notFound("That room or equipment does not exist.", "RESOURCE_NOT_FOUND");

  if (input.name !== undefined) await assertNameAvailable(input.name.trim(), id);

  const serviceIds = input.serviceIds === undefined ? undefined : uniqueIds(input.serviceIds);
  if (serviceIds) await assertServicesExist(serviceIds);

  await prisma.$transaction(async (tx) => {
    await tx.resource.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });

    if (!serviceIds) return;

    const current = new Set(existing.services.map((link) => link.serviceId));
    const removed = [...current].filter((serviceId) => !serviceIds.includes(serviceId));
    const added = serviceIds.filter((serviceId) => !current.has(serviceId));

    if (removed.length > 0) {
      await tx.serviceResource.deleteMany({
        where: { resourceId: id, serviceId: { in: removed } },
      });
    }
    if (added.length > 0) {
      await tx.serviceResource.createMany({
        data: added.map((serviceId) => ({ tenantId: "", serviceId, resourceId: id })),
      });
    }
  });

  return getResource(id);
}
