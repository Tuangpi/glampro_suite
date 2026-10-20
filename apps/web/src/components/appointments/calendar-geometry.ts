/**
 * Calendar grid geometry — pure maths, no DOM.
 *
 * The calendar places every booking by its real `startsAt`/`endsAt` rather than by a
 * fixed row height, so a 30-minute fill and a 90-minute colour occupy honestly
 * different amounts of the track. The handoff (screen 06) drew a 9:00–19:00 grid at a
 * placeholder 1.2px/minute; the same *idea* is kept — one scale for the whole day,
 * minutes → pixels — with a wider window and a clean hour height so the maths stays
 * obvious and testable.
 *
 * Since Phase 6d one definition draws three views (ADR 0018): the day grid, the week's
 * seven day columns and the month's padded weeks. That is why the **frame**
 * (`GUTTER_WIDTH`, `HOUR_HEIGHT`, `TRACK_HEIGHT`, `DAY_HOURS`, `gridTemplate`), the
 * **windows** (`dayWindow`/`weekWindow`/`monthWindow`) and the **lane packing**
 * (`packLanes`) live here rather than inside one of the views: a booking must sit at the
 * same time, and on the same day, in all of them.
 *
 * Everything here is a pure function of a `Date`, which is what lets the grids be
 * unit-tested in jsdom without rendering a single block.
 */

import type { AppointmentSummary } from "@glampro_suite/shared";

import {
  instantFromSalonDate,
  salonDayKey,
  salonEndOfDay,
  salonMinutesIntoDay,
  salonStartOfDay,
  toSalonDate,
} from "@/lib/salon-time";

/** First hour shown in the gutter (salon time). */
export const DAY_START_HOUR = 8;
/** First hour *past* the last one shown — the track ends at this hour. */
export const DAY_END_HOUR = 20;
/** Pixels per hour — an hour is always this tall, whatever its contents. */
export const HOUR_HEIGHT = 72;
/** Derived: pixels per minute, the one scale the whole grid uses. */
export const PX_PER_MINUTE = HOUR_HEIGHT / 60;
/** Minutes across the whole visible window. */
export const DAY_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;
/** The smallest a block is drawn at, so a 5-minute booking is still clickable. */
export const MIN_BLOCK_PX = 22;
/** Drop targets snap to this many minutes (the handoff's quarter-hour slots). */
export const SNAP_MINUTES = 15;

/** The track's height: every column is exactly this tall, whatever it holds. */
export const TRACK_HEIGHT = DAY_MINUTES * PX_PER_MINUTE;

/** The gutter's width, matching the handoff's 68px time column. */
export const GUTTER_WIDTH = 68;
/** A column is never narrower than this, so a name still fits. */
export const MIN_COLUMN_WIDTH = 140;

/** The hours the gutter labels, from `DAY_START_HOUR` to `DAY_END_HOUR - 1`. */
export const DAY_HOURS: number[] = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR },
  (_, index) => DAY_START_HOUR + index,
);

/**
 * Hour lines, drawn as one repeating gradient instead of N absolutely placed divs.
 * Presentation, but it is built from `HOUR_HEIGHT`, so it lives beside it rather than
 * being re-derived — and re-derived wrongly — in each grid.
 */
export const HOUR_LINES = `repeating-linear-gradient(to bottom, transparent 0, transparent ${
  HOUR_HEIGHT - 1
}px, var(--color-line-soft) ${HOUR_HEIGHT - 1}px, var(--color-line-soft) ${HOUR_HEIGHT}px)`;

/**
 * The header and the body of a grid are two separate grids that must agree, so both take
 * their template from here — the gutter plus one equal column per day or performer.
 */
export function gridTemplate(columnCount: number): string {
  return `${GUTTER_WIDTH}px repeat(${columnCount}, minmax(${MIN_COLUMN_WIDTH}px, 1fr))`;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Minutes since salon-local midnight for `instant`, fractional seconds dropped.
 * `instant` is a UTC moment; the salon's timezone decides which wall-clock day
 * and time it falls on.
 */
export function minutesIntoDay(instant: Date, timeZone: string): number {
  const minutes = salonMinutesIntoDay(instant, timeZone);
  if (minutes === null) return Number.NaN;
  return minutes;
}

/**
 * Salon-local midnight of the day `day` falls on, as a salon-local `Date` whose
 * host-local getters read the salon wall clock. Callers pass a salon-local
 * `Date` (see `toSalonDate`); the geometry stays pure field maths on it.
 */
export function startOfDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

/** The day's last millisecond — the *inclusive* edge the API's `to` wants. */
export function endOfDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
}

