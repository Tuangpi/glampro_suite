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
 * 4. **Only a live service can be chosen.** A booking may be created on an
 *    `ACTIVE` service, and a patch may move a booking *onto* one. A booking
 *    already on a service that was later deactivated stays editable — retiring
 *    a service must not freeze the history hanging on it.
 * 5. **A booking is a chain of service lines.** One `AppointmentLine` per
 *    service, in the order performed, each with its own performer and window:
 *    line 0 starts at `startsAt` and every next line starts where the previous
 *    ended (TK2610-0020 phase B). `Appointment.serviceId`/`staffId` mirror line
 *    0 so readers that only know the single-service shape stay correct, while
 *    the overlap and roster rules judge every line — a stylist booked on line 2
 *    is busy for line 2's window, not for the whole booking.
 * 6. **A booking can repeat.** `repeat` writes the same chain every N weeks, as
 *    a series row plus one ordinary booking per occurrence, stepped in the
 *    salon's wall clock so a weekly 10:00 stays 10:00 across a DST change. The
 *    anchor must be bookable; a later occurrence that clashes is skipped and
 *    reported rather than failing the request (TK2610-0020 phase C).
 * 7. **A line also occupies a room or a machine.** A service may be linked to the
 *    resources it *may* use (phase D), and the server gives each line one of them
 *    that is free for that line's window — one room cannot hold two bookings, the
 *    same half-open overlap rule ADR 0014 applies to people. The browser never
 *    sends a resource id, so a desk cannot pin two bookings into one room, and a
 *    service with no linked resources books exactly as it did before.
 */
import type { PaginatedResponse } from "@glampro_suite/shared";
import {
  appointmentDetailSchema,
  appointmentSeriesReportSchema,
  appointmentSummarySchema,
  APPOINTMENT_STATUSES,
  type AppointmentDetail,
  type AppointmentListQuery,
  type AppointmentSeriesReport,
  type AppointmentSummary,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
} from "@glampro_suite/shared";

import { badRequest, conflict, HttpError, notFound } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { salonTimeZone } from "../lib/salon-clock.js";
import { addWeeksInZone } from "../lib/wall-clock.js";
import { paginated, parsePagination } from "../utils/pagination.js";
import { assertStaffAvailable } from "./staff-availability.service.js";
import { lockBookingCalendar, queueAppointmentMessages, tenantId, type Tx } from "./messaging.service.js";
export { lockBookingCalendar } from "./messaging.service.js";

/**
 * A booking with everything the day view draws. The three relations come along
 * denormalised so the list renders without three joins, `service` carries its
 * own columns because that is where duration and eligibility come from, and
 * `lines` is the chain of services the booking actually consists of.
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
  customerConfirmedAt: true,
  customer: { select: { id: true, name: true } },
  staff: { select: { id: true, name: true } },
  service: {
    select: { id: true, name: true, departmentId: true, durationMinutes: true },
  },
  lines: {
    orderBy: { position: "asc" },
    select: {
      serviceId: true,
      staffId: true,
      resourceId: true,
      startsAt: true,
      endsAt: true,
      durationMinutes: true,
      service: { select: { id: true, name: true, departmentId: true } },
      staff: { select: { id: true, name: true } },
      resource: { select: { id: true, name: true } },
    },
  },
  /// The repeating rule, when this row is one occurrence of a series. Two columns
  /// rather than a third read: the editor shows "3 of 6" from the row itself.
  seriesIndex: true,
  series: { select: { id: true, intervalWeeks: true, occurrences: true } },
} as const;

function findRow(id: string) {
  return prisma.appointment.findFirst({ where: { id }, select: APPOINTMENT_SELECT });
}

type AppointmentRow = NonNullable<Awaited<ReturnType<typeof findRow>>>;

function toSummary(row: AppointmentRow): AppointmentSummary {
  const services = row.lines.map((line) => ({
    serviceId: line.service.id,
    serviceName: line.service.name,
    serviceDepartmentId: line.service.departmentId,
    staffId: line.staff?.id ?? null,
    staffName: line.staff?.name ?? null,
    // The room or machine this line holds. Read from the relation, not the raw
    // column, so an archived room still shows the name it was booked under.
    resourceId: line.resource?.id ?? null,
    resourceName: line.resource?.name ?? null,
    startsAt: line.startsAt.toISOString(),
    endsAt: line.endsAt.toISOString(),
    durationMinutes: line.durationMinutes,
  }));

  // A row written before service lines existed has none, so its own columns are
  // still the answer — that is the one case the mirror is not already the truth.
  const primary = services[0];

  return appointmentSummarySchema.parse({
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    durationMinutes: row.durationMinutes,
    comment: row.comment,
    customerId: row.customer?.id ?? null,
    customerName: row.customer?.name ?? null,
    staffId: primary ? primary.staffId : (row.staff?.id ?? null),
    staffName: primary ? primary.staffName : (row.staff?.name ?? null),
    serviceId: primary ? primary.serviceId : (row.service?.id ?? null),
    serviceName: primary ? primary.serviceName : (row.service?.name ?? null),
    serviceDepartmentId: primary
      ? primary.serviceDepartmentId
      : (row.service?.departmentId ?? null),
    services,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toDetail(row: AppointmentRow): AppointmentDetail {
  return appointmentDetailSchema.parse({
    ...toSummary(row),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    customerConfirmedAt: row.customerConfirmedAt?.toISOString() ?? null,
    // A one-off has no rule to show; an occurrence reports the rule and its place
    // in it, so the editor never has to count siblings itself.
    series: row.series
      ? {
          id: row.series.id,
          intervalWeeks: row.series.intervalWeeks,
          occurrences: row.series.occurrences,
          index: row.seriesIndex ?? 0,
        }
      : null,
  });
}

/**
 * The slot length a booking takes: the service's own minutes, or an hour when
 * the salon has not set one. The fallback exists because
 * `Service.durationMinutes` is nullable in the schema; an appointment still has
 * to end somewhere, and an invented 60 minutes is at least visible as the
 * default rather than a zero-length block the clash detection of full-phase
 * booking would walk straight through. A non-positive duration (a row written
 * straight to the table) takes the same fallback, because a zero-length line
 * would now fail the `appointment_lines` check constraint rather than book.
 */
