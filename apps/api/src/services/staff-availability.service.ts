import { conflict } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { salonTimeZone } from "../lib/salon-clock.js";
import { wallClockAt } from "../lib/wall-clock.js";

/** Enforce configured recurring hours in the salon's zone, never the host zone. */
export async function assertStaffAvailable(
  staffId: string | null,
  start: Date,
  end: Date,
  db: Pick<typeof prisma, "staffShift" | "tenant"> = prisma,
): Promise<void> {
  if (!staffId) return;
  const rows = await db.staffShift.findMany({ where: { userId: staffId } });
  if (rows.length === 0) return;
  const zone = await salonTimeZone(db);
  const dateAt = (instant: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)!.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  };
  for (let cursor = start.getTime(); cursor < end.getTime();) {
    const instant = new Date(cursor);
    const date = dateAt(instant);
    // Walk real minute boundaries so DST gaps/repeated hours are checked at
    // their actual local clock values, rather than assuming a 24-hour day.
    const segmentEnd = Math.min(end.getTime(), (Math.floor(cursor / 60_000) + 1) * 60_000);
    const from =
      wallClockAt(instant, zone).minutes +
      instant.getUTCSeconds() / 60 +
      instant.getUTCMilliseconds() / 60_000;
    const until = from + (segmentEnd - cursor) / 60_000;
    const weekday = wallClockAt(instant, zone).dayOfWeek;
    const active = rows.filter(
      (row) =>
        row.dayOfWeek === weekday &&
        (!row.effectiveFrom || row.effectiveFrom.toISOString().slice(0, 10) <= date) &&
        (!row.effectiveTo || row.effectiveTo.toISOString().slice(0, 10) >= date),
    );
    const work = active
      .filter((row) => row.kind === "WORK")
      .sort((a, b) => a.startsAtMinute - b.startsAtMinute);
    let covered = from;
    for (const row of work) {
      if (row.startsAtMinute > covered) break;
      covered = Math.max(covered, row.endsAtMinute);
    }
    if (
      until <= from ||
      covered < until ||
      active.some(
        (row) => row.kind === "BREAK" && row.startsAtMinute < until && row.endsAtMinute > from,
      )
    ) {
      throw conflict(
        "That booking falls outside the staff member's working hours or overlaps a break.",
        "STAFF_UNAVAILABLE",
      );
    }
    cursor = segmentEnd;
  }
}