/**
 * `days` later than `day` (negative walks back), holding the wall clock at midnight.
 *
 * Built from the calendar fields rather than by adding 86,400,000ms so a DST night does
 * not drag the grid's day boundary to 23:00 or 01:00. The same caution applies to every
 * day in this file.
 */
export function addDays(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
}

/**
 * The first day of the week, as JS numbers `getDay()` returns: **1 = Monday**.
 *
 * The handoff and the legacy rota both draw Monday-first. Stated once, here, so a
 * Sunday-first salon is a one-line change.
 */
export const WEEK_STARTS_ON = 1;

/** The Monday of the week that holds `day`, at midnight. */
export function startOfWeek(day: Date): Date {
  const start = startOfDay(day);
  return addDays(start, -((start.getDay() - WEEK_STARTS_ON + 7) % 7));
}

/** The seven days of `day`'s week, Monday first. */
export function weekDays(day: Date): Date[] {
  const first = startOfWeek(day);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

/** The 1st of `day`'s month. */
export function startOfMonth(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), 1);
}

/** The last day of `day`'s month. */
export function endOfMonth(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth() + 1, 0);
}

/**
 * `months` later (negative walks back), keeping the day of the month where it exists:
 * 31 January + one month is 28 February, not 3 March. Stepping a month arrow should
 * never skip a month.
 */
export function shiftMonth(day: Date, months: number): Date {
  const first = new Date(day.getFullYear(), day.getMonth() + months, 1);
  const lastDay = endOfMonth(first).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(day.getDate(), lastDay));
}

/**
 * The days a month grid draws: whole Monday-first weeks from the Monday of the week
 * holding the 1st to the Sunday of the week holding the last day. 28, 35 or 42 entries.
 */
export function monthGridDays(day: Date): Date[] {
  const first = startOfWeek(startOfMonth(day));
  const last = addDays(startOfWeek(endOfMonth(day)), 6);
  const days: Date[] = [];
  for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

/** A stable key for a local day — `2026-10-14`. Not `toISOString()`, which is UTC. */
export function dayKey(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

/** Whether two instants fall on the same local day. */
export function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * One booking belongs to the day it **starts** on (ADR 0018, decision 2), in every view.
 *
 * No straddle flag and no second query: a booking that crosses midnight is a thing the
 * 08:00–20:00 gutter cannot draw on either day anyway, and a rule that applies in the
 * grid, the chips and the day label can only be the same rule in all three.
 */
export function bookingsByDay<T extends { startsAt: string }>(
  bookings: readonly T[],
  timeZone: string,
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const booking of bookings) {
    const start = new Date(booking.startsAt);
    if (Number.isNaN(start.getTime())) continue;
    const key = salonDayKey(start, timeZone);
    if (key === null) continue;
    const bucket = byDay.get(key);
    if (bucket) bucket.push(booking);
    else byDay.set(key, [booking]);
  }
  return byDay;
}

/** Occupancy buckets for visible dates. An exact midnight end does not occupy the next day. */
export function bookingsOnDays<T extends { startsAt: string; endsAt: string }>(
  bookings: readonly T[],
  days: readonly Date[],
  timeZone: string,
): Map<string, T[]> {
  return new Map(
    days.map((day) => {
      const from = instantFromSalonDate(startOfDay(day), timeZone).getTime();
      const to = instantFromSalonDate(addDays(day, 1), timeZone).getTime();
      return [
        dayKey(day),
        bookings.filter(
          (booking) =>
            new Date(booking.startsAt).getTime() < to && new Date(booking.endsAt).getTime() > from,
        ),
      ];
    }),
  );
}

/** Month drops move the start date, not the time or performer. */
export function monthRescheduleFields(
  booking: AppointmentSummary,
  day: Date,
  timeZone: string,
): { startsAt?: string } {
  const start = toSalonDate(booking.startsAt, timeZone);
  if (!start) return {};
  const target = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    start.getHours(),
    start.getMinutes(),
    start.getSeconds(),
    start.getMilliseconds(),
  );
  const instant = instantFromSalonDate(target, timeZone);
  return instant.getTime() === new Date(booking.startsAt).getTime()
    ? {}
    : { startsAt: instant.toISOString() };
}

/** The `from`/`to` pair a calendar read sends. Both are instants, both inclusive. */
export interface CalendarWindow {
  from: string;
  to: string;
}

