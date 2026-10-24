import {
  quietDayQuerySchema,
  quietDayResponseSchema,
  type QuietDayQuery,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { notFound } from "../lib/http-error.js";
import { salonDayBounds } from "../lib/wall-clock.js";
import { slotContext, withinHours } from "./public-booking.service.js";
import { isAppointmentSlotAvailable } from "./appointment.service.js";

const DAY = 86400000;
const CHECK_LIMIT = 120;
const STAFF_LIMIT = 10;

/** Read-only, company-wide appointment preview; no public booking enablement needed. */
export async function quietDayOpportunities(raw: QuietDayQuery) {
  const query = quietDayQuerySchema.parse(raw);
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Quiet-day opportunities require tenant scope.");
  const tenant = await prisma.tenant.findUnique({
    where: { id: scope.tenantId },
    select: { timeZone: true },
  });
  if (!tenant) throw notFound("Salon not found.", "TENANT_NOT_FOUND");
  const context = await slotContext(prisma, scope.tenantId, query.serviceId, STAFF_LIMIT + 1);
  const timeZone = context.timeZone;
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const dateAfter = (days: number) =>
    new Date(Date.parse(today) + days * DAY).toISOString().slice(0, 10);
  const opportunities = [];
  let checkedSlots = 0;
  let searchLimited = context.candidates.length > STAFF_LIMIT;
  const candidates = context.candidates.slice(0, STAFF_LIMIT);
  for (let day = 1; day <= query.days; day++) {
    const date = dateAfter(day);
    const bounds = salonDayBounds(date, timeZone);
    const bookingCount = await prisma.appointment.count({
      where: { startsAt: { gte: bounds.from, lt: bounds.to }, status: { not: "CANCELLED" } },
    });
    // A disclosed screening heuristic, not measured utilisation or a forecast.
    if (bookingCount >= 3) continue;
    let found = false;
    for (
      let cursor = bounds.from.getTime();
      cursor < bounds.to.getTime() && !found;
      cursor += 60000
    ) {
      const start = new Date(cursor);
      if (!withinHours(context, start, timeZone)) continue;
      for (const staff of candidates) {
        if (checkedSlots >= CHECK_LIMIT) {
          searchLimited = true;
          break;
        }
        checkedSlots++;
        if (await isAppointmentSlotAvailable(prisma, context.service.id, staff.id, start)) {
          opportunities.push({
            date,
            bookingCount,
            startsAt: start.toISOString(),
            endsAt: new Date(cursor + context.duration * 60000).toISOString(),
            staffId: staff.id,
            action: "Review this opening before offering a regular-price appointment." as const,
          });
          found = true;
          break;
        }
      }
      if (checkedSlots >= CHECK_LIMIT) break;
    }
    if (checkedSlots >= CHECK_LIMIT && day < query.days) {
      searchLimited = true;
      break;
    }
  }
  return quietDayResponseSchema.parse({
    asOf: now.toISOString(),
    timeZone,
    from: salonDayBounds(dateAfter(1), timeZone).from.toISOString(),
    to: salonDayBounds(dateAfter(query.days), timeZone).to.toISOString(),
    serviceId: context.service.id,
    serviceName: context.service.name,
    durationMinutes: context.duration,
    lowBookingThreshold: 3,
    checkedSlots,
    searchLimited,
    discountPercentage: 0,
    requiresApproval: true,
    opportunities,
    limitations: [
      "Company-wide appointment counts: fewer than three non-cancelled starts per local day is a screening rule, not utilisation or demand.",
      "At most one opening per day, ten eligible staff and 120 staff/slot checks. Missing results do not prove a day is full.",
      "Configured hours, staff eligibility, shifts/breaks, appointment conflicts and service resources are checked using booking rules. Unconfigured shifts are unrestricted by those rules.",
      "Missing service duration uses the booking system's 60-minute fallback. No leave, skill or outlet-specific roster is inferred beyond configured booking data.",
      "Slots are not reserved. Times and consent must be rechecked before booking or any future outreach; no recipients are selected here.",
      "No discretionary discount ceiling is approved: only regular-price suggestions (0% discount). No voucher, package price, membership price or existing offer is changed or stacked.",
      "No utilisation, profit, revenue uplift or booking guarantee is inferred. Nothing is saved, activated, approved or sent.",
    ],
  });
}
