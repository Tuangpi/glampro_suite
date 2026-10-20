/**
 * Appointments — handoff screens 03 and 06, `/api/appointments`.
 *
 * Like every service here, each function runs inside the tenant scope
 * `middleware/auth.ts` opened, so none of them takes a tenant id and a handler
 * naming another salon's booking simply finds nothing (AGENTS.md rule 1).
 * Rows are serialised **through** the shared Zod schemas, so a column added to
 * `Appointment` and forgotten here throws instead of reaching the browser
 * outside its contract (AGENTS.md rule 6).
 *
 * Two rules this service owns rather than delegating to the browser:
 *
 * 1. **Duration comes from the service.** `endsAt` and `durationMinutes` are
 *    computed here from `Service.durationMinutes`, never taken from the
 *    request (`docs/mvp.md` → M2). A booking's length is a fact about the
 *    service, and a form that could post its own end time would put a
 *    two-hour block on a one-hour service.
 * 2. **A performer must belong to the service's department.** The form offers
 *    only staff whose `User.departments` contain the service's branch, and the
 *    API refuses the ones it would not have offered rather than trusting the
 *    list it sent (ADR 0013 — the booking twin of M1's till decision).
 * 3. **One person cannot be in two places at once.** A booking whose window
 *    overlaps an active booking for the same performer is refused with `409`
 *    (ADR 0014). The calendar grid is the surface that makes the gap visible,
 *    so the rule lives here rather than in the browser that drew it.
 */
import type { PaginatedResponse } from "@glampro_suite/shared";
import {
  appointmentDetailSchema,
  appointmentSummarySchema,
  APPOINTMENT_STATUSES,
  type AppointmentDetail,
  type AppointmentListQuery,
  type AppointmentSummary,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
} from "@glampro_suite/shared";

import { badRequest, conflict, notFound } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { paginated, parsePagination } from "../utils/pagination.js";

/**
 * A booking with everything the day view draws. The three relations come along
 * denormalised so the list renders without three joins, and `service` carries
 * its own columns because that is where duration and eligibility come from.
 */
const APPOINTMENT_SELECT = {
  id: true,
  customerId: true,
  staffId: true,
  serviceId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  durationMinutes: true,
  comment: true,
  createdAt: true,
  updatedAt: true,
  finishedAt: true,
  customer: { select: { id: true, name: true } },
  staff: { select: { id: true, name: true } },
  service: {
    select: { id: true, name: true, departmentId: true, durationMinutes: true },
  },
} as const;

function findRow(id: string) {
  return prisma.appointment.findFirst({ where: { id }, select: APPOINTMENT_SELECT });
}

type AppointmentRow = NonNullable<Awaited<ReturnType<typeof findRow>>>;

