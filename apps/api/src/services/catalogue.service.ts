/**
 * The catalogue — handoff screen 08, `GET /api/products` and `GET /api/services`.
 *
 * **Services live in this module, not in a service of their own.** There is no
 * `/services` screen and no Services entry on the rail (ADR 0005): services are a
 * tab inside this catalogue and a step in the sale and appointment flows, so to a
 * salon and to the entitlement check they are one feature and share the `catalogue`
 * module.
 *
 * Like `customer.service.ts`, every function runs inside the tenant scope
 * `middleware/auth.ts` opened, so the Prisma extension supplies the `tenantId`
 * filter and no function takes a tenant id as an argument. Rows are serialised
 * **through** the shared Zod schemas rather than by hand, so a column added to
 * `Product` and forgotten here throws instead of reaching the browser outside its
 * contract (AGENTS.md rule 6).
 */
import type { PaginatedResponse } from "@glampro_suite/shared";
import {
  productDetailSchema,
  productSummarySchema,
  serviceDetailSchema,
  serviceSummarySchema,
  type CatalogueListQuery,
  type CreateProductInput,
  type CreateServiceInput,
  type ProductDetail,
  type ProductSummary,
  type ServiceDetail,
  type ServiceSummary,
  type UpdateProductInput,
  type UpdateServiceInput,
} from "@glampro_suite/shared";

import { notFound, validationFailed } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { paginated, parsePagination } from "../utils/pagination.js";
import { assertDepartmentExists } from "./department.service.js";

/**
 * Used only when the tenant row cannot be read, which the `users.tenantId` foreign
 * key we authenticated through makes unreachable. It mirrors the column's own
 * `@default(5)` so a catalogue read degrades to the platform default rather than
 * failing (ADR 0010).
 */
const FALLBACK_LOW_STOCK_THRESHOLD = 5;

/**
 * Columns the screen needs.
 *
 * There is no `cost` and no `supplierId`, because the schema has neither: screen
 * 08 draws a **Cost** column and an **Inventory value** tile from a number the
 * legacy database never held either, and inventing one would make the tile a
 * fabrication (see `PROJECT.md#design-6`). They return when there is a cost
 * to show.
 */
const PRODUCT_SELECT = {
  id: true,
  name: true,
  status: true,
  memberPrice: true,
  nonmemberPrice: true,
  quantity: true,
  points: true,
  description: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} as const;

/** The service equivalent. No `quantity`: a service is not stock. */
const SERVICE_SELECT = {
  id: true,
  name: true,
  status: true,
  memberPrice: true,
  nonmemberPrice: true,
  points: true,
  description: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
  durationMinutes: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Reads the columns a product row is displayed from.
 *
 * The row types are inferred from these queries rather than declared, so a field
 * added to a `*_SELECT` cannot be missing from the type that serialises it.
 */
function findProductRow(id: string) {
  return prisma.product.findFirst({ where: { id }, select: PRODUCT_SELECT });
}

type ProductRow = NonNullable<Awaited<ReturnType<typeof findProductRow>>>;

function findServiceRow(id: string) {
  return prisma.service.findFirst({ where: { id }, select: SERVICE_SELECT });
}

type ServiceRow = NonNullable<Awaited<ReturnType<typeof findServiceRow>>>;

/**
 * The tenant's low-stock threshold.
 *
 * `Tenant` is deliberately **not** in `TENANT_SCOPED_MODELS` (it is the scope
 * itself, not a row inside it), so this read is not filtered for us: it is made
 * safe by naming the id from the ambient scope rather than from the request. There
 * is no argument to forge and no header to spoof (AGENTS.md rule 1, ADR 0010).
 *
 * An explicit `?threshold=` skips the read entirely, which makes the rail badge's
 * request one query cheaper than the table's.
 *
 * Exported because the POS item search computes the same badge for a product row and
 * an answer of its own would be a second opinion about one number.
 */
export async function resolveLowStockThreshold(override?: number): Promise<number> {
  if (override !== undefined) return override;

  const scope = currentScope();
  if (scope?.kind !== "tenant") {
    throw new Error(
      "The low-stock threshold is read inside a tenant scope, and the catalogue " +
        "query ran without one. Wrap it in `runAsTenant()`.",
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: scope.tenantId },
    select: { lowStockThreshold: true },
  });

  return tenant?.lowStockThreshold ?? FALLBACK_LOW_STOCK_THRESHOLD;
}

