/**
 * Staff shifts — the rota behind handoff screens 06 and 09, `/api/shifts`.
 *
 * This is the **one table in the schema that legacy never had**. `employee_leaves`
 * was the whole absence surface in the Laravel app, and no route in the 154-route
 * inventory reads a schedule, so there is nothing to be faithful to here — which
 * makes every shape below a decision rather than a transcription (ADR 0019).
 *
 * Two of those decisions are load-bearing:
 *
 * 1. **A shift is wall clock, a booking is an instant.** The row holds minutes
 *    since local midnight and a day of the week. The availability gate in
 *    `appointment.service.ts` is the only place the two meet, and it does so
 *    through a validated IANA timezone the browser sends — the same convention
 *    `reportRangeQuerySchema` already uses — never through this server's own
 *    clock, which would gate a Bangkok salon by wherever the container happens
 *    to run. See `lib/wall-clock.ts`.
 * 2. **A rota is a set of intervals a booking must fit inside.** A `BREAK` row is
 *    a negative interval in the same table, so "is this bookable" walks one list
 *    rather than applying two rules to two shapes.
 *
 * Every function runs inside the tenant scope `middleware/auth.ts` opened, so none
 * takes a tenant id (AGENTS.md rule 1) and another salon's rota is simply not
 * found. Rows are serialised **through** `shiftSummarySchema`, so a column added
 * to `StaffShift` and forgotten here throws instead of reaching the browser
 * outside its contract (AGENTS.md rule 6).
 */
import type {
  CreateShiftInput,
  PaginatedResponse,
  ShiftDetail,
  ShiftListQuery,
  ShiftSummary,
  UpdateShiftInput,
} from "@glampro_suite/shared";
import { createShiftSchema, shiftSummarySchema } from "@glampro_suite/shared";

import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { formatShiftTime } from "../lib/wall-clock.js";
import { paginated, parsePagination } from "../utils/pagination.js";

/** Columns a rota row carries. `user.name` rides along so a rota needs no join per row. */
const SHIFT_SELECT = {
  id: true,
  userId: true,
  dayOfWeek: true,
  startsAtMinute: true,
  endsAtMinute: true,
  kind: true,
  effectiveFrom: true,
  effectiveTo: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { name: true } },
} as const;

function findShiftRow(id: string) {
  return prisma.staffShift.findFirst({ where: { id }, select: SHIFT_SELECT });
}

type ShiftRow = NonNullable<Awaited<ReturnType<typeof findShiftRow>>>;

