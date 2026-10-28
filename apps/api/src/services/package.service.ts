/**
 * Packages — the third tab of handoff screen 08, `/api/packages`.
 *
 * A module of its own rather than a third branch of `catalogue.service.ts`, because
 * a package is a separate **resource with its own entitlement** and not another
 * shape of product: `packages` is an add-on module code, a bundle has sessions
 * instead of stock, it belongs to no branch, and it may be spent only on the
 * services it names.
 *
 * Like every other service here, each function runs inside the tenant scope
 * `middleware/auth.ts` opened, so none of them takes a tenant id and a foreign id is
 * simply not found. Rows are serialised **through** the shared Zod schemas, so a
 * column added to `Package` and forgotten here throws instead of reaching the
 * browser outside its contract (AGENTS.md rule 6).
 */
import {
  packageDetailSchema,
  packageSummarySchema,
  createPackageSchema,
  updatePackageSchema,
  payrollPackageSettingsSchema,
  type CatalogueListQuery,
  type CreatePackageInput,
  type PackageDetail,
  type PackageSummary,
  type PaginatedResponse,
  type UpdatePackageInput,
} from "@glampro_suite/shared";

import { badRequest, conflict, forbidden, notFound } from "../lib/http-error.js";
import { currentScope } from "../lib/tenant-context.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { prisma } from "../lib/prisma.js";
import { paginated, parsePagination } from "../utils/pagination.js";
import { assertServicesExist } from "./catalogue.service.js";

/**
 * The columns the tab and the editor read.
 *
 * `services` is one relation rather than a `serviceCount` plus a second read: the
 * table's count and the editor's checkbox list are then the same array, so the two
 * can never disagree about what a bundle covers.
 */
const PACKAGE_SELECT = {
  commissionSettings: true,
  redemptionMode: true,
  serviceSet: true,
  id: true,
  name: true,
  status: true,
  sessionCount: true,
  validityDays: true,
  memberPrice: true,
  nonmemberPrice: true,
  description: true,
  familyId: true,
  createdAt: true,
  updatedAt: true,
  services: { select: { service: { select: { id: true, name: true } } } },
} as const;

function findPackageRow(id: string) {
  return prisma.package.findFirst({ where: { id }, select: PACKAGE_SELECT });
}

type PackageRow = NonNullable<Awaited<ReturnType<typeof findPackageRow>>>;
type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function commissionActor(tx: Transaction) {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId)
    throw forbidden("An authenticated salon owner is required.");
  await lockPrepaid(tx, scope.tenantId);
  const actor = await tx.user.findFirst({ where: { id: scope.actorId, disabled: false } });
  if (actor?.globalRole !== "SUPER_ADMIN" || !actor.twoFactorEnabled)
    throw forbidden("Only a verified salon owner can configure package commissions.");
}

async function auditCommission(
  tx: Transaction,
  id: string,
  reason: string,
  before: PackageRow["commissionSettings"],
  settings: unknown,
) {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
  await tx.auditLog.create({
    data: {
      tenantId: scope.tenantId,
      action: "package.commission.configure",
      targetType: "Package",
      targetId: id,
      metadata: {
        actorId: scope.actorId,
        reason,
        before,
        after: payrollPackageSettingsSchema.parse(settings),
      },
    },
  });
}

/**
 * A `Decimal(12,2)` on the wire is a string, so no cent is lost to a float. The
 * same rule `catalogue.service.ts` applies to a price.
 */
function money(value: { toFixed: (digits: number) => string }): string {
  return value.toFixed(2);
}