/** A `Decimal(12,2)` on the wire is a string, so no cent is lost to a float. */
function money(value: { toFixed: (digits: number) => string }): string {
  return value.toFixed(2);
}

function toProduct(row: ProductRow, threshold: number): ProductSummary {
  return productSummarySchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    memberPrice: money(row.memberPrice),
    nonmemberPrice: money(row.nonmemberPrice),
    quantity: row.quantity,
    points: row.points,
    description: row.description,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    // Computed here, never in the browser: the badge counts the whole catalogue
    // while the browser only ever holds one page of it (ADR 0010).
    lowStock: row.quantity <= threshold,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toService(row: ServiceRow): ServiceSummary {
  return serviceSummarySchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    memberPrice: money(row.memberPrice),
    nonmemberPrice: money(row.nonmemberPrice),
    points: row.points,
    description: row.description,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    durationMinutes: row.durationMinutes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * The filter both catalogue lists apply.
 *
 * The screen's own placeholder is "Search items…", so one box matches the name or
 * the description rather than making the user pick which field they typed into.
 */
function catalogueWhere(query: CatalogueListQuery) {
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
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
  };
}

/** One page of products, by name, with the server-side total. */
export async function listProducts(
  query: CatalogueListQuery,
): Promise<PaginatedResponse<ProductSummary>> {
  const { page, pageSize, skip, take } = parsePagination(query);
  const threshold = await resolveLowStockThreshold(query.threshold);

  const where = {
    ...catalogueWhere(query),
    // The stat tile and the rail badge are counts over the **whole** catalogue,
    // which a single page cannot compute — so `?lowStock=true` is a server-side
    // filter, not a sort the browser applies to the rows it happens to hold.
    ...(query.lowStock ? { quantity: { lte: threshold } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: PRODUCT_SELECT,
      // `id` breaks ties so paging is stable when two products share a name.
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take,
    }),
    prisma.product.count({ where }),
  ]);

  return paginated(
    rows.map((row) => toProduct(row, threshold)),
    total,
    { page, pageSize },
  );
}

export async function getProduct(id: string): Promise<ProductDetail> {
  const row = await findProductRow(id);
  if (!row) throw notFound("That product does not exist.", "PRODUCT_NOT_FOUND");

  return productDetailSchema.parse(toProduct(row, await resolveLowStockThreshold()));
}

/** `quantity` and `points` default to zero in the schema, so they may be absent. */
export async function createProduct(input: CreateProductInput): Promise<ProductDetail> {
  const { departmentId, ...fields } = input;
  await assertDepartmentExists(departmentId);

  const created = await prisma.product.create({
    data: {
      // Placeholder: `scopeCreateData` overwrites it with the scope's tenant, so a
      // handler cannot place a row in another salon even if it tried.
      tenantId: "",
      ...fields,
      // `null`, not `undefined`: a new product with no branch is unassigned, which
      // is a real state the Products tab renders as "—".
      departmentId: departmentId ?? null,
    },
    select: { id: true },
  });

  return getProduct(created.id);
}

/**
 * Applies a partial update.
 *
 * An absent field is left alone and an explicit `null` clears it — the update
 * schema distinguishes the two, and spreading `fields` preserves that, because
 * Prisma skips `undefined` and writes `null`. `quantity` is deliberately not
 * nullable: stock is corrected by an adjustment, not by erasing it.
 */
