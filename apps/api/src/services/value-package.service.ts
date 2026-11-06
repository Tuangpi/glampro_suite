/**
 * Value packages — prepaid credit, `/api/value-packages`.
 *
 * The row here is the **shelf item** the salon sells ("pay 545, get 600 to spend"),
 * not the credit a customer holds: selling one writes a
 * `CustomerValuePackageHolding`, which is where the balance and the expiry live.
 * Legacy drew the same line — `valuepackages` was the catalogue row and
 * `customer_valuepackages` the balance.
 *
 * It lives under the `packages` add-on rather than a module of its own, because the
 * two are the two shapes of "pay up front" and a salon buys them together. That is
 * also why writes are manager-only: the same mount that lets a manager set the
 * prepaid validity (`PATCH /api/packages/prepaid/:id/validity`) now sets the price
 * and the credit, and a staff-level editor would be a way around that guard.
 *
 * There is **no `delete`**, here or anywhere: `ValuePackageService` and
 * `CustomerValuePackageHolding` cascade from this row, so deleting it would erase
 * purchase and redemption history. `status: INACTIVE` retires a package from the
 * till — `sale.service.ts` already searches `status: "ACTIVE"` only — and leaves
 * every past sale alone.
 */
import {
  createValuePackageSchema,
  updateValuePackageSchema,
  valuePackageDetailSchema,
  valuePackageSummarySchema,
  type CatalogueListQuery,
  type CreateValuePackageInput,
  type PaginatedResponse,
  type UpdateValuePackageInput,
  type ValuePackageDetail,
  type ValuePackageSummary,
} from "@glampro_suite/shared";

import { notFound } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { paginated, parsePagination } from "../utils/pagination.js";
import { assertServicesExist } from "./catalogue.service.js";

/**
 * The columns the tab and the editor read.
 *
 * `services` is one relation rather than a `serviceCount` plus a second read, so the
 * table's count and the editor's checkbox list are the same array and cannot
 * disagree about what a package was designed for.
 */
const VALUE_PACKAGE_SELECT = {
  id: true,
  name: true,
  status: true,
  price: true,
  credit: true,
  validityDays: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  services: { select: { service: { select: { id: true, name: true } } } },
} as const;

function findValuePackageRow(id: string) {
  return prisma.valuePackage.findFirst({ where: { id }, select: VALUE_PACKAGE_SELECT });
}

type ValuePackageRow = NonNullable<Awaited<ReturnType<typeof findValuePackageRow>>>;
type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** A `Decimal(12,2)` on the wire is a string, so no cent is lost to a float. */
function money(value: { toFixed: (digits: number) => string }): string {
  return value.toFixed(2);
}