/** The covered services, by name, so the editor lists them in a stable order. */
function coveredServices(row: PackageRow): Array<{ id: string; name: string }> {
  return row.services
    .map((link) => link.service)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function toPackage(row: PackageRow): PackageSummary {
  return packageSummarySchema.parse({
    commissionSettings: row.commissionSettings,
    redemptionMode: row.redemptionMode,
    serviceSet: row.serviceSet,
    id: row.id,
    name: row.name,
    status: row.status,
    sessionCount: row.sessionCount,
    validityDays: row.validityDays,
    memberPrice: money(row.memberPrice),
    nonmemberPrice: money(row.nonmemberPrice),
    description: row.description,
    serviceCount: row.services.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toPackageDetail(row: PackageRow): PackageDetail {
  return packageDetailSchema.parse({
    ...toPackage(row),
    services: coveredServices(row),
  });
}

/**
 * The filter this list applies.
 *
 * The screen's one search box matches the name or the description, exactly as it
 * does on the other tabs. `?departmentId=` and `?lowStock=` are **ignored rather
 * than rejected**: all four tabs share one toolbar and one query string, and a
 * package has neither a branch nor stock to filter on — the same arrangement that
 * lets a service ignore `?lowStock`.
 */
function packageWhere(query: CatalogueListQuery) {
  return {
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { description: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(query.status ? { status: query.status } : {}),
  };
}

/** One page of packages, by name, with the server-side total. */
export async function listPackages(
  query: CatalogueListQuery,
): Promise<PaginatedResponse<PackageSummary>> {
  const { page, pageSize, skip, take } = parsePagination(query);
  const where = packageWhere(query);

  const [rows, total] = await Promise.all([
    prisma.package.findMany({
      where,
      select: PACKAGE_SELECT,
      // `id` breaks ties so paging is stable when two bundles share a name.
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take,
    }),
    prisma.package.count({ where }),
  ]);

  return paginated(rows.map(toPackage), total, { page, pageSize });
}

export async function getPackage(id: string): Promise<PackageDetail> {
  const row = await findPackageRow(id);
  if (!row) throw notFound("That package does not exist.", "PACKAGE_NOT_FOUND");

  return toPackageDetail(row);
}

/** Prepaid credit has no general catalogue editor; configure future grants only. */
export async function updatePrepaidValidity(id: string, validityDays: number | null) {
  const updated = await prisma.valuePackage.updateMany({
    where: { id },
    data: { validityDays },
  });
  if (updated.count === 0) {
    throw notFound("That prepaid package does not exist.", "VALUE_PACKAGE_NOT_FOUND");
  }
  return { id, validityDays };
}

export async function createPackage(input: CreatePackageInput): Promise<PackageDetail> {
  const { serviceIds, familyId, commissionSettings, commissionReason, ...fields } =
    createPackageSchema.parse(input);
  await assertServicesExist(serviceIds);
  await validateServiceSet(
    input.redemptionMode ?? "PER_UNIT",
    input.serviceSet ?? [],
    serviceIds ?? [],
  );

  const created = await prisma.$transaction(async (tx) => {
    if (commissionSettings) await commissionActor(tx);
    const created = await tx.package.create({
      data: {
        // Placeholder: `scopeCreateData` overwrites it with the scope's tenant, so a
        // handler cannot place a row in another salon even if it tried.
        tenantId: "",
        ...fields,
        ...(commissionSettings ? { commissionSettings } : {}),
        // `null`, not `undefined`: a new bundle with no description has none, which
        // is a real state the editor renders as an empty box.
        description: fields.description ?? null,
        ...(familyId !== undefined ? { familyId } : {}),
      },
      select: { id: true },
    });

    await replaceServices(created.id, serviceIds, tx);
    if (commissionSettings)
      await auditCommission(tx, created.id, commissionReason!, null, commissionSettings);
    return created;
  });

  return getPackage(created.id);
}

/**
 * Applies a partial update.
 *
 * An absent field is left alone and an explicit `null` clears it — the update
 * schema distinguishes the two, and spreading `fields` preserves that, because
 * Prisma skips `undefined` and writes `null`.
 */
export async function updatePackage(id: string, input: UpdatePackageInput): Promise<PackageDetail> {
  const {
    serviceIds,
    familyId,
    commissionSettings,
    commissionReason,
    expectedUpdatedAt,
    ...fields
  } = updatePackageSchema.parse(input);
  await assertServicesExist(serviceIds);

  await prisma.$transaction(async (tx) => {
    if (commissionSettings) await commissionActor(tx);
    const locked = await tx.package.updateMany({
      where: { id, ...(commissionSettings ? { updatedAt: new Date(expectedUpdatedAt!) } : {}) },
      data: { sessionCount: { increment: 0 } },
    });
    if (commissionSettings && locked.count === 0) {
      if (!(await tx.package.findFirst({ where: { id }, select: { id: true } })))
        throw notFound("That package does not exist.", "PACKAGE_NOT_FOUND");
      throw conflict("Package changed. Reload before configuring commissions.");
    }
    const existing = await tx.package.findFirst({ where: { id }, select: PACKAGE_SELECT });
    if (!existing) throw notFound("That package does not exist.", "PACKAGE_NOT_FOUND");
    const prior = packageSummarySchema.parse({ ...toPackage(existing) });
    await validateServiceSet(
      input.redemptionMode ?? prior.redemptionMode ?? "PER_UNIT",
      input.serviceSet ?? prior.serviceSet ?? [],
      serviceIds ?? existing.services.map((row) => row.service.id),
    );

    // Guarded because `serviceIds` alone is a legitimate patch body, and an empty
    // `data` object is a write that changes nothing.
    if (Object.keys(fields).length > 0 || familyId !== undefined || commissionSettings) {
      await tx.package.update({
        where: { id },
        data: {
          ...fields,
          ...(commissionSettings ? { commissionSettings } : {}),
          ...(familyId !== undefined ? { familyId } : {}),
        },
      });
    }

    await replaceServices(id, serviceIds, tx);
    if (commissionSettings)
      await auditCommission(
        tx,
        id,
        commissionReason!,
        existing.commissionSettings,
        commissionSettings,
      );
  });

  return getPackage(id);
}

async function validateServiceSet(
  mode: string,
  set: { serviceId: string; quantity: number }[],
  serviceIds: string[],
) {
  if (new Set(set.map((row) => row.serviceId)).size !== set.length)
    throw badRequest(
      "A service can appear only once in a service set.",
      undefined,
      "PACKAGE_SET_INVALID",
    );
  await assertServicesExist(set.map((row) => row.serviceId));
  if (
    mode === "SERVICE_SET" &&
    (set.length === 0 ||
      set.length !== new Set(serviceIds).size ||
      set.some((row) => !serviceIds.includes(row.serviceId)))
  )
    throw badRequest(
      "A service-set package needs a positive required quantity for every covered service.",
      undefined,
      "PACKAGE_SET_INVALID",
    );
}

/**
 * Rewrites the `PackageService` links in one go.
 *
 * **Absent means unchanged**, which is why this returns immediately for
 * `undefined`; an empty array is how a form says "this bundle covers nothing now",
 * and `[]` is a value an absent key is not.
 *
 * `deleteMany` + `createMany` rather than a nested `create`, because the Prisma
 * extension merges `tenantId` into the payload it is handed and cannot reach inside
 * a nested create (the same reason `customer.service.ts` links its branches this
 * way). Duplicates are collapsed first: the join table is unique on
 * `[packageId, serviceId]`, and double-ticking a service in the form is not a 500.
 */
async function replaceServices(
  packageId: string,
  serviceIds: string[] | undefined,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<void> {
  if (serviceIds === undefined) return;

  await tx.packageService.deleteMany({ where: { packageId } });

  const unique = [...new Set(serviceIds)];
  if (unique.length === 0) return;

  await tx.packageService.createMany({
    data: unique.map((serviceId) => ({ tenantId: "", packageId, serviceId })),
  });
}