function toSummary(row: AppointmentRow): AppointmentSummary {
  return appointmentSummarySchema.parse({
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    durationMinutes: row.durationMinutes,
    comment: row.comment,
    customerId: row.customer?.id ?? null,
    customerName: row.customer?.name ?? null,
    staffId: row.staff?.id ?? null,
    staffName: row.staff?.name ?? null,
    serviceId: row.service?.id ?? null,
    serviceName: row.service?.name ?? null,
    serviceDepartmentId: row.service?.departmentId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toDetail(row: AppointmentRow): AppointmentDetail {
  return appointmentDetailSchema.parse({
    ...toSummary(row),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}

/**
 * The slot length a booking takes: the service's own minutes, or an hour when
 * the salon has not set one. The fallback exists because `Service.durationMinutes`
 * is nullable in the schema; an appointment still has to end somewhere, and an
 * invented 60 minutes is at least visible as the default rather than a
 * zero-length block the clash detection of full-phase booking would walk
 * straight through.
 */
const FALLBACK_DURATION_MINUTES = 60;

interface ResolvedService {
  id: string;
  departmentId: string | null;
  durationMinutes: number;
}

/** Loads the service a booking hangs on, or 404s. */
async function resolveService(serviceId: string): Promise<ResolvedService> {
  const service = await prisma.service.findFirst({
    where: { id: serviceId },
    select: { id: true, departmentId: true, durationMinutes: true },
  });
  if (!service) throw notFound("That service does not exist.", "SERVICE_NOT_FOUND");

  return {
    id: service.id,
    departmentId: service.departmentId,
    durationMinutes: service.durationMinutes ?? FALLBACK_DURATION_MINUTES,
  };
}

/**
 * Refuses a performer who would not have been offered.
 *
 * A `staffId` must name a user of this salon, and when the service has a
 * department the user must belong to it. A service with no department accepts
 * anyone — the salon has not said who may perform it — and an absent `staffId`
 * is a booking nobody has claimed yet, which stays bookable.
 */
async function assertPerformerEligible(staffId: string, service: ResolvedService): Promise<void> {
  const staff = await prisma.user.findFirst({
    where: { id: staffId },
    select: { id: true, departments: { select: { departmentId: true } } },
  });
  if (!staff) throw notFound("That staff member does not exist.", "STAFF_NOT_FOUND");

  if (service.departmentId === null) return;

  const inDepartment = staff.departments.some((link) => link.departmentId === service.departmentId);
  if (!inDepartment) {
    throw badRequest(
      "That staff member is not in the service's department.",
      undefined,
      "STAFF_NOT_IN_DEPARTMENT",
    );
  }
}

/** Same existence check for the customer, whose FK would otherwise 500. */
async function assertCustomerExists(customerId: string): Promise<void> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
}

/**
 * The statuses that hold a slot (ADR 0014 §3).
 *
 * The complement of `{ CANCELLED }` rather than a second list to keep in sync,
 * so a status added to `APPOINTMENT_STATUSES` occupies the slot by default and
 * has to be deliberately excluded. A cancelled booking freed its slot the
 * moment it was cancelled; a no-show did not — the time was still held and
 * cannot be given to somebody else after the fact.
 */
const OCCUPYING_APPOINTMENT_STATUSES = APPOINTMENT_STATUSES.filter(
  (status) => status !== "CANCELLED",
);

/**
 * Refuses a booking that overlaps an active one for the same performer (ADR 0014).
 *
 * Three things make this a rule rather than a filter: it is **half-open** (a
 * block ending at 10:00 and one starting at 10:00 are back-to-back, which is
 * the normal day), it **excludes the row's own id** so rescheduling a booking
 * into the window it already occupies is a no-op, and it is **skipped for an
 * unassigned booking**, because nobody named is nobody double-booked.
 *
 * It runs *before* the write and is not one atomic statement with it, so two
 * concurrent requests can both pass and both write. That residual is inherent
 * to an application-level check — the eventual fix is a Postgres `EXCLUDE`
 * constraint over a `tstzrange`, which needs `btree_gist` and a migration over
 * every tenant's `appointments` (see the ADR). It is documented rather than
 * hidden so nobody mistakes the check for a guarantee.
 */
async function assertNoClash(
  staffId: string | null,
  startsAt: Date,
  endsAt: Date,
  excludeId?: string,
): Promise<void> {
  if (!staffId) return;

  const clash = await prisma.appointment.findFirst({
    where: {
      staffId,
      status: { in: [...OCCUPYING_APPOINTMENT_STATUSES] },
      // Half-open overlap: touching edges are neighbours, not a clash.
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: {
      startsAt: true,
      endsAt: true,
      customer: { select: { name: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  if (!clash) return;

  const who = clash.customer?.name ?? "another appointment";
  const window = `${clash.startsAt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}–${clash.endsAt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;

  throw conflict(
    `That time is already taken: ${who} is booked ${window}. Pick another time or another stylist.`,
    "APPOINTMENT_CLASH",
  );
}

/**
 * One page of bookings in a window, soonest first.
 *
 * The window is optional and expressed as instants (see the contract): a day
 * view sends its own edges, and omitting both is the whole book. `startsAt` is
 * what is filtered because that is what the list is a view *of* — a booking
 * started yesterday and finishing today is yesterday's row.
 */
export async function listAppointments(
  query: AppointmentListQuery,
): Promise<PaginatedResponse<AppointmentSummary>> {
  const { page, pageSize, skip, take } = parsePagination(query);

  const where = {
    ...(query.from || query.to
      ? {
          ...(query.overlap === "true"
            ? {
                ...(query.from ? { endsAt: { gt: new Date(query.from) } } : {}),
                ...(query.to ? { startsAt: { lte: new Date(query.to) } } : {}),
              }
            : {
                startsAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }),
        }
      : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { customer: { name: { contains: query.search, mode: "insensitive" as const } } },
            { staff: { name: { contains: query.search, mode: "insensitive" as const } } },
            { service: { name: { contains: query.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      select: APPOINTMENT_SELECT,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      skip,
      take,
    }),
    prisma.appointment.count({ where }),
  ]);

  return paginated(rows.map(toSummary), total, { page, pageSize });
}

export async function getAppointment(id: string): Promise<AppointmentDetail> {
  const row = await findRow(id);
  if (!row) throw notFound("That appointment does not exist.", "APPOINTMENT_NOT_FOUND");
  return toDetail(row);
}
/**
 * Books. `endsAt` and `durationMinutes` are computed, the eligible performer is
 * checked, and `finishedAt` is stamped when the booking is created already
 * completed (a re-seed replaying history, or a desk that forgot to mark it).
 */
export async function createAppointment(input: CreateAppointmentInput): Promise<AppointmentDetail> {
  const service = await resolveService(input.serviceId);
  if (input.staffId) await assertPerformerEligible(input.staffId, service);
  if (input.customerId) await assertCustomerExists(input.customerId);

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
  const status = input.status ?? "SCHEDULED";

  await assertNoClash(input.staffId ?? null, startsAt, endsAt);

  const created = await prisma.appointment.create({
    data: {
      // Placeholder: `scopeCreateData` overwrites it with the scope's tenant.
      tenantId: "",
      customerId: input.customerId ?? null,
      staffId: input.staffId ?? null,
      serviceId: service.id,
      startsAt,
      endsAt,
      status,
      durationMinutes: service.durationMinutes,
      comment: input.comment ?? null,
      ...(status === "COMPLETED" ? { finishedAt: new Date() } : {}),
    },
    select: { id: true },
  });

  return getAppointment(created.id);
}

/**
 * Applies a partial update.
 *
 * Every field is optional and absent means unchanged; `null` clears (the same
 * PATCH rule the customer and staff editors keep). The two derived columns are
 * re-derived from the **merged** state: a new service resizes the slot, a new
 * start moves it, and either way `endsAt = startsAt + duration` is recomputed
 * so the two can never drift apart through a half-applied edit.
 */
export async function updateAppointment(
  id: string,
  input: UpdateAppointmentInput,
): Promise<AppointmentDetail> {
  const existing = await findRow(id);
  if (!existing) throw notFound("That appointment does not exist.", "APPOINTMENT_NOT_FOUND");

  const service = await resolveService(input.serviceId ?? existing.serviceId ?? "");
  const staffId = input.staffId === undefined ? existing.staffId : input.staffId;
  const customerId = input.customerId === undefined ? existing.customerId : input.customerId;

  if (staffId) await assertPerformerEligible(staffId, service);
  if (customerId) await assertCustomerExists(customerId);

  const startsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt;
  // Preserve the booking snapshot unless the service itself changes.
  const durationMinutes =
    input.serviceId !== undefined && input.serviceId !== existing.serviceId
      ? service.durationMinutes
      : (existing.durationMinutes ??
        Math.round((existing.endsAt.getTime() - existing.startsAt.getTime()) / 60_000));
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  // A move is what can clash, so the check re-runs when either half of the
  // slot changed — a new time under the same stylist, or the same time onto a
  // new one. Both are judged on the **merged** performer, and the row's own id
  // is excluded so a patch that changes nothing else is not a conflict.
  if (
    (input.status ?? existing.status) !== "CANCELLED" &&
    (input.startsAt !== undefined ||
      input.staffId !== undefined ||
      input.serviceId !== undefined ||
      input.status !== undefined)
  ) {
    await assertNoClash(staffId ?? null, startsAt, endsAt, id);
  }

  const status = input.status ?? existing.status;
  // Leaving COMPLETED clears the stamp: a booking that is no longer done must
  // not keep the time it was done at, or the day's history reads as two truths.
  const finishedAt = status === "COMPLETED" ? (existing.finishedAt ?? new Date()) : null;

  await prisma.appointment.update({
    where: { id },
    data: {
      customerId: customerId ?? null,
      staffId: staffId ?? null,
      serviceId: service.id,
      startsAt,
      endsAt,
      status,
      durationMinutes,
      finishedAt,
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    },
  });

  return getAppointment(id);
}
