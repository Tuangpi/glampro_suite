/**
 * Staff — handoff screen 09, `GET /api/staff`.
 *
 * **A staff member is a `User` row, not a table of its own.** Legacy settled this
 * (Q4 in `legacy/LEGACY-MAP.md` §6): `EmployeeController::create()` created a
 * `User`, and `employee_leaves.employee_id` was a foreign key onto `users.id`. So
 * this module reads and writes `User` plus its `StaffDepartment` links — and
 * creation supports an email login or a PIN-only POS identity. This is where
 * management sets credentials on another person's behalf.
 *
 * Nothing here can leak credential material: every row is serialised through
 * `staffSummarySchema`, which has no `passwordHash` and no token column, and the
 * select below fetches none. `User` is a wide table — it also carries Google
 * Calendar tokens — so a `select: *` would be a real leak, and AGENTS.md rule 6 is
 * what makes the two lists have to agree.
 *
 * Every function runs inside the tenant scope `middleware/auth.ts` opened, so no
 * function takes a tenant id and another salon's user is simply not found.
 */
import type {
  CreateStaffInput,
  PaginatedResponse,
  StaffDetail,
  StaffListQuery,
  StaffSummary,
  UpdateStaffInput,
} from "@glampro_suite/shared";
import { staffSummarySchema } from "@glampro_suite/shared";

import { badRequest, conflict, notFound } from "../lib/http-error.js";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { paginated, parsePagination } from "../utils/pagination.js";
import { assertDepartmentsExist } from "./department.service.js";

/**
 * Columns the screen reads.
 *
 * `passwordHash`, `tokenVersion` and the `googleCalendar*` trio are deliberately
 * absent: they exist on `User`, and a list response is not the place for any of
 * them. `departments` is the join rows, because each link is what names a branch.
 */
const STAFF_SELECT = {
  id: true,
  name: true,
  email: true,
  globalRole: true,
  phone: true,
  position: true,
  commissionRate: true,
  color: true,
  avatar: true,
  startDate: true,
  endDate: true,
  disabled: true,
  lastLoginAt: true,
  departments: { select: { department: { select: { id: true, name: true } } } },
  createdAt: true,
  updatedAt: true,
} as const;

function findStaffRow(id: string) {
  return prisma.user.findFirst({ where: { id }, select: STAFF_SELECT });
}

/** Inferred from the query above, so a column added to the select cannot go missing. */
type StaffRow = NonNullable<Awaited<ReturnType<typeof findStaffRow>>>;

