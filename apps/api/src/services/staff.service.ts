/**
 * Staff — handoff screen 09, `GET /api/staff`.
 *
 * **A staff member is a `User` row, not a table of its own.** Legacy settled this
 * (Q4 in `legacy/LEGACY-MAP.md` §6): `EmployeeController::create()` created a
 * `User`, and `employee_leaves.employee_id` was a foreign key onto `users.id`. So
 * this module reads and writes `User` plus its `StaffDepartment` links, and every
 * creation carries an email and a password: this is where management sets
 * credentials on another person's behalf. The optional `posPin` is a till
 * credential, not a login — see `createStaffSchema` for what it gates.
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
  GlobalRole,
  PaginatedResponse,
  ResetStaffPasswordInput,
  StaffDetail,
  StaffListQuery,
  StaffSummary,
  UpdateStaffInput,
} from "@glampro_suite/shared";
import {
  adminPasswordSchema,
  staffSummarySchema,
  payrollAssignmentSchema,
  createStaffSchema,
} from "@glampro_suite/shared";

import { badRequest, conflict, forbidden, notFound, validationFailed } from "../lib/http-error.js";
import { hashPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { paginated, parsePagination } from "../utils/pagination.js";
import { assertDepartmentsExist } from "./department.service.js";
import { requireScope } from "../lib/tenant-context.js";
import {
  createStaffWithPayroll,
  assertStaffPayrollLifecycle,
} from "./payroll-configuration.service.js";
import { lockCommissionConfiguration } from "./commission.service.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

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
async function linkDepartments(
  userId: string,
  departmentIds: string[] | undefined,
  db: Pick<Transaction, "staffDepartment"> = prisma,
): Promise<void> {
  if (departmentIds === undefined) return;

  const unique = [...new Set(departmentIds)];
  await db.staffDepartment.deleteMany({ where: { userId } });

  if (unique.length > 0) {
    await db.staffDepartment.createMany({
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
 * A staff member is this User row. Department links, required payroll classification
 * and any initial payroll assignment are created in the same transaction. The
 * password is hashed on the way in and never stored or logged in the clear, and
 * `tokenVersion` keeps its default, so the new account's first sign-in is ordinary.
 */
export async function createStaff(input: CreateStaffInput): Promise<StaffDetail> {
  // Validate direct service callers too; no identity-only bypass around the HTTP contract.
  if (!input.payrollClassification)
    throw badRequest("An explicit reasoned payroll classification is required for staff creation.");
  input = createStaffSchema.parse(input);
  const {
    password,
    posPin,
    departmentIds,
    email,
    globalRole,
    startDate,
    endDate,
    payrollAssignment,
    payrollClassification,
    ...profile
  } = input;
  await assertDepartmentsExist(departmentIds);
  if (payrollClassification && !startDate)
    throw badRequest("A join date is required with a payroll classification.");
  if (payrollClassification?.commissionRole === "COMMISSION_EARNING" && !payrollAssignment)
    throw badRequest("Commission-earning staff require an initial payroll plan.");
  if (payrollAssignment && !startDate)
    throw badRequest("A join date is required with a payroll plan.");
  const existing = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (existing) throw emailTaken();
  // Hash before acquiring the configuration lock.
  const passwordHash = await hashPassword(password);
  const posPinHash = posPin ? await hashPassword(posPin) : null;
  const create = async (tx: Transaction) => {
    const row = await tx.user.create({
      data: {
        tenantId: "",
        ...profile,
        email,
        globalRole: globalRole ?? "STAFF",
        passwordHash,
        posPinHash,
        startDate: toDateValue(startDate) ?? null,
        endDate: toDateValue(endDate) ?? null,
      },
      select: { id: true },
    });
    await linkDepartments(row.id, departmentIds, tx);
    return row;
  };
  const created = await createStaffWithPayroll(
    payrollAssignment,
    create,
    payrollClassification,
  ).catch(rethrowUnique);

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
  const {
    departmentIds,
    startDate,
    expectedStartDate,
    endDate,
    disabled,
    posPin,
    commissionRate,
    ...fields
  } = input;
  await assertDepartmentsExist(departmentIds);
  // Hash before acquiring the tenant configuration lock.
  const pinHash = typeof posPin === "string" ? await hashPassword(posPin) : null;

  await prisma.$transaction(async (tx) => {
    const scope = requireScope("User");
    if (scope.kind === "tenant") await lockCommissionConfiguration(tx, scope.tenantId);
    const existing = await tx.user.findFirst({
      where: { id },
      select: { id: true, commissionRate: true, startDate: true, disabled: true },
    });
    if (!existing) throw notFound("That staff member does not exist.", "STAFF_NOT_FOUND");
    if (startDate !== undefined) {
      if (expectedStartDate === undefined)
        throw badRequest("Reload the staff record before changing the start date.");
      if (toDate(existing.startDate) !== expectedStartDate)
        throw conflict("Staff start date changed. Reload before saving.");
      // Payroll join dates must pass the audited payroll configuration workflow.
      const payrollSettings = await tx.payrollConfigurationEvent.findFirst({
        where: { kind: "STAFF", targetId: id },
      });
      const assignments = await tx.payrollConfigurationEvent.findFirst({
        where: { kind: "ASSIGNMENT", targetId: "company" },
        orderBy: { revision: "desc" },
      });
      const hasPayrollHistory =
        payrollSettings ||
        payrollAssignmentSchema
          .array()
          .parse(assignments?.payload ?? [])
          .some((row) => row.staffId === id);
      if (hasPayrollHistory && startDate !== expectedStartDate)
        throw badRequest("Change this staff join date through payroll settings with a reason.");
    }
    if (commissionRate !== undefined && !existing.commissionRate.equals(commissionRate))
      throw badRequest(
        "Publish commission changes through the commission rules settings so effective dates and history are retained.",
      );

    await assertStaffPayrollLifecycle(
      tx,
      id,
      startDate !== undefined ? (toDateValue(startDate) ?? null) : existing.startDate,
      disabled ?? existing.disabled,
    );

    await tx.user.update({
      where: { id },
      data: {
        ...fields,
        ...(posPin !== undefined
          ? {
              posPinHash: pinHash,
              posPinVersion: { increment: 1 },
            }
          : {}),
        ...(disabled !== undefined ? { disabled, disabledAt: disabled ? new Date() : null } : {}),
        // Absent means "leave it alone" and must stay absent; `null` clears the date.
        ...(startDate !== undefined ? { startDate: toDateValue(startDate) ?? null } : {}),
        ...(endDate !== undefined ? { endDate: toDateValue(endDate) ?? null } : {}),
      },
    });

    await linkDepartments(id, departmentIds, tx);
  });

  return getStaff(id);
}

