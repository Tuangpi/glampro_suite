/**
 * Wall clock — the one conversion a rota cannot do without.
 *
 * A shift is stored as **minutes since local midnight** on a day of the week,
 * because "9:00 AM – 6:00 PM every Tuesday" is a statement about the clock in
 * front of the salon, not about any instant. A booking is stored as a **UTC
 * instant**, because that is the only way two salons in two timezones can hold
 * bookings without one reading the other's. The availability gate is the single
 * place those two representations meet, and this file is the bridge.
 *
 * **The bridge is an IANA timezone the browser sends, exactly as
 * `reportRangeQuerySchema` already does.** `GET /api/reports/overview` takes a
 * validated `timeZone` and formats each sale into it with `Intl`, because the
 * schema has no timezone column and letting the server guess would put "today"
 * somewhere the salon is not. The gate has the same problem and uses the same
 * answer, so there is one convention in this codebase rather than two.
 *
 * What is deliberately **not** used:
 *
 * - **`Date#getHours()`** would read the *server's* clock. A salon in Bangkok
 *   booking 09:00 would be gated by a container in Frankfurt at 04:00 and refused
 *   a shift it is standing in the middle of. That bug passes every test pinned to
 *   a UTC or same-offset fixture and only appears in production.
 * - **The offset carried on the instant's own string** is the tempting version,
 *   and it is wrong here for a reason worth recording: the client sends
 *   `Date#toISOString()`, which is **always `Z`**. So every offset would read as
 *   `+00:00` and the wall clock would come out as UTC — the same bug, wearing a
 *   cleverer disguise. It would only work if every caller changed to emit local
 *   offsets, which nothing in the tree does.
 *
 * `Intl.DateTimeFormat` in a named zone answers both questions at once — which
 * weekday it is there and how many minutes past midnight — and it gets DST right
 * because it applies the zone's own rules to the instant rather than assuming a
 * fixed offset.
 */

/**
 * Reads an instant as the wall clock of `timeZone`: the weekday there (0 =
 * Sunday, matching `Date#getDay()`, which is how `StaffShift.dayOfWeek` is
 * numbered) and the minutes past local midnight.
 *
 * `timeZone` must be a valid IANA zone. The contract validates it at the route
 * boundary (`timeZoneSchema` in `packages/shared`), so a bad zone is a `400`
 * before it reaches here; this function would otherwise throw a `RangeError`
 * from `Intl` and surface as a `500`.
 */
export function wallClockAt(
  instant: Date,
  timeZone: string,
): { dayOfWeek: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const part = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((candidate) => candidate.type === type)?.value;

  // `en-US` names the weekdays; `Date#getDay()` is the numbering the column uses,
  // so the two are mapped through one list rather than through a second convention.
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday") ?? "");

  // `hour12: false` renders midnight as `24` in some ICU versions, so the day
  // wraps rather than reading 1440 minutes into a day that does not have them.
  const hour = Number(part("hour")) % 24;
  const minute = Number(part("minute"));

  return { dayOfWeek: weekday < 0 ? 0 : weekday, minutes: hour * 60 + minute };
}

/**
 * The instant window covering a salon-local calendar date, as `[from, to)`.
 *
 * A Z-report is a statement about one day at the salon, so `"2026-10-02"` must
 * mean midnight to midnight **there**, not in UTC. The conversion is done by
 * reading the zone's own offset at the candidate instant and correcting once,
 * which is what gets a DST transition right: a spring-forward day is 23 hours
 * and a fall-back day is 25, and neither is a fixed offset added to UTC.
 *
 * `to` is the **next** local midnight, exclusive. Callers use `gte`/`lt`, so a
 * sale at exactly the boundary belongs to one day rather than both.
 */
export function salonDayBounds(date: string, timeZone: string): { from: Date; to: Date } {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);

  function startOfUtcDate(utcYear: number, utcMonth: number, utcDay: number): Date {
    const utcMidnight = Date.UTC(utcYear, utcMonth - 1, utcDay);
    const candidate = new Date(utcMidnight - zoneOffsetMs(new Date(utcMidnight), timeZone));
    // Re-read the offset at the candidate. The first read used the offset at UTC
    // midnight, which can be the other side of a DST transition from local midnight.
    return new Date(utcMidnight - zoneOffsetMs(candidate, timeZone));
  }

  return {
    from: startOfUtcDate(year, month, day),
    to: startOfUtcDate(year, month, day + 1),
  };
}

/**
 * How far `timeZone` is ahead of UTC at `instant`, in milliseconds.
 *
 * `formatToParts` renders the instant's wall clock in the zone; reading those
 * fields back as if they were UTC and subtracting the instant yields the offset.
 * `Date.UTC` already normalises an out-of-range day (the 32nd becomes the next
 * month), so the caller can ask for "the day after" without month arithmetic.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour") % 24,
    part("minute"),
    part("second"),
  );

  // Drop sub-second precision: the formatted fields have none, and comparing a
  // truncated wall clock to an instant with milliseconds would add phantom offset.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The same wall-clock moment, `weeks` later in `timeZone`.
 *
 * A weekly booking means "10:00 next Wednesday", not "10:00 + 168 hours". Across
 * a DST change those are an hour apart, and the naive addition silently walks a
 * 10:00 regular to 09:00 (or 11:00) after the clocks move. So the instant is
 * moved by whole weeks first and then **corrected by however far the zone's own
 * offset moved the wall clock** — the same "read the zone's rules at the instant"
 * technique `salonDayBounds` uses, rather than assuming a fixed offset.
 *
 * The correction is read modulo a day, because a shift that crosses local
 * midnight comes out with a wall clock on the neighbouring date: 23:30 stepping
 * back an hour reads as 00:30, which is +60 minutes of offset, not −1380.
 */
export function addWeeksInZone(instant: Date, weeks: number, timeZone: string): Date {
  if (weeks === 0) return instant;

  const wallClock = wallClockAt(instant, timeZone).minutes;
  const shifted = new Date(instant.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
  const drift = minutesWithinHalfDay(wallClockAt(shifted, timeZone).minutes - wallClock);

  return new Date(shifted.getTime() - drift * 60_000);
}

/** A minute difference folded into (-720, 720], so a day boundary reads as ±1h. */
function minutesWithinHalfDay(delta: number): number {
  const day = 24 * 60;
  return ((((delta + day / 2) % day) + day) % day) - day / 2;
}

/** `"09:00"` → `540`. The rota editor's inputs and the shift chip both read these. */
export function formatMinuteOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** `540` → `"9:00 AM"`, the shape the handoff's `.staff-shift` chip draws. */
export function formatShiftTime(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(total / 60);
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(total % 60).padStart(2, "0")} ${suffix}`;
}