const FALLBACK_DURATION_MINUTES = 60;

interface ResolvedService {
  id: string;
  departmentId: string | null;
  durationMinutes: number;
}

/**
 * Loads the service a booking hangs on, or 404s.
 *
 * `requireActive` is set by the requests that *choose* a service — a creation,
 * or a patch that changes which service is booked. A patch keeping the service
 * it already has stays allowed even if that service was since deactivated, so
 * deactivating a service cannot freeze every booking on it.
 */
async function resolveService(
  tx: Tx,
  serviceId: string,
  options: { requireActive?: boolean } = {},
): Promise<ResolvedService> {
  const service = await tx.service.findFirst({
    where: { id: serviceId },
    select: { id: true, departmentId: true, durationMinutes: true, status: true },
  });
  if (!service) throw notFound("That service does not exist.", "SERVICE_NOT_FOUND");
  if (options.requireActive && service.status !== "ACTIVE") {
    throw badRequest(
      "That service is not active. Pick another service.",
      [{ path: "serviceId", message: "That service is not active." }],
      "SERVICE_INACTIVE",
    );
  }

  return {
    id: service.id,
    departmentId: service.departmentId,
    durationMinutes:
      service.durationMinutes !== null && service.durationMinutes > 0
        ? service.durationMinutes
        : FALLBACK_DURATION_MINUTES,
  };
}

/** One service chosen for a booking, before the chain's times are worked out. */
interface LineSelection {
  serviceId: string;
  /**
   * `undefined` = use the booking's performer; `null` = explicitly nobody on
   * this line. The difference matters on PATCH, where the booking's performer
   * may have just been cleared.
   */
  staffId?: string | null;
  /** A line the booking already has keeps the duration it was booked with. */
  durationMinutes?: number;
}

/** A service placed on the clock: what will be written as an `AppointmentLine`. */
interface PlannedLine {
  serviceId: string;
  staffId: string | null;
  /**
   * The room or equipment this line will hold. `null` while the chain is being
   * planned — the resource is picked per occurrence, because the same weekly slot
   * may be free in Room 1 this week and only in Room 2 the next.
   */
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
}

/**
 * Turns an ordered list of services into the chain they will occupy.
 *
 * Line 0 starts at the booking's start and every next line begins where the
 * previous ended, so the booking's length is the sum of its services and no
 * client-supplied end time is involved. Each line's performer is checked against
 * **that line's** service (ADR 0013), which is what lets a cut by one stylist and
 * a manicure by another be one booking.
 */
async function planLines(
  tx: Tx,
  startsAt: Date,
  selections: LineSelection[],
  defaultStaffId: string | null,
  options: { requireActiveFor: (serviceId: string) => boolean },
): Promise<PlannedLine[]> {
  const planned: PlannedLine[] = [];
  let cursor = startsAt;

  for (const selection of selections) {
    const service = await resolveService(tx, selection.serviceId, {
      requireActive: options.requireActiveFor(selection.serviceId),
    });
    const staffId = selection.staffId === undefined ? defaultStaffId : selection.staffId;
    if (staffId) await assertPerformerEligible(tx, staffId, service);

    const durationMinutes = selection.durationMinutes ?? service.durationMinutes;
    const endsAt = new Date(cursor.getTime() + durationMinutes * 60_000);
    planned.push({
      serviceId: service.id,
      staffId,
      // Picked later by `assignResources`, once the window is known.
      resourceId: null,
      startsAt: cursor,
      endsAt,
      durationMinutes,
    });
    cursor = endsAt;
  }

  return planned;
}