/** One salon-local day, midnight to its last millisecond, sent as instants. */
export function dayWindow(day: Date, timeZone: string): CalendarWindow {
  const start = salonStartOfDay(day, timeZone);
  const end = salonEndOfDay(day, timeZone);
  // `day` is always a salon-local `Date` produced by `toSalonDate`, so both
  // edges resolve. Guarded defensively; the empty window fetches nothing.
  if (!start || !end) return { from: "", to: "" };
  return {
    from: instantFromSalonDate(start, timeZone).toISOString(),
    to: instantFromSalonDate(end, timeZone).toISOString(),
  };
}

/** The whole Monday-first week that holds `day`, sent as instants. */
export function weekWindow(day: Date, timeZone: string): CalendarWindow {
  const wall = toSalonDate(day, timeZone);
  if (!wall) return { from: "", to: "" };
  const first = startOfWeek(wall);
  const start = startOfDay(first);
  const end = endOfDay(addDays(first, 6));
  return {
    from: instantFromSalonDate(start, timeZone).toISOString(),
    to: instantFromSalonDate(end, timeZone).toISOString(),
  };
}

/**
 * The calendar month, **not** the drawn grid: a padded cell from September is
 * paper, and fetching it would put a chip in a day the desk cannot see the
 * edges of. Sent as instants.
 */
export function monthWindow(day: Date, timeZone: string): CalendarWindow {
  const wall = toSalonDate(day, timeZone);
  if (!wall) return { from: "", to: "" };
  const start = startOfDay(startOfMonth(wall));
  const end = endOfDay(endOfMonth(wall));
  return {
    from: instantFromSalonDate(start, timeZone).toISOString(),
    to: instantFromSalonDate(end, timeZone).toISOString(),
  };
}

/**
 * Minutes from `day`'s own local midnight to `instant` — negative before that day and
 * past 1440 after it.
 *
 * Wall-clock minutes, not elapsed ones: a booking at 09:00 is nine hours into its day
 * whether or not the clock moved that night, so the day a salon loses an hour must not
 * draw 09:00 an hour early. The day difference is taken from the calendar fields, which
 * also keeps a DST jump from turning "tomorrow" into 0.96 of a day.
 */
export function minutesFromDayStart(instant: Date, day: Date, timeZone: string): number {
  const start = toSalonDate(instant, timeZone);
  if (!start) return Number.NaN;
  const wholeDays = Math.round(
    (startOfDay(start).getTime() - startOfDay(day).getTime()) / 86_400_000,
  );
  // `start` is salon-local: its host-local getters read the salon wall clock,
  // so minutes into the day come straight off its fields — no timezone
  // re-interpretation (which would depend on the host clock).
  return wholeDays * 1_440 + start.getHours() * 60 + start.getMinutes();
}

/** A booking's span on one day, in grid minutes clamped to the visible window. */
export interface BlockSpan {
  start: number;
  end: number;
}

/**
 * A booking's span on `day`, in **grid minutes** — minutes from the top of the visible
 * window (08:00), clamped to it — or `null` when the booking is not on that day at all.
 *
 * This is the date-aware definition the whole calendar rests on (ADR 0018, decision 2):
 * `blockBox` scales it into pixels and `packLanes` compares it for overlaps. A booking is
 * drawn on a day only where it really is — so a 10:00 booking is not a block on tomorrow,
 * and a booking that crosses midnight is on **neither** of its days, because 23:00 and
 * 01:00 both fall outside the 08:00–20:00 gutter.
 */