/** A date column is a `DateTime` in the row and a `YYYY-MM-DD` string on the wire. */
function toDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toSummary(row: ShiftRow): ShiftSummary {
  return shiftSummarySchema.parse({
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    dayOfWeek: row.dayOfWeek,
    startsAtMinute: row.startsAtMinute,
    endsAtMinute: row.endsAtMinute,
    kind: row.kind,
    effectiveFrom: toDate(row.effectiveFrom),
    effectiveTo: toDate(row.effectiveTo),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * `"<from> – <to>"`, the shape handoff screen 09's `.staff-shift` chip draws.
 * Shared by the service and the rota screen so the two cannot disagree about
 * whether a shift ending at midnight reads "12:00 AM" or "24:00".
 */
export function shiftWindowLabel(startsAtMinute: number, endsAtMinute: number): string {
  return `${formatShiftTime(startsAtMinute)} – ${formatShiftTime(endsAtMinute)}`;
}

/**
 * One page of the rota.
 *
 * Ordered by day then start so a week reads down the page in the order it is
 * lived. The effective window is applied **here rather than in the `where`**:
 * whether a published rota covers a given day is a comparison against a date the
 * caller supplies, which is not a stored value and so cannot be a filter on the
 * row.
 */
export async function listShifts(query: ShiftListQuery): Promise<PaginatedResponse<ShiftSummary>> {
  const { page, pageSize, skip, take } = parsePagination(query);

  const where = {
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.dayOfWeek !== undefined ? { dayOfWeek: query.dayOfWeek } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.staffShift.findMany({
      where,
      select: SHIFT_SELECT,
      orderBy: [{ dayOfWeek: "asc" }, { startsAtMinute: "asc" }, { id: "asc" }],
      skip,
      take,
    }),
    prisma.staffShift.count({ where }),
  ]);

  // `on` is a bare local date, compared as the instant that day begins in UTC:
  // both edges of a stored window are dates too, so the two are the same kind.
  const on = query.on ? new Date(`${query.on}T00:00:00.000Z`) : null;
  const visible = on ? rows.filter((row) => coversDate(row, on)) : rows;

  return paginated(visible.map(toSummary), total, { page, pageSize });
}

/**
 * Whether a published rota row applies on `date`.
 *
 * A row with neither edge set has always applied. Otherwise the window is
 * **inclusive at both ends** — a rota published "from 1 October to 31 October"
 * covers both of those days, because that is how a manager wrote it.
 */
function coversDate(
  row: { effectiveFrom: Date | null; effectiveTo: Date | null },
  date: Date,
): boolean {
  if (row.effectiveFrom && date < row.effectiveFrom) return false;
  if (row.effectiveTo && date > row.effectiveTo) return false;
  return true;
}

/** One shift row. */
export async function getShift(id: string): Promise<ShiftDetail> {
  const row = await findShiftRow(id);
  if (!row) throw notFound("That shift does not exist.", "SHIFT_NOT_FOUND");
  return toSummary(row);
}

/** A `YYYY-MM-DD` contract field becomes the UTC midnight instant the column stores. */
function toDateValue(value: string | null | undefined): Date | null | undefined {
  if (value === null || value === undefined) return value;
  return new Date(`${value}T00:00:00.000Z`);
}

/** Refuses a performer this salon does not have. */
async function assertStaffExists(userId: string): Promise<void> {
  const staff = await prisma.user.findFirst({ where: { id: userId }, select: { id: true } });
  if (!staff) throw notFound("That staff member does not exist.", "STAFF_NOT_FOUND");
}

/**
 * Refuses a break that is not inside one of the same day's shifts.
 *
 * A break outside a shift is not a smaller version of a mistake — it is a row the
 * availability gate walks straight past, because the gate asks "does this booking
 * fit inside a `WORK` interval". So it is refused at write time instead of being
 * stored as a statement about a day the person is not working.
 */
async function assertBreakInsideShift(input: CreateShiftInput): Promise<void> {
  const covering = await prisma.staffShift.findMany({
    where: {
      userId: input.userId,
      dayOfWeek: input.dayOfWeek,
      kind: "WORK",
      startsAtMinute: { lte: input.startsAtMinute },
      endsAtMinute: { gte: input.endsAtMinute },
    },
    select: { effectiveFrom: true, effectiveTo: true },
  });
  if (
    !covering.some((shift) =>
      coversEffectiveWindow(shift, {
        effectiveFrom: toDateValue(input.effectiveFrom) ?? null,
        effectiveTo: toDateValue(input.effectiveTo) ?? null,
      }),
    )
  )
    throw breakOutsideShift();
}

function coversEffectiveWindow(
  work: { effectiveFrom: Date | null; effectiveTo: Date | null },
  rest: { effectiveFrom: Date | null; effectiveTo: Date | null },
): boolean {
  return (
    (work.effectiveFrom === null ||
      (rest.effectiveFrom !== null && work.effectiveFrom <= rest.effectiveFrom)) &&
    (work.effectiveTo === null ||
      (rest.effectiveTo !== null && work.effectiveTo >= rest.effectiveTo))
  );
}

function breakOutsideShift(): HttpError {
  return badRequest(
    "A break has to sit inside one of that day's shifts.",
    undefined,
    "BREAK_OUTSIDE_SHIFT",
  );
}

/** The rows of one performer's one day, as containment arithmetic sees them. */
type DayRow = {
  id: string;
  kind: string;
  startsAtMinute: number;
  endsAtMinute: number;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

/**
 * Every break of a day must sit inside some work row of that day — checked
 * against a **hypothetical** row list the caller has already put in the final
 * state, so the same function answers both "is this new break covered?" and
 * "did shrinking that shift strand one?".
 */
function assertBreaksCovered(rows: DayRow[]): void {
  const work = rows.filter((row) => row.kind === "WORK");
  for (const row of rows) {
    if (row.kind !== "BREAK") continue;
    const covered = work.some(
      (shift) =>
        shift.startsAtMinute <= row.startsAtMinute &&
        shift.endsAtMinute >= row.endsAtMinute &&
        coversEffectiveWindow(shift, row),
    );
    if (!covered) throw breakOutsideShift();
  }
}

/**
 * Publishing a shift.
 *
 * The performer has to be a member of **this** salon — the tenant scope already
 * guarantees the lookup cannot see another tenant's user, so a foreign id is a
 * 404 rather than a cross-tenant write (AGENTS.md rule 1).
 */
export async function createShift(input: CreateShiftInput): Promise<ShiftDetail> {
  await assertStaffExists(input.userId);

  if (input.kind === "BREAK") await assertBreakInsideShift(input);

  const created = await prisma.staffShift.create({
    data: {
      // Placeholder: `scopeCreateData` overwrites it with the scope's tenant.
      tenantId: "",
      userId: input.userId,
      dayOfWeek: input.dayOfWeek,
      startsAtMinute: input.startsAtMinute,
      endsAtMinute: input.endsAtMinute,
      kind: input.kind,
      effectiveFrom: toDateValue(input.effectiveFrom) ?? null,
      effectiveTo: toDateValue(input.effectiveTo) ?? null,
      note: input.note ?? null,
    },
    select: { id: true },
  });

  return getShift(created.id);
}

/**
 * Loads each day the patch touches — the row's weekday **and** its merged
 * weekday, which are the same unless the patch moves it — replaces the edited
 * row with its merged shape in each, and refuses if any break is left uncovered.
 *
 * Two days can need checking at once: moving a `WORK` row off Monday can strand
 * Monday's lunch break, and the same move has to fit (or at least not break)
 * Tuesday's rows too.
 */
async function assertDayStillCovered(existing: ShiftRow, merged: CreateShiftInput): Promise<void> {
  const days = new Map<string, { userId: string; dayOfWeek: number }>();
  days.set(`${existing.userId}:${existing.dayOfWeek}`, {
    userId: existing.userId,
    dayOfWeek: existing.dayOfWeek,
  });
  days.set(`${merged.userId}:${merged.dayOfWeek}`, {
    userId: merged.userId,
    dayOfWeek: merged.dayOfWeek,
  });

  for (const day of days.values()) {
    const rows = await prisma.staffShift.findMany({
      where: { userId: day.userId, dayOfWeek: day.dayOfWeek },
      select: {
        id: true,
        kind: true,
        startsAtMinute: true,
        endsAtMinute: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });

    // The row as the update will leave it: replaced where it still belongs to
    // this day, absent where the patch has moved it away.
    const mergedBelongsHere = day.userId === merged.userId && day.dayOfWeek === merged.dayOfWeek;

    const finalRows: DayRow[] = rows
      .filter((row) => row.id !== existing.id)
      .concat(
        mergedBelongsHere
          ? [
              {
                id: existing.id,
                kind: merged.kind,
                startsAtMinute: merged.startsAtMinute,
                endsAtMinute: merged.endsAtMinute,
                effectiveFrom: toDateValue(merged.effectiveFrom) ?? null,
                effectiveTo: toDateValue(merged.effectiveTo) ?? null,
              },
            ]
          : [],
      );

    assertBreaksCovered(finalRows);
  }
}

/**
 * Applies a partial update. Absent leaves a field alone and `null` clears it —
 * the same PATCH rule every other editor here keeps.
 *
 * The performer check re-runs when `userId` is in the patch, and break
 * containment is re-checked against the **day's whole post-update row set** —
 * not just when the edited row is itself a break. Shrinking the `WORK` row a
 * lunch break sits inside is the same error as creating a break outside a
 * shift, and it can only be seen by loading the day as it will be: the edited
 * row replaced (or removed, if the patch moves it to another weekday) and then
 * every remaining break asked whether some work row still covers it.
 */
export async function updateShift(id: string, input: UpdateShiftInput): Promise<ShiftDetail> {
  const existing = await findShiftRow(id);
  if (!existing) throw notFound("That shift does not exist.", "SHIFT_NOT_FOUND");

  const mergedInput = {
    userId: input.userId ?? existing.userId,
    dayOfWeek: input.dayOfWeek ?? existing.dayOfWeek,
    startsAtMinute: input.startsAtMinute ?? existing.startsAtMinute,
    endsAtMinute: input.endsAtMinute ?? existing.endsAtMinute,
    kind: input.kind ?? existing.kind,
    effectiveFrom:
      input.effectiveFrom === undefined ? toDate(existing.effectiveFrom) : input.effectiveFrom,
    effectiveTo: input.effectiveTo === undefined ? toDate(existing.effectiveTo) : input.effectiveTo,
  };

  const parsed = createShiftSchema.safeParse({
    ...mergedInput,
    effectiveFrom: mergedInput.effectiveFrom ?? undefined,
  });
  if (!parsed.success) {
    throw badRequest(
      "That shift window is invalid.",
      parsed.error.issues.map((issue) => ({
        path: `body.${issue.path.join(".")}`,
        message: issue.message,
      })),
      "INVALID_SHIFT_WINDOW",
    );
  }
  const merged = parsed.data;

  if (input.userId !== undefined) await assertStaffExists(merged.userId);
  await assertDayStillCovered(existing, merged);

  await prisma.staffShift.update({
    where: { id },
    data: {
      ...(input.userId !== undefined ? { userId: merged.userId } : {}),
      ...(input.dayOfWeek !== undefined ? { dayOfWeek: merged.dayOfWeek } : {}),
      ...(input.startsAtMinute !== undefined ? { startsAtMinute: merged.startsAtMinute } : {}),
      ...(input.endsAtMinute !== undefined ? { endsAtMinute: merged.endsAtMinute } : {}),
      ...(input.kind !== undefined ? { kind: merged.kind } : {}),
      ...(input.effectiveFrom !== undefined
        ? { effectiveFrom: toDateValue(input.effectiveFrom) ?? null }
        : {}),
      ...(input.effectiveTo !== undefined
        ? { effectiveTo: toDateValue(input.effectiveTo) ?? null }
        : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  });

  return getShift(id);
}