export async function updateProduct(id: string, input: UpdateProductInput): Promise<ProductDetail> {
  const { departmentId, ...fields } = input;
  await assertDepartmentExists(departmentId);

  const existing = await prisma.product.findFirst({ where: { id }, select: { id: true } });
  if (!existing) throw notFound("That product does not exist.", "PRODUCT_NOT_FOUND");

  await prisma.product.update({
    where: { id },
    data: {
      ...fields,
      // Only when the form sent it: `undefined` here means "leave the branch
      // alone", while `null` means "unassign" and must reach Prisma.
      ...(departmentId !== undefined ? { departmentId } : {}),
    },
  });

  return getProduct(id);
}

/**
 * One page of services, by name, with the server-side total.
 *
 * `?lowStock` is ignored rather than rejected: the tab and the table share one
 * query string, and a service is not stock — `serviceSummarySchema` has no
 * `quantity` and no `lowStock` to filter on.
 */
export async function listServices(
  query: CatalogueListQuery,
): Promise<PaginatedResponse<ServiceSummary>> {
  const { page, pageSize, skip, take } = parsePagination(query);
  const where = catalogueWhere(query);

  const [rows, total] = await Promise.all([
    prisma.service.findMany({
      where,
      select: SERVICE_SELECT,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take,
    }),
    prisma.service.count({ where }),
  ]);

  return paginated(rows.map(toService), total, { page, pageSize });
}

export async function getService(id: string): Promise<ServiceDetail> {
  const row = await findServiceRow(id);
  if (!row) throw notFound("That service does not exist.", "SERVICE_NOT_FOUND");

  return serviceDetailSchema.parse(toService(row));
}

export async function createService(input: CreateServiceInput): Promise<ServiceDetail> {
  const { departmentId, ...fields } = input;
  await assertDepartmentExists(departmentId);

  const created = await prisma.service.create({
    data: {
      // Placeholder: `scopeCreateData` overwrites it with the scope's tenant, so a
      // handler cannot place a row in another salon even if it tried.
      tenantId: "",
      ...fields,
      departmentId: departmentId ?? null,
    },
    select: { id: true },
  });

  return getService(created.id);
}

/**
 * `durationMinutes` is nullable here even though booking needs it: a migrated salon
 * has services with no duration until someone fills it in, and the appointment flow
 * is where a missing duration becomes a blocking question — not this form.
 */
export async function updateService(id: string, input: UpdateServiceInput): Promise<ServiceDetail> {
  const { departmentId, ...fields } = input;
  await assertDepartmentExists(departmentId);

  const existing = await prisma.service.findFirst({ where: { id }, select: { id: true } });
  if (!existing) throw notFound("That service does not exist.", "SERVICE_NOT_FOUND");

  await prisma.service.update({
    where: { id },
    data: {
      ...fields,
      ...(departmentId !== undefined ? { departmentId } : {}),
    },
  });

  return getService(id);
}

/**
 * Refuses service ids that are not this salon's.
 *
 * The sibling of `assertDepartmentsExist`, and here for the same reason: a package
 * is sold against a set of services (`PackageService`, from legacy
 * `package_services`), and a forged id would otherwise become a cross-tenant link
 * row. `Service` is tenant-scoped, so this query cannot see another salon's rows and
 * a foreign id fails the count rather than linking.
 *
 * `validationFailed` rather than `notFound`, so the 422 carries `details[].path` and
 * the package form puts the message on the control that caused it.
 */
export async function assertServicesExist(
  ids: string[] | undefined,
  path = "body.serviceIds",
): Promise<void> {
  if (!ids || ids.length === 0) return;

  const wanted = [...new Set(ids)];
  const found = await prisma.service.findMany({
    where: { id: { in: wanted } },
    select: { id: true },
  });

  if (found.length !== wanted.length) {
    throw validationFailed([{ path, message: "One or more selected services do not exist." }]);
  }
}