/** A `DateTime?` on the wire is an ISO string or `null`, never a `Date`. */
function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** A `YYYY-MM-DD` date column comes back as a `DateTime`; the contract wants the date. */
function toDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toSummary(row: StaffRow): StaffSummary {
  return staffSummarySchema.parse({
    id: row.id,
    name: row.name,
    email: row.email,
    globalRole: row.globalRole,
    phone: row.phone,
    position: row.position,
    commissionRate: row.commissionRate.toFixed(2),
    color: row.color,
    avatar: row.avatar,
    // Both are dates on the wire, not timestamps: the form is a date input.
    startDate: toDate(row.startDate),
    endDate: toDate(row.endDate),
    disabled: row.disabled,
    lastLoginAt: iso(row.lastLoginAt),
    departments: row.departments.map((link) => ({
      id: link.department.id,
      name: link.department.name,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * One page of staff, by name or email.
 *
 * `status` is the screen's own three-way choice — `all` / `active` / `disabled` —
 * and `all` sends **neither** filter: a boolean cannot express "either", and an
 * omitted filter has to mean it, so the enum is what makes the third state
 * expressible (`staffListQuerySchema`).
 */
export async function listStaff(query: StaffListQuery): Promise<PaginatedResponse<StaffSummary>> {
  const { page, pageSize, skip, take } = parsePagination(query);

  const where = {
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { email: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(query.role ? { globalRole: query.role } : {}),
    ...(query.status === "active" ? { disabled: false } : {}),
    ...(query.status === "disabled" ? { disabled: true } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: STAFF_SELECT,
      // `id` breaks ties so paging is stable when two people share a name.
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);

  return paginated(rows.map(toSummary), total, { page, pageSize });
}

export async function getStaff(id: string): Promise<StaffDetail> {
  const row = await findStaffRow(id);
  if (!row) throw notFound("That staff member does not exist.", "STAFF_NOT_FOUND");

  return toSummary(row);
}

/**
 * The one conflict a staff form can hit, as a message on the control that caused it.
 *
 * `users.email` is **globally** unique — a person has one login however many salons
 * they work at, which is why it is not per-tenant the way a customer's email is
 * ([ADR 0003](../../../../PROJECT.md#adr-0003)) — while every
 * read in this file is tenant-scoped. So the pre-check catches the salon's own
 * duplicate, and the `P2002` fallback catches the collision with a *different*
 * salon's user, which a scoped read cannot see. Both produce the same 409 with the
 * same field path, because to the person filling the form they are the same thing.
 */
function emailTaken() {
  const message = "That email already has an account.";
  return conflict(message, "EMAIL_TAKEN", [{ path: "body.email", message }]);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Turns Prisma's unique-constraint error into the form's own 409 and lets every
 * other failure through untouched.
 *
 * `never` so that `.catch(rethrowUnique)` keeps the promise's value type: nothing
 * downstream has to consider a recovered value that cannot exist.
 */
function rethrowUnique(error: unknown): never {
  if (isUniqueViolation(error)) throw emailTaken();
  throw error;
}

/**
 * Rewrites a staff member's branch links.
 *
 * `createMany` rather than a nested `create`, for the reason `customer.service.ts`
 * records: the Prisma extension injects `tenantId` into the payload it is handed and
 * cannot reach inside a nested create, so a nested one would leave `tenantId` unset.
 *
 * `undefined` leaves the links alone and `[]` clears them, which is the difference
 * between a form that did not send the field and a picker the user emptied.
 */
async function linkDepartments(userId: string, departmentIds: string[] | undefined): Promise<void> {
  if (departmentIds === undefined) return;

  const unique = [...new Set(departmentIds)];
  await prisma.staffDepartment.deleteMany({ where: { userId } });

  if (unique.length > 0) {
    await prisma.staffDepartment.createMany({
      data: unique.map((departmentId) => ({ tenantId: "", userId, departmentId })),
    });
  }
}

/** `YYYY-MM-DD` from a date input, with `null`/`undefined` passed through. */
function toDateValue(value: string | null | undefined): Date | null | undefined {
  if (value === null || value === undefined) return value;
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Creates the person **and their login** in one call.
 *
 * There is no second table to write: a staff member *is* this row, so this create is
 * the whole record and the `StaffDepartment` links are the one follow-up. The
 * password is hashed on the way in and never stored or logged in the clear, and
 * `tokenVersion` keeps its default, so the new account's first sign-in is ordinary.
 */
export async function createStaff(input: CreateStaffInput): Promise<StaffDetail> {
  const { password, posPin, departmentIds, email, globalRole, startDate, endDate, ...profile } =
    input;
  await assertDepartmentsExist(departmentIds);

  const existing = email
    ? await prisma.user.findFirst({ where: { email }, select: { id: true } })
    : null;
  if (existing) throw emailTaken();

  const created = await prisma.user
    .create({
      data: {
        // Placeholder: `scopeCreateData` overwrites it with the scope's tenant, so a
        // handler cannot create a user in another salon even if it tried.
        tenantId: "",
        ...profile,
        email: email ?? null,
        // The contract defaults this too; repeating it here means the column can
        // never be written as `undefined` if the schema is reshaped.
        globalRole: globalRole ?? "STAFF",
        passwordHash: await hashPassword(password ?? randomBytes(32).toString("hex")),
        posPinHash: posPin ? await hashPassword(posPin) : null,
        startDate: toDateValue(startDate) ?? null,
        endDate: toDateValue(endDate) ?? null,
      },
      select: { id: true },
    })
    .catch(rethrowUnique);

  await linkDepartments(created.id, departmentIds);

  return getStaff(created.id);
}

/**
 * Applies a partial update. An absent field is left alone and `null` clears it.
 *
 * **`disabled` also writes `disabledAt`**, so the column means what it says: set
 * while the account is disabled, cleared when it is restored, refreshed if it is
 * disabled again. Nothing reads it yet — it is the audit trail a later reports phase
 * will want — which is exactly why the pair is kept in step here rather than by
 * whoever writes that report.
 *
 * A role change or a disable needs no token bookkeeping: `auth` re-reads the row on
 * every request, so the person's next call already sees the new role, and a disabled
 * account is refused outright (`middleware/auth.ts`). Bumping `tokenVersion` is for
 * ending sessions on purpose ([ADR 0007](../../../../PROJECT.md#adr-0007)),
 * not for this.
 */
export async function updateStaff(id: string, input: UpdateStaffInput): Promise<StaffDetail> {
  const { departmentIds, startDate, endDate, disabled, posPin, ...fields } = input;
  await assertDepartmentsExist(departmentIds);

  const existing = await prisma.user.findFirst({
    where: { id },
    select: { id: true, email: true },
  });
  if (!existing) throw notFound("That staff member does not exist.", "STAFF_NOT_FOUND");
  if (!existing.email && fields.globalRole && !["STAFF", "CASHIER"].includes(fields.globalRole))
    throw badRequest("PIN-only staff cannot have a management role.");

  await prisma.user.update({
    where: { id },
    data: {
      ...fields,
      ...(posPin !== undefined
        ? {
            posPinHash: posPin === null ? null : await hashPassword(posPin),
            posPinVersion: { increment: 1 },
          }
        : {}),
      ...(disabled !== undefined ? { disabled, disabledAt: disabled ? new Date() : null } : {}),
      // Absent means "leave it alone" and must stay absent; `null` clears the date.
      ...(startDate !== undefined ? { startDate: toDateValue(startDate) ?? null } : {}),
      ...(endDate !== undefined ? { endDate: toDateValue(endDate) ?? null } : {}),
    },
  });

  await linkDepartments(id, departmentIds);

  return getStaff(id);
}