/**
 * Sets another person's password — the recovery path for a forgotten login.
 *
 * Ordinary password changes stay in `auth.service.changePassword`, where the caller
 * proves they know the current one. This is the other half of credential handling:
 * a colleague who cannot sign in, and a salon that has to be able to hand them a
 * working login again. Nothing here is a shortcut around [ADR 0007] — the password
 * and the session ends are one transaction, exactly like a self-service change.
 *
 * Three rules beyond the role gate on the route:
 *
 * - **An account without an email has no password to reset.** Creation requires one
 *   now, so this only reaches rows written before that rule. `auth.service` refuses
 *   a web session without an address, so resetting one would be a silent no-op
 *   dressed up as a success. `conflict` says so.
 * - **A manager cannot reset a manager or an owner.** A `MANAGER` holds `PATCH`
 *   rights, but a credential write is a takeover primitive: resetting a peer would
 *   let one manager sign in as another, and resetting an owner would be
 *   privilege escalation by password. Managers recover `STAFF` and `CASHIER`
 *   accounts; only an owner recovers a management one.
 * - **An owner target gets `adminPasswordSchema`**, the same stricter policy
 *   `changePassword` applies to owners, evaluated against the row's role rather
 *   than the body's claim.
 *
 * The audit row goes in the same transaction as the write, so a reset can never be
 * recorded without happening or happen without being recorded. It carries the
 * target's role and nothing else: no password, no hash, no token.
 */
export async function resetStaffPassword(
  id: string,
  input: ResetStaffPasswordInput,
  actorRole: GlobalRole,
): Promise<void> {
  const scope = requireScope("User");
  const target = await prisma.user.findFirst({
    where: { id },
    select: { id: true, email: true, globalRole: true },
  });
  if (!target) throw notFound("That staff member does not exist.", "STAFF_NOT_FOUND");

  if (!target.email)
    throw conflict(
      "That staff member has no email login, so there is no password to reset.",
      "NO_WEB_LOGIN",
    );

  if (actorRole === "MANAGER" && !["STAFF", "CASHIER"].includes(target.globalRole))
    throw forbidden(
      "Only an owner can reset a manager's or an owner's password.",
      "ROLE_NOT_PERMITTED",
    );

  if (target.globalRole === "SUPER_ADMIN") {
    const parsed = adminPasswordSchema.safeParse(input.password);
    if (!parsed.success)
      throw validationFailed([{ path: "password", message: parsed.error.issues[0].message }]);
  }

  // Hash before the transaction: bcrypt is slow on purpose and holding a connection
  // for it is how a pool gets exhausted. Same ordering as `createStaff`.
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: { id, ...(scope.kind === "tenant" ? { tenantId: scope.tenantId } : {}) },
      data: {
        passwordHash,
        // Every access token already issued stops verifying; every refresh row below
        // stops renewing it. Without both, "reset" would mean "the new password works
        // and the old session still does too".
        tokenVersion: { increment: 1 },
        twoFactorCode: null,
        twoFactorCodeExpiresAt: null,
      },
    });
    if (changed.count !== 1) throw notFound("That staff member does not exist.", "STAFF_NOT_FOUND");

    await tx.refreshToken.updateMany({
      where: {
        userId: id,
        revokedAt: null,
        // Defence in depth: `RefreshToken` is not tenant-scoped, so the tenant filter
        // is stated rather than inherited. `forceSignOut` does the same.
        ...(scope.kind === "tenant" ? { user: { tenantId: scope.tenantId } } : {}),
      },
      data: { revokedAt: now },
    });

    if (scope.kind === "tenant")
      await tx.auditLog.create({
        data: {
          tenantId: scope.tenantId,
          action: "STAFF_PASSWORD_RESET",
          targetType: "User",
          targetId: id,
          metadata: { globalRole: target.globalRole },
        },
      });
  });
}