export function blockMinutes(
  booking: {
    startsAt: string;
    endsAt?: string | null;
    durationMinutes?: number | null;
  },
  day: Date,
  timeZone: string,
): BlockSpan | null {
  const start = toSalonDate(booking.startsAt, timeZone);
  if (!start) return null;

  // `durationMinutes` is the fallback span when `endsAt` is absent *or*
  // unparseable (the contract allows the former), so the block never collapses
  // to nothing or to `NaN`. The fallback lands `durationMinutes` later on the
  // salon clock.
  let end: Date | null = null;
  if (booking.endsAt != null) {
    end = toSalonDate(booking.endsAt, timeZone);
  }
  if (end === null) {
    const fallback = new Date(start.getTime() + (booking.durationMinutes ?? 30) * 60_000);
    end = toSalonDate(fallback, timeZone);
    if (!end) return null;
  }

  const offset = DAY_START_HOUR * 60;
  // `start`/`end` are salon-local dates used only for the fallback duration maths.
  // `minutesFromDayStart` converts raw instants itself — passing a salon-local
  // date here would double-apply the timezone. Use the raw instants instead.
  const startMin = clamp(
    minutesFromDayStart(new Date(booking.startsAt), day, timeZone) - offset,
    0,
    DAY_MINUTES,
  );
  let endMin: number | null = null;
  if (booking.endsAt != null) {
    const endInstant = new Date(booking.endsAt);
    if (!Number.isNaN(endInstant.getTime())) {
      endMin = clamp(minutesFromDayStart(endInstant, day, timeZone) - offset, 0, DAY_MINUTES);
    }
  }
  if (endMin === null) {
    // `start` is salon-local: its host-local fields read the salon wall clock,
    // so add duration minutes directly to its fields — no UTC timestamp
    // arithmetic (which would shift by the host/salon offset when they differ).
    const endMinutes = start.getHours() * 60 + start.getMinutes() + (booking.durationMinutes ?? 30);
    endMin = clamp(endMinutes - offset, 0, DAY_MINUTES);
  }

  if (endMin <= startMin) return null;
  return { start: startMin, end: endMin };
}

/**
 * A block's box on `day`'s track, or `null` when the booking is not drawn on
 * that day.
 *
 * `top`/`height` are in pixels and already clamped, so a booking that starts
 * before 08:00 salon time is drawn from the top edge rather than off-grid, and
 * one that runs past 20:00 salon time is clipped at the bottom. `MIN_BLOCK_PX`
 * keeps a very short booking clickable.
 */
export function blockBox(
  booking: {
    startsAt: string;
    endsAt?: string | null;
    durationMinutes?: number | null;
  },
  day: Date,
  timeZone: string,
): { top: number; height: number } | null {
  const span = blockMinutes(booking, day, timeZone);
  if (span === null) return null;

  return {
    top: span.start * PX_PER_MINUTE,
    height: Math.max(MIN_BLOCK_PX, (span.end - span.start) * PX_PER_MINUTE),
  };
}

/** Where one range sits in its day: lane `n` of `lanes`, both counting from zero. */
export interface LanePlacement {
  lane: number;
  lanes: number;
}

/**
 * Side-by-side lanes for the ranges that overlap inside one day column.
 *
 * The 6b rule (ADR 0014) refuses a *new* double-booking for one performer, but nothing
 * stops two unassigned bookings starting at 09:00, and a legacy row may already overlap.
 * Those are two blocks that must both stay readable, so a column divides its width into
 * lanes instead of stacking one block on the other.
 *
 * Overlap is **half-open** — `start >= previousEnd` is a free lane — the same comparison
 * ADR 0014 uses to refuse a clash, so what the week draws and what the server refuses
 * agree about "at the same time".
 *
 * `lanes` is the width of the **cluster** a range belongs to (the run of ranges that
 * overlap transitively), not of the whole day: a morning with two overlaps must not
 * squeeze an afternoon booking into a third of its column. Within a cluster a lane is
 * reused as soon as it is free, which is what keeps a chain of short bookings two lanes
 * wide instead of four.
 *
 * Ids are the keys, so they must be unique — they are appointment ids, which are.
 */