/** The booking's length: the sum of its lines. */
function totalMinutes(lines: PlannedLine[]): number {
  return lines.reduce((total, line) => total + line.durationMinutes, 0);
}

/** Two chains are the same booking when every line matches on service, person and window. */
function sameLines(current: AppointmentRow["lines"], planned: PlannedLine[]): boolean {
  if (current.length !== planned.length) return false;
  return planned.every((line, index) => {
    const existing = current[index];
    return (
      existing !== undefined &&
      existing.serviceId === line.serviceId &&
      existing.staffId === line.staffId &&
      existing.startsAt.getTime() === line.startsAt.getTime() &&
      existing.endsAt.getTime() === line.endsAt.getTime() &&
      existing.durationMinutes === line.durationMinutes
    );
  });
}

/**
 * Refuses a performer who would not have been offered.
 *
 * A `staffId` must name a user of this salon, and when the service has a
 * department the user must belong to it. A service with no department accepts
 * anyone — the salon has not said who may perform it — and an absent `staffId`
 * is a booking nobody has claimed yet, which stays bookable.
 */
async function assertPerformerEligible(
  tx: Tx,
  staffId: string,
  service: ResolvedService,
): Promise<void> {
  const staff = await tx.user.findFirst({
    where: { id: staffId },
    select: { id: true, disabled: true, departments: { select: { departmentId: true } } },
  });
  if (!staff) throw notFound("That staff member does not exist.", "STAFF_NOT_FOUND");
  if (staff.disabled)
    throw badRequest(
      "That staff member is disabled.",
      [{ path: "staffId", message: "That staff member is disabled." }],
      "STAFF_DISABLED",
    );

  if (service.departmentId === null) return;

  const inDepartment = staff.departments.some((link) => link.departmentId === service.departmentId);
  if (!inDepartment) {
    throw badRequest(
      "That staff member is not in the service's department.",
      [
        {
          path: "staffId",
          message: "That staff member is not in the service's department.",
        },
      ],
      "STAFF_NOT_IN_DEPARTMENT",
    );
  }
}

