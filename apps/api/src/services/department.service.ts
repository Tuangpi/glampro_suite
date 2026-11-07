/**
 * Departments (the `Department` table) — the picker behind every catalogue and staff
 * form, served by `GET /api/departments`.
 *
 * It lives in its own module rather than inside `catalogue.service.ts` because it
 * is not catalogue-specific: staff, and later appointments and reports, all need
 * the same list. `assertDepartmentsExist` is here for the same reason — the
 * check that a submitted branch id belongs to the caller's salon is one rule, and
 * four callers were about to grow four copies of it.
 *
 * Reads run in the tenant scope `middleware/auth.ts` opened, so `Department` being
 * tenant-scoped means a foreign branch id simply is not found.
 */
import {
  departmentSchema,
  type DepartmentSummary,
  type SaveDepartmentInput,
  type DepartmentDeletionImpact,
} from "@glampro_suite/shared";

import { conflict, forbidden, notFound, validationFailed } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { lockCommissionConfiguration } from "./commission.service.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function deletionImpact(tx: Transaction, id: string): Promise<DepartmentDeletionImpact> {
  const department = await tx.department.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      // Count all relationships, including catalogue items in other outlets.
      _count: { select: { products: true, services: true, staff: true, customers: true } },
    },
  });
  if (!department) throw notFound("Department not found.");
  const commissionRules = await tx.commissionRule.count({
    where: { scope: "DEPARTMENT", targetId: id },
  });
  return { id: department.id, name: department.name, ...department._count, commissionRules };
}

/** Advisory preview only: deletion rechecks everything inside its transaction. */
export async function getDepartmentDeletionImpact(id: string): Promise<DepartmentDeletionImpact> {
  return prisma.$transaction((tx) => deletionImpact(tx, id));
}

export async function deleteDepartment(
  id: string,
  actorId: string,
): Promise<DepartmentDeletionImpact> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Department deletion requires tenant scope.");
  return prisma.$transaction(async (tx) => {
    // The same lock as commission publication prevents a rule being published
    // between our reference check and deletion. Lock order stays tenant first.
    await lockCommissionConfiguration(tx, scope.tenantId);
    const tenant = await tx.tenant.findUnique({
      where: { id: scope.tenantId },
      select: { status: true },
    });
    if (tenant?.status !== "ACTIVE")
      throw forbidden(
        "Your salon is read-only. Department deletion is disabled.",
        "TENANT_SUSPENDED",
      );
    await tx.$queryRaw`SELECT id FROM departments WHERE id = ${id} AND "tenantId" = ${scope.tenantId} FOR UPDATE`;
    const impact = await deletionImpact(tx, id);
    if (impact.commissionRules > 0) {
      throw conflict(
        "This department has commission rules and cannot be deleted. Historical rules must be preserved.",
        "DEPARTMENT_HAS_COMMISSION_RULES",
      );
    }
    // Existing FKs SET NULL on products/services and CASCADE only the join rows
    // for staff/customers. No related business record is deleted.
    await tx.department.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        tenantId: scope.tenantId,
        action: "department.delete",
        targetType: "Department",
        targetId: id,
        metadata: { actorId, ...impact },
      },
    });
    return impact;
  });
}

/** The database unique constraint also protects concurrent writes. */
function rethrowDepartmentError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "P2002") {
      throw conflict("A department with that name already exists.", "DEPARTMENT_NAME_EXISTS", [
        { path: "body.name", message: "A department with that name already exists." },
      ]);
    }
    if (error.code === "P2025") throw notFound("Department not found.");
  }
  throw error;
}

export async function createDepartment(input: SaveDepartmentInput): Promise<DepartmentSummary> {
  try {
    return await prisma.department.create({
      // The Prisma tenant extension supplies the authenticated salon's id.
      data: { tenantId: "", name: input.name },
      select: { id: true, name: true },
    });
  } catch (error) {
    rethrowDepartmentError(error);
  }
}

export async function renameDepartment(
  id: string,
  input: SaveDepartmentInput,
): Promise<DepartmentSummary> {
  try {
    return await prisma.department.update({
      where: { id },
      data: { name: input.name },
      select: { id: true, name: true },
    });
  } catch (error) {
    rethrowDepartmentError(error);
  }
}

/** Every department in the caller's salon, by name. Never paginated — a salon has few. */
export async function listDepartments(): Promise<DepartmentSummary[]> {
  const rows = await prisma.department.findMany({
    select: { id: true, name: true },
    // `id` breaks ties so the picker's order is stable across requests.
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  return rows.map((row) => departmentSchema.parse({ id: row.id, name: row.name }));
}

/**
 * Refuses branch ids that are not this salon's.
 *
 * `Department` is tenant-scoped, so this query cannot see another tenant's rows
 * and a forged id fails the count rather than creating a cross-tenant link row.
 * Throwing `validationFailed` rather than `notFound` is what lets the form put the
 * message on the branch control: `details[].path` names the field.
 *
 * `path` defaults to the plural form the customer form uses; a caller taking a
 * single `departmentId` passes `"body.departmentId"`.
 */
export async function assertDepartmentsExist(
  ids: string[] | undefined,
  path = "body.departmentIds",
): Promise<void> {
  if (!ids || ids.length === 0) return;

  const wanted = [...new Set(ids)];
  const found = await prisma.department.findMany({
    where: { id: { in: wanted } },
    select: { id: true },
  });

  if (found.length !== wanted.length) {
    throw validationFailed([
      {
        path,
        message:
          path === "body.departmentIds"
            ? "One or more selected branches do not exist."
            : "That branch does not exist.",
      },
    ]);
  }
}

/**
 * The single-branch form of the check, for the optional `departmentId` on a
 * product or a service.
 *
 * `null` and `undefined` both pass: one clears the field, the other leaves it
 * alone, and neither names a branch that could be missing.
 */
export async function assertDepartmentExists(
  id: string | null | undefined,
  path = "body.departmentId",
): Promise<void> {
  if (id === null || id === undefined) return;
  await assertDepartmentsExist([id], path);
}

/**
 * The ids of the branches a user is linked to, for the staff list.
 *
 * Kept here so `staff.service.ts` does not have to reach into `StaffDepartment`
 * itself for a read that is really about departments.
 */
export async function departmentIdsForUser(userId: string): Promise<string[]> {
  const links = await prisma.staffDepartment.findMany({
    where: { userId },
    select: { departmentId: true },
  });

  return links.map((link) => link.departmentId);
}
