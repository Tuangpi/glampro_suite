import { outletOperatingHoursSchema, type OutletOperatingHours } from "@glampro_suite/shared";
import { conflict, notFound } from "../lib/http-error.js";
import { wallClockAt } from "../lib/wall-clock.js";
import { tenantId, type Tx } from "./messaging.service.js";

export const BOOKING_DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export async function bookingLocation(db: Tx, outletId: string | null) {
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId() },
    select: { timeZone: true, locale: true },
  });
  const outlet = outletId ? await db.outlet.findFirst({ where: { id: outletId } }) : null;
  if (outletId && !outlet) throw notFound("That outlet is not available.", "OUTLET_NOT_FOUND");
  if (outlet?.status !== undefined && outlet.status !== "ACTIVE")
    throw conflict("That outlet is suspended.", "OUTLET_SUSPENDED");
  const company = await db.tenantOperatingHours.findUnique({ where: { tenantId: tenantId() } });
  const hours =
    outlet?.operatingHours != null
      ? outletOperatingHoursSchema.parse(outlet.operatingHours)
      : outletOperatingHoursSchema.parse(
          Object.fromEntries(
            BOOKING_DAYS.map((day) => {
              const open = company?.[`${day}Open`];
              const close = company?.[`${day}Close`];
              return [day, open && close ? { open, close } : null];
            }),
          ),
        );
  return {
    outlet,
    hours,
    timeZone: outlet?.timeZone ?? tenant.timeZone,
    locale: outlet?.locale ?? tenant.locale,
  };
}

/** Check every real minute, including date boundaries and DST transitions. */
export function fitsOperatingHours(
  hours: OutletOperatingHours,
  zone: string,
  start: Date,
  end: Date,
) {
  if (end <= start) return false;
  for (let cursor = start.getTime(); cursor < end.getTime();) {
    const instant = new Date(cursor);
    const clock = wallClockAt(instant, zone);
    const window = hours[BOOKING_DAYS[clock.dayOfWeek]!];
    if (!window) return false;
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const segmentEnd = Math.min(end.getTime(), (Math.floor(cursor / 60000) + 1) * 60000);
    const from =
      clock.minutes + instant.getUTCSeconds() / 60 + instant.getUTCMilliseconds() / 60000;
    if (from < minutes(window.open) || from + (segmentEnd - cursor) / 60000 > minutes(window.close))
      return false;
    cursor = segmentEnd;
  }
  return true;
}

export async function assertOutletBookingHours(
  db: Tx,
  outletId: string | null,
  start: Date,
  end: Date,
) {
  // Legacy/manual company-wide appointments keep their existing behavior.
  if (!outletId) return;
  const location = await bookingLocation(db, outletId);
  if (!fitsOperatingHours(location.hours, location.timeZone, start, end))
    throw conflict("The booking is outside this outlet's operating hours.", "OUTLET_CLOSED");
}