/** Same existence check for the customer, whose FK would otherwise 500. */
async function assertCustomerExists(tx: Tx, customerId: string): Promise<void> {
  const customer = await tx.customer.findFirst({
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
 * The roster check, once per line.
 *
 * A stylist only occupies the line they perform, so a break at 11:00 blocks the
 * line that falls in it and leaves the rest of somebody else's chain alone.
 */
async function assertStaffFree(tx: Tx, lines: PlannedLine[]): Promise<void> {
  for (const line of lines) {
    if (!line.staffId) continue;
    await assertStaffAvailable(line.staffId, line.startsAt, line.endsAt, tx);
  }
}

/**
 * Refuses a booking that overlaps an active one for the same performer (ADR 0014).
 *
 * Judged **per line**: a stylist is busy for the window they actually perform,
 * so the second service of a chain may go to somebody else without a false
 * conflict. Three things make this a rule rather than a filter: it is
 * **half-open** (a line ending at 10:00 and one starting at 10:00 are
 * back-to-back, which is the normal day), it **excludes the booking's own id**
 * so rescheduling into the window it already occupies is a no-op, and it is
 * **skipped for an unassigned line**, because nobody named is nobody
 * double-booked.
 *
 * Reads through the write transaction after acquiring the salon booking lock.
 * Other API booking writes for this salon wait until commit, then check the
 * committed slots. Direct SQL writers must follow the same protocol; this is
 * not a PostgreSQL exclusion constraint (ADR 0014).
 */
async function assertNoClash(tx: Tx, lines: PlannedLine[], excludeId?: string): Promise<void> {
  const slots = lines.filter(
    (line): line is PlannedLine & { staffId: string } => line.staffId !== null,
  );
  if (slots.length === 0) return;

  const overlap = slots.map((slot) => ({
    staffId: slot.staffId,
    // Half-open overlap: touching edges are neighbours, not a clash.
    startsAt: { lt: slot.endsAt },
    endsAt: { gt: slot.startsAt },
  }));
  const appointmentFilter = {
    status: { in: [...OCCUPYING_APPOINTMENT_STATUSES] },
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };

  const bookedLine = await tx.appointmentLine.findFirst({
    where: { OR: overlap, appointment: appointmentFilter },
    select: {
      startsAt: true,
      endsAt: true,
      appointment: { select: { customer: { select: { name: true } } } },
    },
    orderBy: { startsAt: "asc" },
  });
  // A booking with no lines predates service lines (or was written straight to
  // the table): its own window still holds the slot, so it is judged as it
  // always was.
  const legacyRow = await tx.appointment.findFirst({
    where: {
      OR: overlap.map((slot) => ({ ...slot, lines: { none: {} } })),
      ...appointmentFilter,
    },
    select: { startsAt: true, endsAt: true, customer: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
  });

  const clashes: ({ startsAt: Date; endsAt: Date; customer: { name: string } | null } | null)[] = [
    bookedLine && {
      startsAt: bookedLine.startsAt,
      endsAt: bookedLine.endsAt,
      customer: bookedLine.appointment.customer,
    },
    legacyRow,
  ];
  const blocking = clashes
    .filter((row): row is NonNullable<(typeof clashes)[number]> => row !== null)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (blocking.length === 0) return;

  const clash = blocking[0]!;

  // The clash is a fact about the salon's day, so it is quoted in the salon's
  // zone. Formatting in the server's zone reads as an hour nobody booked.
  const zone = await salonTimeZone(tx);
  const timeInSalon = (instant: Date) =>
    instant.toLocaleTimeString("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    });

  const who = clash.customer?.name ?? "another appointment";
  const window = `${timeInSalon(clash.startsAt)}–${timeInSalon(clash.endsAt)}`;

  throw conflict(
    `That time is already taken: ${who} is booked ${window}. Pick another time or another stylist.`,
    "APPOINTMENT_CLASH",
  );
}

/**
 * Gives every line the room or equipment it holds (TK2610-0020 phase D).
 *
 * A service's linked resources are an **eligibility set**, not a list of
 * simultaneous needs: the line takes the first one that is free for its window,
 * in name order, exactly as a performer is one person from the service's
 * department. That is why "Wash chair 1, Wash chair 2" on a shampoo service means
 * "either chair", while a service that genuinely needs two rooms is two lines.
 *
 * Three details make it a rule rather than a preference:
 *
 * - it is **half-open**, like the performer check: a booking ending at 10:00 does
 *   not stop one starting at 10:00;
 * - it **excludes the booking being edited**, so rescheduling into the window it
 *   already holds does not report the room as busy with itself;
 * - it runs **per occurrence** for a repeating booking, because a resource that is
 *   free this Wednesday may be taken the next.
 *
 * When the service's resources are all busy — or all inactive, which is a
 * configuration mistake worth saying out loud — the answer is `409
 * RESOURCE_UNAVAILABLE`. Assignment reads through the locked write transaction,
 * so another API booking cannot take the selected resource before commit.
 */
async function assignResources(
  tx: Tx,
  lines: PlannedLine[],
  excludeAppointmentId?: string,
): Promise<PlannedLine[]> {
  const serviceIds = [...new Set(lines.map((line) => line.serviceId))];
  if (serviceIds.length === 0) return lines;

  const links = await tx.serviceResource.findMany({
    where: { serviceId: { in: serviceIds } },
    select: {
      serviceId: true,
      resource: { select: { id: true, name: true, kind: true, status: true } },
    },
    orderBy: [{ resource: { name: "asc" } }, { resourceId: "asc" }],
  });
  if (links.length === 0) return lines.map((line) => ({ ...line, resourceId: null }));

  const linked = new Map<string, { id: string; name: string; kind: string; active: boolean }[]>();
  for (const link of links) {
    const set = linked.get(link.serviceId) ?? [];
    set.push({
      id: link.resource.id,
      name: link.resource.name,
      kind: link.resource.kind,
      active: link.resource.status === "ACTIVE",
    });
    linked.set(link.serviceId, set);
  }

  const appointmentFilter = {
    status: { in: [...OCCUPYING_APPOINTMENT_STATUSES] },
    ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
  };

  const zone = await salonTimeZone(tx);
  const timeInSalon = (instant: Date) =>
    instant.toLocaleTimeString("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    });

  const assigned: PlannedLine[] = [];

  for (const line of lines) {
    const candidates = linked.get(line.serviceId) ?? [];
    // A service the salon has not tied to anything books as it always did.
    if (candidates.length === 0) {
      assigned.push({ ...line, resourceId: null });
      continue;
    }

    const active = candidates.filter((candidate) => candidate.active);
    if (active.length === 0) {
      throw conflict(
        "Every room or equipment this service uses is inactive. Reactivate one or add another before booking it.",
        "RESOURCE_UNAVAILABLE",
      );
    }

    const taken = await tx.appointmentLine.findMany({
      where: {
        resourceId: { in: active.map((candidate) => candidate.id) },
        startsAt: { lt: line.endsAt },
        endsAt: { gt: line.startsAt },
        appointment: appointmentFilter,
      },
      select: { resourceId: true },
    });
    const busy = new Set(taken.map((row) => row.resourceId));
    const free = active.find((candidate) => !busy.has(candidate.id));

    if (!free) {
      const window = `${timeInSalon(line.startsAt)}–${timeInSalon(line.endsAt)}`;
      // Said in the salon's own words: "every room" reads better than "every
      // resource", and the message is the only place the kind is visible.
      const kinds = new Set(active.map((candidate) => candidate.kind));
      const what =
        kinds.size === 1
          ? active[0]!.kind === "ROOM"
            ? "room"
            : "equipment"
          : "room or equipment";
      throw conflict(
        `That time is already taken: every ${what} this service can use is busy ${window}. Pick another time.`,
        "RESOURCE_UNAVAILABLE",
      );
    }

    assigned.push({ ...line, resourceId: free.id });
  }

  return assigned;
}

/**
 * Everything a booking has to win before it may be written: the performer's rota,
 * the performer's other bookings, and a room or machine for every line.
 *
 * One helper rather than three calls at each site, so the one-off, the anchor, a
 * later occurrence and a reschedule can never check two of the three. The staff
 * checks run first on purpose: "Mira is already with someone" is a fact about a
 * person the desk can name, which is a better first answer than "no room".
 */
async function reserve(
  tx: Tx,
  lines: PlannedLine[],
  excludeAppointmentId?: string,
): Promise<PlannedLine[]> {
  await assertStaffFree(tx, lines);
  await assertNoClash(tx, lines, excludeAppointmentId);
  return assignResources(tx, lines, excludeAppointmentId);
}

/** Public availability uses the same per-line staff and resource rules as writes. */
export async function isAppointmentSlotAvailable(
  tx: Tx,
  serviceId: string,
  staffId: string,
  startsAt: Date,
): Promise<boolean> {
  try {
    const lines = await planLines(tx, startsAt, [{ serviceId }], staffId, {
      requireActiveFor: () => true,
    });
    await reserve(tx, lines);
    return true;
  } catch (error) {
    if (isSkippableOccurrence(error)) return false;
    throw error;
  }
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
/** What a create wrote: the anchor booking, plus the series report for a repeat. */
export interface CreatedAppointment {
  /** The booking the desk asked for — occurrence 0 of a series. */
  appointment: AppointmentDetail;
  /** `null` for a one-off booking. */
  series: AppointmentSeriesReport | null;
}

/** Everything one occurrence needs, before it is multiplied into a series. */
interface BookingPlan {
  customerId: string | null;
  status: (typeof APPOINTMENT_STATUSES)[number];
  comment: string | null;
  lines: PlannedLine[];
}

/**
 * Writes one booking and its chain inside `tx`.
 *
 * Shared by the one-off and the repeating path so the two can never drift: the
 * flat columns mirror line 0, `endsAt` is the last line's end, and the same
 * message queueing follows every write. The blank `tenantId` is the established
 * convention here — the scope extension stamps the caller's salon (rule 1).
 */
async function writeBooking(
  tx: Tx,
  plan: BookingPlan & { series?: { id: string; index: number } },
): Promise<string> {
  const primary = plan.lines[0]!;
  const created = await tx.appointment.create({
    data: {
      tenantId: "",
      customerId: plan.customerId,
      staffId: primary.staffId,
      serviceId: primary.serviceId,
      startsAt: primary.startsAt,
      endsAt: plan.lines[plan.lines.length - 1]!.endsAt,
      status: plan.status,
      durationMinutes: totalMinutes(plan.lines),
      comment: plan.comment,
      ...(plan.series ? { seriesId: plan.series.id, seriesIndex: plan.series.index } : {}),
      ...(plan.status === "COMPLETED" ? { finishedAt: new Date() } : {}),
    },
    select: { id: true },
  });

  await tx.appointmentLine.createMany({
    data: plan.lines.map((line, position) => ({
      tenantId: "",
      appointmentId: created.id,
      serviceId: line.serviceId,
      staffId: line.staffId,
      resourceId: line.resourceId,
      position,
      startsAt: line.startsAt,
      endsAt: line.endsAt,
      durationMinutes: line.durationMinutes,
    })),
  });

  await queueAppointmentMessages(tx, created.id);
  return created.id;
}

/** The same chain, moved by `deltaMs` — an occurrence two weeks after the last. */
function shiftLines(lines: PlannedLine[], deltaMs: number): PlannedLine[] {
  return lines.map((line) => ({
    ...line,
    startsAt: new Date(line.startsAt.getTime() + deltaMs),
    endsAt: new Date(line.endsAt.getTime() + deltaMs),
  }));
}

/**
 * The refusals a *later* occurrence may earn without failing the request: the
 * performer is busy (`APPOINTMENT_CLASH`), is not on the rota then
 * (`STAFF_UNAVAILABLE`), or every room/equipment the service can use is taken
 * (`RESOURCE_UNAVAILABLE`). All three are facts about that date alone, which is
 * exactly why the series skips it and carries on. Anything else is re-thrown.
 */
function isSkippableOccurrence(error: unknown): error is HttpError {
  return (
    error instanceof HttpError &&
    error.statusCode === 409 &&
    (error.code === "APPOINTMENT_CLASH" ||
      error.code === "STAFF_UNAVAILABLE" ||
      error.code === "RESOURCE_UNAVAILABLE")
  );
}

/**
 * Books. Every end time and duration is computed from the services, each line's
 * performer is checked against that line's service, and `finishedAt` is stamped
 * when the booking is created already completed (a re-seed replaying history, or
 * a desk that forgot to mark it).
 *
 * Only an active service may be booked, and a row created already cancelled is
 * neither availability- nor clash-checked: it holds no slot (ADR 0014 §3), and
 * PATCH treats it the same way, so the two paths agree.
 *
 * `serviceId` and `services` are two spellings of the same thing — one service,
 * or an ordered chain — and the contract refuses a request that sends both.
 *
 * `repeat` turns the booking into a series (phase C): the same chain every
 * `intervalWeeks` for `occurrences` bookings. The **anchor must be bookable** —
 * a desk that picked a busy time is told so — while a later occurrence that
 * clashes or falls outside the performer's rota is skipped and reported, so ten
 * booked Wednesdays are not lost to the eleventh. The whole set is written in one
 * transaction: either the series and its report are consistent, or nothing was
 * written.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<CreatedAppointment> {
  const created = await prisma.$transaction(
    async (tx) => {
      await lockBookingCalendar(tx);
      return createAppointmentInTransaction(tx, input);
    },
    { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 },
  );
  return { appointment: await getAppointment(created.id), series: created.series };
}

export async function createAppointmentInTransaction(
  tx: Tx,
  input: CreateAppointmentInput,
): Promise<{ id: string; series: AppointmentSeriesReport | null }> {
  const selections: LineSelection[] = input.services
    ? input.services.map((line) => ({ serviceId: line.serviceId, staffId: line.staffId }))
    : input.serviceId
      ? [{ serviceId: input.serviceId }]
      : [];
  if (selections.length === 0) {
    throw badRequest(
      "A booking needs at least one service.",
      [{ path: "services", message: "Pick at least one service." }],
      "APPOINTMENT_NO_SERVICE",
    );
  }

  const startsAt = new Date(input.startsAt);
  const status = input.status ?? "SCHEDULED";
  const lines = await planLines(tx, startsAt, selections, input.staffId ?? null, {
    requireActiveFor: () => true,
  });
  if (input.customerId) await assertCustomerExists(tx, input.customerId);

  const plan: BookingPlan = {
    customerId: input.customerId ?? null,
    status,
    comment: input.comment ?? null,
    lines,
  };

  // A row created already cancelled holds no slot, so neither it nor its repeats
  // are availability- or clash-checked (ADR 0014 §3, as PATCH treats it).
  const holds = status !== "CANCELLED";

  if (!input.repeat) {
    const booked = holds ? await reserve(tx, lines) : lines;
    const id = await writeBooking(tx, { ...plan, lines: booked });
    return { id, series: null };
  }

  // The anchor is the booking the desk asked for, so a busy time — or a service
  // whose rooms are all taken — is refused as it always was rather than quietly
  // producing a series with nothing in it.
  const anchorLines = holds ? await reserve(tx, lines) : lines;

  const { intervalWeeks, occurrences } = input.repeat;
  const zone = await salonTimeZone(tx);
  const skipped: AppointmentSeriesReport["skipped"] = [];
  const planned: { index: number; lines: PlannedLine[] }[] = [{ index: 0, lines: anchorLines }];

  for (let index = 1; index < occurrences; index += 1) {
    // "The same booking every N weeks" is a statement about the salon's wall
    // clock, so the step is taken in the salon's zone, not by adding fixed hours.
    const occurrenceStart = addWeeksInZone(startsAt, index * intervalWeeks, zone);
    // Shifted from the *unassigned* chain: the room is picked again below, because
    // the same slot may be free in Room 1 this week and only in Room 2 the next.
    const occurrenceLines = shiftLines(lines, occurrenceStart.getTime() - startsAt.getTime());

    if (!holds) {
      planned.push({ index, lines: occurrenceLines });
      continue;
    }

    try {
      planned.push({ index, lines: await reserve(tx, occurrenceLines) });
    } catch (error) {
      // One busy fortnight is not a reason to throw away the other bookings. Any
      // other refusal — an ineligible performer, a dead service — is a real error
      // and is re-thrown, because it would have failed the anchor too.
      if (!isSkippableOccurrence(error)) throw error;
      skipped.push({ startsAt: occurrenceStart.toISOString(), reason: error.message });
    }
  }

  const series = await tx.appointmentSeries.create({
    // Placeholder: `scopeCreateData` stamps the caller's tenant.
    data: { tenantId: "", intervalWeeks, occurrences },
    select: { id: true },
  });

  let anchorId = "";
  for (const occurrence of planned) {
    const id = await writeBooking(tx, {
      ...plan,
      lines: occurrence.lines,
      series: { id: series.id, index: occurrence.index },
    });
    if (occurrence.index === 0) anchorId = id;
  }

  const report = appointmentSeriesReportSchema.parse({
    id: series.id,
    intervalWeeks,
    occurrences,
    created: planned.length,
    skipped,
  });

  return { id: anchorId, series: report };
}

/**
 * Applies a partial update.
 *
 * Every field is optional and absent means unchanged; `null` clears (the same
 * PATCH rule the customer and staff editors keep). The derived columns are
 * re-derived from the **merged** state: a new service re-chains the slot, a new
 * start moves it, and either way the lines — and therefore `endsAt` — are
 * recomputed so the two can never drift apart through a half-applied edit.
 */
export async function updateAppointment(
  id: string,
  input: UpdateAppointmentInput,
): Promise<AppointmentDetail> {
  await prisma.$transaction(
    async (tx) => {
      await lockBookingCalendar(tx);
      await updateAppointmentInTransaction(tx, id, input);
    },
    { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 },
  );
  return getAppointment(id);
}

async function updateAppointmentInTransaction(
  tx: Tx,
  id: string,
  input: UpdateAppointmentInput,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${id} AND "tenantId" = ${tenantId()} FOR UPDATE`;
  const existing = await tx.appointment.findFirst({ where: { id }, select: APPOINTMENT_SELECT });
  if (!existing) throw notFound("That appointment does not exist.", "APPOINTMENT_NOT_FOUND");

  const customerId = input.customerId === undefined ? existing.customerId : input.customerId;
  if (customerId) await assertCustomerExists(tx, customerId);

  const startsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt;
  // The booking's performer, as the request leaves it. It is the default for a
  // line that does not name its own, and on a patch that only moves the booking
  // it moves line 0 — the performer the day view and the messages name.
  const staffId =
    input.staffId === undefined ? (existing.lines[0]?.staffId ?? existing.staffId) : input.staffId;

  const existingServiceIds = new Set(existing.lines.map((line) => line.serviceId));
  const selections: LineSelection[] = input.services
    ? input.services.map((line) => ({ serviceId: line.serviceId, staffId: line.staffId }))
    : input.serviceId !== undefined
      ? [{ serviceId: input.serviceId, staffId }]
      : existing.lines.length > 0
        ? existing.lines.map((line, index) => ({
            serviceId: line.serviceId,
            // Only the first line follows a change of the booking's performer;
            // the rest keep the people they were booked with.
            staffId: index === 0 && input.staffId !== undefined ? staffId : line.staffId,
            durationMinutes: line.durationMinutes,
          }))
        : existing.serviceId
          ? // A row from before service lines: give it the one line it implies.
            [
              {
                serviceId: existing.serviceId,
                staffId,
                durationMinutes:
                  existing.durationMinutes !== null && existing.durationMinutes > 0
                    ? existing.durationMinutes
                    : Math.max(
                        1,
                        Math.round(
                          (existing.endsAt.getTime() - existing.startsAt.getTime()) / 60_000,
                        ),
                      ),
              },
            ]
          : [];

  if (selections.length === 0) {
    throw badRequest(
      "This booking has no service to reschedule.",
      [{ path: "services", message: "Pick at least one service." }],
      "APPOINTMENT_NO_SERVICE",
    );
  }

  const lines = await planLines(tx, startsAt, selections, staffId, {
    // Only a *new* choice has to be active; keeping a service the booking
    // already has must survive that service being retired.
    requireActiveFor: (serviceId) => !existingServiceIds.has(serviceId),
  });

  const primary = lines[0]!;
  const endsAt = lines[lines.length - 1]!.endsAt;
  const durationMinutes = totalMinutes(lines);
  const linesChanged = !sameLines(existing.lines, lines);

  // A move is what can clash, so the check re-runs when any part of the chain
  // changed — a new time under the same stylist, the same time onto a new one,
  // or a service added to the end. The booking's own id is excluded so a patch
  // that changes nothing else is not a conflict, and the resource is re-picked
  // under the same exclusion: the room this booking already holds is not "busy".
  const mustCheck =
    (input.status ?? existing.status) !== "CANCELLED" &&
    (input.startsAt !== undefined ||
      input.staffId !== undefined ||
      input.serviceId !== undefined ||
      input.services !== undefined ||
      input.status !== undefined);

  // The chain as it will be written. Re-picking a resource can move a line from
  // Room 1 to Room 2, which is exactly why the rewrite below uses this rather
  // than the freshly planned chain.
  const booked = mustCheck ? await reserve(tx, lines, id) : lines;
  // A room that changed hands is a line that changed, even when its service, its
  // performer and its window did not — so the rewrite has to happen then too.
  const resourcesChanged =
    mustCheck &&
    booked.some((line, index) => (existing.lines[index]?.resourceId ?? null) !== line.resourceId);

  const status = input.status ?? existing.status;
  // Leaving COMPLETED clears the stamp: a booking that is no longer done must
  // not keep the time it was done at, or the day's history reads as two truths.
  const finishedAt = status === "COMPLETED" ? (existing.finishedAt ?? new Date()) : null;

  const current = await tx.appointment.findFirstOrThrow({ where: { id } });
  if (current.updatedAt.getTime() !== existing.updatedAt.getTime())
    throw conflict("Booking changed. Reload before editing.", "APPOINTMENT_CHANGED");
  const relevant =
    current.customerId !== customerId ||
    current.staffId !== primary.staffId ||
    current.serviceId !== primary.serviceId ||
    current.startsAt.getTime() !== startsAt.getTime() ||
    current.endsAt.getTime() !== endsAt.getTime() ||
    current.status !== status ||
    linesChanged;

  if (linesChanged || resourcesChanged) {
    // The chain is rewritten rather than diffed: lines are cheap, ordered, and
    // a stale row left behind by a partial update is exactly the kind of ghost
    // the overlap rule would then trip over.
    await tx.appointmentLine.deleteMany({ where: { appointmentId: id } });
    await tx.appointmentLine.createMany({
      data: booked.map((line, position) => ({
        tenantId: "",
        appointmentId: id,
        serviceId: line.serviceId,
        staffId: line.staffId,
        resourceId: line.resourceId,
        position,
        startsAt: line.startsAt,
        endsAt: line.endsAt,
        durationMinutes: line.durationMinutes,
      })),
    });
  }

  await tx.appointment.update({
    where: { id },
    data: {
      customerId: customerId ?? null,
      staffId: primary.staffId,
      serviceId: primary.serviceId,
      startsAt,
      endsAt,
      status,
      durationMinutes,
      finishedAt,
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      ...(relevant ? { messageRevision: { increment: 1 }, customerConfirmedAt: null } : {}),
    },
  });
  if (relevant) await queueAppointmentMessages(tx, id);
}

/**
 * Cancels what is **left** of a repeating series.
 *
 * "Left" is deliberate: only future `SCHEDULED` occurrences are cancelled. An
 * occurrence already completed keeps its status, because cancelling it would
 * rewrite the day's history (and, once commission is paid, the money it earned);
 * a no-show stays a no-show for the same reason. A one-off booking that never
 * joined a series is untouched — this is the series' own exit, not a bulk edit.
 */
export async function cancelAppointmentSeries(seriesId: string): Promise<{ cancelled: number }> {
  return prisma.$transaction(
    async (tx) => {
      await lockBookingCalendar(tx);
      return cancelAppointmentSeriesInTransaction(tx, seriesId);
    },
    { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 },
  );
}

async function cancelAppointmentSeriesInTransaction(
  tx: Tx,
  seriesId: string,
): Promise<{ cancelled: number }> {
  const series = await tx.appointmentSeries.findFirst({
    where: { id: seriesId },
    select: { id: true },
  });
  if (!series) {
    throw notFound("That repeating booking does not exist.", "APPOINTMENT_SERIES_NOT_FOUND");
  }

  const rows = await tx.appointment.findMany({
    where: { seriesId, status: "SCHEDULED", startsAt: { gt: new Date() } },
    select: { id: true },
    orderBy: { startsAt: "asc" },
  });
  if (rows.length === 0) return { cancelled: 0 };

  await tx.appointment.updateMany({
    where: {
      id: { in: rows.map((row) => row.id) },
      status: "SCHEDULED",
      startsAt: { gt: new Date() },
    },
    data: { status: "CANCELLED" },
  });
  // Each cancelled slot is a message the customer should hear about, and the
  // queue is per booking — the same call the single-booking path makes.
  for (const row of rows) await queueAppointmentMessages(tx, row.id);
  return { cancelled: rows.length };
}