/** The linked services, by name, so the editor lists them in a stable order. */
function linkedServices(row: ValuePackageRow): Array<{ id: string; name: string }> {
  return row.services
    .map((link) => link.service)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function toValuePackage(row: ValuePackageRow): ValuePackageSummary {
  return valuePackageSummarySchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    price: money(row.price),
    credit: money(row.credit),
    validityDays: row.validityDays,
    description: row.description,
    serviceCount: row.services.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toValuePackageDetail(row: ValuePackageRow): ValuePackageDetail {
  return valuePackageDetailSchema.parse({
    ...toValuePackage(row),
    services: linkedServices(row),
  });
}

/**
 * The filter this list applies.
 *
 * The screen's one search box matches the name or the description, like the other
 * tabs. `?departmentId=` and `?lowStock=` are **ignored rather than rejected** — all
 * the tabs share one toolbar and one query string, and prepaid credit has neither a
 * branch nor stock to filter on. `?status=` is honoured, because a value package
 * *has* a status and "show me the retired ones" is a real question.
 */
function valuePackageWhere(query: CatalogueListQuery) {
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

/** One page of value packages, by name, with the server-side total. */
export async function listValuePackages(
  query: CatalogueListQuery,
): Promise<PaginatedResponse<ValuePackageSummary>> {
  const { page, pageSize, skip, take } = parsePagination(query);
  const where = valuePackageWhere(query);

  const [rows, total] = await Promise.all([
    prisma.valuePackage.findMany({
      where,
      select: VALUE_PACKAGE_SELECT,
      // `id` breaks ties so paging is stable when two packages share a name.
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take,
    }),
    prisma.valuePackage.count({ where }),
  ]);

  return paginated(rows.map(toValuePackage), total, { page, pageSize });
}

export async function getValuePackage(id: string): Promise<ValuePackageDetail> {
  const row = await findValuePackageRow(id);
  if (!row) throw notFound("That value package does not exist.", "VALUE_PACKAGE_NOT_FOUND");

  return toValuePackageDetail(row);
}

export async function createValuePackage(
  input: CreateValuePackageInput,
): Promise<ValuePackageDetail> {
  const { serviceIds, ...fields } = createValuePackageSchema.parse(input);
  await assertServicesExist(serviceIds);

  const created = await prisma.$transaction(async (tx) => {
    const created = await tx.valuePackage.create({
      data: {
        // Placeholder: `scopeCreateData` overwrites it with the scope's tenant, so a
        // handler cannot place a row in another salon even if it tried.
        tenantId: "",
        ...fields,
        // `null`, not `undefined`: a new package with no description has none, and
        // "never expires" is a real product rather than a missing number.
        description: fields.description ?? null,
        validityDays: fields.validityDays ?? null,
      },
      select: { id: true },
    });

    await replaceServices(created.id, serviceIds, tx);
    return created;
  });

  return getValuePackage(created.id);
}

/**
 * Applies a partial update.
 *
 * An absent field is left alone and an explicit `null` clears it — the update schema
 * distinguishes the two, and spreading `fields` preserves that, because Prisma skips
 * `undefined` and writes `null`.
 *
 * The change reaches **future sales only**: a holding stores its own `amount` and
 * the net the customer paid, so repricing a package cannot rewrite a balance someone
 * already owns.
 */
export async function updateValuePackage(
  id: string,
  input: UpdateValuePackageInput,
): Promise<ValuePackageDetail> {
  const { serviceIds, ...fields } = updateValuePackageSchema.parse(input);
  await assertServicesExist(serviceIds);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.valuePackage.findFirst({ where: { id }, select: { id: true } });
    if (!existing) throw notFound("That value package does not exist.", "VALUE_PACKAGE_NOT_FOUND");

    // Guarded because `serviceIds` alone is a legitimate patch body, and an empty
    // `data` object is a write that changes nothing.
    if (Object.keys(fields).length > 0) {
      await tx.valuePackage.update({ where: { id }, data: fields });
    }

    await replaceServices(id, serviceIds, tx);
  });

  return getValuePackage(id);
}

/**
 * Rewrites the `ValuePackageService` links in one go.
 *
 * **Absent means unchanged**, which is why this returns immediately for `undefined`;
 * an empty array is how a form says "designed for nothing in particular now", and
 * `[]` is a value an absent key is not.
 *
 * `deleteMany` + `createMany` rather than a nested `create`, for the same reason
 * `package.service.ts` does it: the Prisma extension merges `tenantId` into the
 * payload it is handed and cannot reach inside a nested create. Duplicates are
 * collapsed first — the join table is unique on `[valuePackageId, serviceId]`, and
 * double-ticking a service in the form is not a 500.
 */
async function replaceServices(
  valuePackageId: string,
  serviceIds: string[] | undefined,
  tx: Transaction,
): Promise<void> {
  if (serviceIds === undefined) return;

  await tx.valuePackageService.deleteMany({ where: { valuePackageId } });

  const unique = [...new Set(serviceIds)];
  if (unique.length === 0) return;

  await tx.valuePackageService.createMany({
    data: unique.map((serviceId) => ({ tenantId: "", valuePackageId, serviceId })),
  });
}
