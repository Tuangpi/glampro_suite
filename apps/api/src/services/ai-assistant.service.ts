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

/** Format a Date as YYYY-MM-DD in the given timeZone (salon-local date string). */
function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

// Service interval map: service name patterns -> recommended rebooking interval in days
// Extend this map as new services are added; falls back to query daysThreshold / 60 default.
const SERVICE_INTERVALS: Record<string, number> = {
  facial: 30,
  haircut: 45,
  color: 60,
  massage: 30,
  "": 60, // default fallback
};

function getServiceInterval(serviceName: string): number {
  const lower = serviceName.toLowerCase();
  for (const [pattern, interval] of Object.entries(SERVICE_INTERVALS)) {
    if (lower.includes(pattern)) return interval;
  }
  return SERVICE_INTERVALS[""];
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
  draftId: string; // OA-03: editable draft identifier
  serviceInterval: number; // OA-03: service-specific rebooking interval in days
}

async function rebookingNudges(input: RebookingQuery) {
  const query = rebookingQuerySchema.parse(input);
  const { timeZone } = await salon();
  const now = new Date();
  const window = range(query, timeZone, { from: new Date(0), to: new Date(now.getTime() + 1) });

  // OA-03: fetch tenant channel consents for eligibility checking
  const tenant = await salon();
  const channelConsents = await prisma.channelConsent.findMany({
    where: { tenantId: tenant.id },
    select: { customerId: true, channel: true, marketing: true, service: true, preferred: true },
  });
  const channelConsentMap = new Map<string, { marketing: boolean; service: boolean }>();
  for (const cc of channelConsents) {
    const existing = channelConsentMap.get(cc.customerId);
    if (!existing) {
      channelConsentMap.set(cc.customerId, { marketing: cc.marketing, service: cc.service });
    } else {
      // Prefer explicit consents; keep true if either has it
      existing.marketing = existing.marketing || cc.marketing;
      existing.service = existing.service || cc.service;
    }
  }

  // OA-03: fetch customers eligible for rebooking nudges
  const customers = await prisma.customer.findMany({
    where: {
      archivedAt: null,
      // OA-03: check both global opt-in and channel-specific consents
      OR: [
        {
          marketingOptIn: true,
          pdpaConsent: true,
        },
        {
          // channel-specific fallback: customer must have at least one consent event
          consentEvents: {
            some: {
              OR: [
                { pdpaConsent: true },
                { marketingOptIn: true },
              ],
            },
          },
        },
      ],
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
  const nudges: RebookingNudge[] = [];
  const seenCustomers = new Set<string>(); // OA-03: deduplicate within this run

  for (const customer of customers) {
    // OA-03: deduplicate if already seen in this run
    if (seenCustomers.has(customer.id)) continue;
    seenCustomers.add(customer.id);

    const last = customer.appointments[0];
    if (!last) continue;

    const lastServiceDate = localDate(last.startsAt, timeZone);
    const serviceName = last.service?.name ?? "service";

    // OA-03: use service-specific interval, fallback to query daysThreshold, then 60
    const serviceInterval = getServiceInterval(serviceName);
    const daysThreshold = serviceInterval ?? (query.daysThreshold ?? 60);

    const days = Math.floor((today - Date.parse(lastServiceDate)) / DAY);
    if (days <= daysThreshold) continue;

    // OA-03: contact limit - max 5 nudges per customer per interval period
    const customerNudgeCount = await prisma.nudgeCount.count({
      where: {
        customerId: customer.id,
        createdAt: { gte: new Date(now.getTime() - daysThreshold * DAY) },
      },
    });
    if (customerNudgeCount >= 5) continue;

    // OA-03: deduplication - skip if customer already has a recent rebooking suggestion
    const recentRebook = await prisma.appointment.count({
      where: {
        customerId: customer.id,
        status: "COMPLETED",
        startsAt: { gte: new Date(now.getTime() - daysThreshold * DAY) },
        service: { name: { contains: "rebook" } },
      },
    });
    if (recentRebook > 0) continue;

    // OA-03: channel consent eligibility check
    const cc = channelConsentMap.get(customer.id);
    const hasMarketingConsent = cc?.marketing ?? customer.marketingOptIn;
    const hasPdpaConsent = cc?.service ?? customer.pdpaConsent;
    if (!hasMarketingConsent || !hasPdpaConsent) continue;

    // OA-03: editable draft ID
    const draftId = `rebook-${customer.id}-${Date.now()}`;

    nudges.push({
      customerId: customer.id,
      customerName: customer.name,
      email: customer.email,
      lastServiceDate,
      serviceName,
      suggestedRebookDate: new Date(today + 30 * DAY).toISOString().slice(0, 10),
      daysSinceLastService: days,
      message: `It's been ${days} days since your ${serviceName}. Would you like to rebook?`,
      draftId,
      serviceInterval,
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
        Date.parse(localDate(window.gte, timeZone))) / DAY,
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
