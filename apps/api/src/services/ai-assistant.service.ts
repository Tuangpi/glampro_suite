/** Read-only, deterministic assistant drafts. No sending or campaign activation. */
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { badRequest, notFound } from "../lib/http-error.js";
import { salonDayBounds } from "../lib/wall-clock.js";
import { ownerMetrics } from "./owner-metrics.service.js";
export type { OwnerSummary } from "@glampro_suite/shared";
import {
  rebookingQuerySchema,
  promoQuerySchema,
  type AssistantRange,
  type RebookingQuery,
  type PromoQuery,
} from "../schemas/ai-assistant.js";

const DAY = 86_400_000;
function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
async function salon() {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Assistant requires a tenant scope.");
  const tenant = await prisma.tenant.findUnique({
    where: { id: scope.tenantId },
    select: { timeZone: true, lowStockThreshold: true },
  });
  if (!tenant) throw notFound("Salon not found.", "TENANT_NOT_FOUND");
  return tenant;
}
/** Date-only edges include the whole salon-local day; instant edges are inclusive. */
function range(query: AssistantRange, timeZone: string, fallback: { from: Date; to: Date }) {
  const from = query.from
    ? query.from.length === 10
      ? salonDayBounds(query.from, timeZone).from
      : new Date(query.from)
    : fallback.from;
  const to = query.to
    ? query.to.length === 10
      ? salonDayBounds(query.to, timeZone).to
      : new Date(new Date(query.to).getTime() + 1)
    : fallback.to;
  if (from >= to) throw badRequest("from must not be after to.");
  return { gte: from, lt: to };
}
const ownerSummary = ownerMetrics;
export interface RebookingNudge {
  customerId: string;
  customerName: string;
  email: string;
  lastServiceDate: string;
  serviceName: string;
  suggestedRebookDate: string;
  daysSinceLastService: number;
  message: string;
}
async function rebookingNudges(input: RebookingQuery) {
  const query = rebookingQuerySchema.parse(input);
  const { timeZone } = await salon();
  const now = new Date();
  const window = range(query, timeZone, { from: new Date(0), to: new Date(now.getTime() + 1) });
  // Select the actual latest completed visit BEFORE applying the history window.
  // An old visit must not hide a recent completion outside that window.
  const customers = await prisma.customer.findMany({
    where: {
      archivedAt: null,
      marketingOptIn: true,
      pdpaConsent: true,
      email: { not: null },
      appointments: { none: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, endsAt: { gt: now } } },
    },
    select: {
      id: true,
      name: true,
      email: true,
      appointments: {
        where: { status: "COMPLETED", endsAt: { lte: now } },
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        take: 1,
        select: { startsAt: true, service: { select: { name: true } } },
      },
    },
  });
  const today = Date.parse(localDate(now, timeZone));
  const suggestedRebookDate = new Date(today + 30 * DAY).toISOString().slice(0, 10);
  const nudges: RebookingNudge[] = [];
  for (const customer of customers) {
    const last = customer.appointments[0];
    if (
      !last ||
      !customer.email?.trim() ||
      last.startsAt < window.gte ||
      last.startsAt >= window.lt
    )
      continue;
    const lastServiceDate = localDate(last.startsAt, timeZone);
    const days = Math.floor((today - Date.parse(lastServiceDate)) / DAY);
    if (days <= (query.daysThreshold ?? 60)) continue;
    const serviceName = last.service?.name ?? "service";
    nudges.push({
      customerId: customer.id,
      customerName: customer.name,
      email: customer.email,
      lastServiceDate,
      serviceName,
      suggestedRebookDate,
      daysSinceLastService: days,
      message: `It's been ${days} days since your ${serviceName}. Would you like to rebook?`,
    });
  }
  nudges.sort(
    (a, b) =>
      b.daysSinceLastService - a.daysSinceLastService || a.customerId.localeCompare(b.customerId),
  );
  return { nudges, requiresApproval: true as const };
}
export interface SlowDayPromo {
  id: string;
  name: string;
  description: string;
  discountPercentage: number;
  minBookingValue: string;
  validFrom: string;
  validTo: string;
  appliesTo: "service" | "product" | "both";
}
async function slowDayPromos(input: PromoQuery): Promise<SlowDayPromo[]> {
  const query = promoQuerySchema.parse(input);
  const { timeZone } = await salon();
  const today = localDate(new Date(), timeZone);
  const todayBounds = salonDayBounds(today, timeZone);
  // Historical low-volume heuristic, not a claim about specific future capacity.
  const monthAgo = new Date(Date.parse(today) - 30 * DAY).toISOString().slice(0, 10);
  const window = range(query, timeZone, {
    from: salonDayBounds(monthAgo, timeZone).from,
    to: todayBounds.from,
  });
  const count = await prisma.appointment.count({
    where: { startsAt: window, status: { not: "CANCELLED" } },
  });
  const days = Math.max(
    1,
    Math.round(
      (Date.parse(localDate(new Date(window.lt.getTime() - 1), timeZone)) -
        Date.parse(localDate(window.gte, timeZone))) /
        DAY,
    ) + 1,
  );
  if (count / days >= 3) return [];
  const [services, products] = await Promise.all([
    prisma.service.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
      take: 10,
    }),
    prisma.product.findMany({
      where: { status: "ACTIVE", quantity: { gt: 0 } },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
      take: 10,
    }),
  ]);
  const discount = query.discountPercentage ?? 15;
  const validFrom = localDate(todayBounds.to, timeZone);
  const validTo = new Date(Date.parse(validFrom) + 6 * DAY).toISOString().slice(0, 10);
  return [
    ...services.map((item) => ({ ...item, appliesTo: "service" as const })),
    ...products.map((item) => ({ ...item, appliesTo: "product" as const })),
  ].map((item) => ({
    id: `draft-${item.appliesTo}-${item.id}-${validFrom}`,
    name: `Special on ${item.name}`,
    description: `Draft: ${discount}% off ${item.name}, ${validFrom} to ${validTo}. Based on historical low booking volume; approval required.`,
    discountPercentage: discount,
    minBookingValue: "0.00",
    validFrom,
    validTo,
    appliesTo: item.appliesTo,
  }));
}
export const aiAssistantService = { ownerSummary, rebookingNudges, slowDayPromos };