export function packLanes(
  ranges: ReadonlyArray<{ id: string; start: number; end: number }>,
): Map<string, LanePlacement> {
  const sorted = [...ranges].sort(
    (left, right) =>
      left.start - right.start || left.end - right.end || left.id.localeCompare(right.id),
  );

  const placements = new Map<string, LanePlacement>();
  const laneEnds: number[] = [];
  let cluster: { id: string; lane: number }[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const closeCluster = () => {
    const lanes = cluster.reduce((widest, entry) => Math.max(widest, entry.lane + 1), 0);
    for (const entry of cluster) placements.set(entry.id, { lane: entry.lane, lanes });
    cluster = [];
  };

  for (const range of sorted) {
    // A range starting at or after everything already placed begins a new cluster: the
    // lanes of the previous one are free again and its width is finally known.
    if (range.start >= clusterEnd) {
      closeCluster();
      clusterEnd = range.end;
    } else {
      clusterEnd = Math.max(clusterEnd, range.end);
    }

    let lane = laneEnds.findIndex((end) => end <= range.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = range.end;
    cluster.push({ id: range.id, lane });
  }
  closeCluster();

  return placements;
}

/** Where the "now" indicator sits, or `null` outside the visible window. */
export function nowLineTop(now: Date, _timeZone: string): number | null {
  // `now` is salon-local: its host-local getters read the salon wall clock,
  // so minutes into the day come straight off its fields — no timezone
  // re-interpretation (which would depend on the host clock).
  const minutes = now.getHours() * 60 + now.getMinutes();
  const m = minutes - DAY_START_HOUR * 60;
  if (m < 0 || m > DAY_MINUTES) return null;
  return m * PX_PER_MINUTE;
}

/** Round a fractional minute offset to the nearest slot (default quarter-hour). */
export function snapToSlot(minutes: number, slot = SNAP_MINUTES): number {
  return Math.round(minutes / slot) * slot;
}

/**
 * The instant a drop at `offsetMinutes` from the gutter top means, snapped.
 *
 * `offsetMinutes` is a raw pixel-derived minute offset within the salon day;
 * this turns it back into the absolute instant on `day` a drag posts as
 * `startsAt`. Kept here so slice 6c's gesture reuses one definition of
 * "the time under the pointer" that the tests can pin.
 */
export function instantFromOffset(day: Date, offsetMinutes: number, timeZone: string): Date {
  const snapped = clamp(snapToSlot(offsetMinutes), 0, DAY_MINUTES);
  // Salon wall-clock: `day` at 08:00, moved `snapped` minutes. Host-local
  // getters then read that salon wall clock, which `instantFromSalonDate` turns
  // back into the real instant the API expects.
  const result = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    DAY_START_HOUR,
    0,
    0,
    0,
  );
  result.setMinutes(result.getMinutes() + snapped);
  return instantFromSalonDate(result, timeZone);
}

/** One vertical track. `id === null` is the Unassigned column. */
export interface CalendarColumn {
  id: string | null;
  name: string;
  role?: string;
}

/**
 * The tracks the day gets: one per member of staff, then Unassigned.
 *
 * Staff come from the roster rather than from the bookings, so a stylist with
 * an empty day still has a column — "nobody booked them" and "they are not on
 * today" must look different. Unassigned is always last and always present,
 * because a booking with no performer is a real thing the day has to show.
 *
 * Kept here, beside the geometry, because it is the same kind of pure function
 * of its inputs — and because a component file must export only components
 * (`react-refresh/only-export-components`).
 */
export function buildCalendarColumns(
  appointments: AppointmentSummary[],
  staff: ReadonlyArray<{ id: string; name: string; role?: string }>,
): CalendarColumn[] {
  const columns: CalendarColumn[] = staff.map((member) => ({
    id: member.id,
    name: member.name,
    role: member.role,
  }));

  // A staff id on a booking with no matching roster row (a disabled account,
  // a page raced by a write) still deserves a column rather than a lost block.
  for (const booking of appointments) {
    if (booking.staffId && !columns.some((column) => column.id === booking.staffId)) {
      columns.push({ id: booking.staffId, name: booking.staffName ?? "Unassigned" });
    }
  }

  columns.push({ id: null, name: "Unassigned" });
  return columns;
}

/**
 * The PATCH a drag means: a new `startsAt` and/or a new `staffId`, or nothing
 * when the block was dropped back where it already was.
 *
 * A drag moves a block **down** its own column to change the time, or **across**
 * to another column to change the performer — and the two combine. Only the
 * fields that actually changed are returned, so a nudge that lands back on the
 * same slot posts nothing rather than a no-op PATCH the server would have to
 * answer with a clash check.
 *
 * `startsAt` is the snapped instant for the whole booking, derived from the drop
 * offset exactly as the block was placed; the server recomputes `endsAt` from
 * the service's duration, so the drag never sends an end time. Whether the move
 * is *allowed* — the 409 clash and the department rule — is the server's call
 * (ADR 0014, ADR 0013), never this function's.
 */
export function rescheduleFields(
  booking: AppointmentSummary,
  drop: { day: Date; offsetMinutes: number; staffId: string | null },
  timeZone: string,
): { startsAt?: string; staffId?: string | null } {
  const next: { startsAt?: string; staffId?: string | null } = {};
  if (!Number.isFinite(drop.offsetMinutes)) return next;

  const movedStart = instantFromOffset(drop.day, drop.offsetMinutes, timeZone);
  // Same minute on the same salon day is not a move; comparing instants avoids a
  // needless write for a block dropped a pixel from where it began.
  if (movedStart.getTime() !== new Date(booking.startsAt).getTime()) {
    next.startsAt = movedStart.toISOString();
  }

  if (drop.staffId !== booking.staffId) {
    next.staffId = drop.staffId;
  }

  return next;
}
