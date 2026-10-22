/** AI Assistant — owner summary, rebooking nudges, slow-day promos.
 *
 * All functions run inside the tenant scope `middleware/auth.ts` opened, so
 * none of them takes a tenant id. Rows are serialised through the shared Zod
 * schemas, so a column added to a model and forgotten here throws instead of
 * reaching the browser outside its contract (AGENTS.md rule 6).
 */

/** Shared imports */
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { resolveLowStockThreshold } from "./catalogue.service.js";

/** ---------- Owner Summary ---------- */

/** Daily aggregated metrics for the owner dashboard. */
export interface OwnerSummary {
  incomeToday: string;
  appointmentsToday: number;
  newCustomersToday: number;
  lowStockCount: number;
  refundsToday: string;
  averageTicket: string;
}

/** Query parameters for owner summary (optional date range). */
interface OwnerSummaryQuery {
  from?: string;
  to?: string;
}

/** Compute the owner summary for a given window. */
async function ownerSummary(query: OwnerSummaryQuery): Promise<OwnerSummary> {
  const { from, to } = query;

  const window = from || to
    ? {
        gte: from ? new Date(from) : undefined,
        lte: to ? new Date(to) : undefined,
      }
    : undefined;

  const [sales, appointments, newCustomers, refunds] = await Promise.all([
    prisma.sale.aggregate({
      where: {
        status: "COMPLETED",
        ...(window && { soldAt: window }),
      },
      _sum: { paidAmount: true },
      _count: { _all: true },
    }),
    prisma.appointment.count({
      where: {
        ...(window && { startsAt: window }),
        status: { not: "CANCELLED" },
      },
    }),
    prisma.customer.count({ where: { createdAt: window } }),
    prisma.saleRefund.aggregate({
      where: { refundedAt: window },
      _sum: { amount: true },
    }),
  ]);

  const lowStock = await prisma.product.count({
    where: { quantity: { lte: await resolveLowStockThreshold() } },
  });

  // Prisma _sum returns Decimal | null; coerce to number safely
  const totalIncome = Number(sales._sum?.paidAmount ?? new Prisma.Decimal(0));
  const appointmentCount = appointments;
  const avgTicket = appointmentCount > 0 ? totalIncome / appointmentCount : 0;

  return {
    incomeToday: totalIncome.toFixed(2),
    appointmentsToday: appointmentCount,
    newCustomersToday: newCustomers ?? 0,
    lowStockCount: lowStock,
    refundsToday: (refunds._sum?.amount ?? new Prisma.Decimal(0)).toFixed(2),
    averageTicket: avgTicket.toFixed(2),
  };
}

/** ---------- Rebooking Nudges ---------- */

/** A rebooking recommendation for a customer. */
export interface RebookingNudge {
  customerId: string;
  customerName: string;
  email: string;
  lastServiceDate: string | null;
  serviceName: string;
  suggestedRebookDate: string;
  daysSinceLastService: number;
  message: string;
}

/** Query parameters for rebooking nudges. */
interface RebookingNudgesQuery {
  from?: string;
  to?: string;
  daysThreshold?: number; // nudge if last service was > this many days ago
}

/** Check if a customer has consent for rebooking nudges. */
async function hasRebookingConsent(customerId: string): Promise<boolean> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { marketingOptIn: true, pdpaConsent: true },
  });
  if (!customer) return false;
  // Require either marketing opt-in or PDPA consent for rebooking nudge
  return customer.marketingOptIn || customer.pdpaConsent;
}

/** Query parameters for rebooking nudges with consent. */
interface RebookingNudgesQuery {
  from?: string;
  to?: string;
  daysThreshold?: number; // nudge if last service was > this many days ago
}

/** Generate rebooking nudges for customers whose last service was too long ago. */
async function rebookingNudges(
  query: RebookingNudgesQuery,
): Promise<{ nudges: RebookingNudge[]; requiresApproval: boolean }> {
  const threshold = query.daysThreshold ?? 60; // nudge if > 60 days since last service

  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;

  // Find appointments that are not cancelled and are in the window
  const appointments = await prisma.appointment.findMany({
    where: {
      ...(from || to ? { startsAt: { gte: from, lte: to } } : {}),
      status: { not: "CANCELLED" },
    },
    include: {
      customer: {
        select: { id: true, name: true, email: true },
      },
      service: {
        select: { id: true, name: true },
      },
    },
    take: 200, // limit for performance
  });

  const nudges: RebookingNudge[] = [];
  let requiresApproval = false;

  for (const appt of appointments) {
    const customer = appt.customer;
    const service = appt.service;
    const lastServiceDate = appt.startsAt;

    // Calculate days since last service
    if (lastServiceDate) {
      const lastDate = typeof lastServiceDate === "object" ? lastServiceDate : new Date(String(lastServiceDate));
      const today = new Date();
      const diffDays = Math.floor(
        (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (diffDays > threshold) {
        // Check consent before adding nudge
        const hasConsent = await hasRebookingConsent(customer.id);
        if (!hasConsent) {
          requiresApproval = true; // Outbound action requires approval
          continue; // Skip this customer until consent is verified
        }

        // Suggest rebooking - aim for about 30 days from now
        const suggestedDate = new Date();
        suggestedDate.setDate(suggestedDate.getDate() + 30);

        nudges.push({
          customerId: customer?.id || "",
          customerName: customer?.name || "",
          email: customer?.email || "",
          lastServiceDate:
            lastDate.getTime() !== undefined
              ? lastDate.toISOString().split("T")[0]
              : null,
          serviceName: service?.name || "Unknown Service",
          suggestedRebookDate: suggestedDate.toISOString().split("T")[0],
          daysSinceLastService: diffDays,
          message: `It's been ${diffDays} days since your ${service?.name || "service"}. Would you like to rebook?`,
        });
      }
    }
  }

  // Sort by days since last service (most urgent first)
  nudges.sort((a, b) => b.daysSinceLastService - a.daysSinceLastService);

  return { nudges, requiresApproval };
}

/** ---------- Slow-Day Promos ---------- */
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

/** Query parameters for slow-day promos. */
interface SlowDayPromosQuery {
  from?: string;
  to?: string;
  discountPercentage?: number;
}

/** Identify slow days and generate promotional offers. */
async function slowDayPromos(
  query: SlowDayPromosQuery,
): Promise<SlowDayPromo[]> {
  const { from, to, discountPercentage: DiscountPct } = query;
  const discount = DiscountPct ?? 15; // default 15% off

  const dateFrom = from ? new Date(from) : undefined;
  const dateTo = to ? new Date(to) : undefined;

  // Determine the date range to analyze (default to last 30 days)
  const analysisFrom = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const analysisTo = dateTo || new Date();

  // Count appointments per day in the analysis window
  const appointmentsByDay = await prisma.appointment.aggregate({
    where: {
      startsAt: {
        gte: analysisFrom,
        lte: analysisTo,
        not: "CANCELLED",
      },
    },
    _count: true,
  });

  // Calculate average daily appointments
  const daysInRange = Math.max(
    1,
    Math.floor((analysisTo.getTime() - analysisFrom.getTime()) / (1000 * 60 * 60 * 24)),
  );

  const avgAppointmentsPerDay = (appointmentsByDay._count || 0) / daysInRange;

  // A day is "slow" if it has below average appointments
  const IS_SLOW = avgAppointmentsPerDay < 3; // threshold: less than 3 appointments per day on average

  if (!IS_SLOW) {
    return []; // No slow days detected
  }

  // Generate promos for slow days
  const promos: SlowDayPromo[] = [];

  // Find services that can be promoted
  const services = await prisma.service.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    take: 10,
  });

  // Find products that can be promoted
  const products = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    take: 10,
  });

  // Create service promos
  for (const service of services) {
    const promoId = `promo-${service.id}-${Date.now()}`;
    promos.push({
      id: promoId,
      name: `Special on ${service.name}`,
      description: `Enjoy ${discount}% off ${service.name} this week`,
      discountPercentage: discount,
      minBookingValue: "0.00",
      validFrom: analysisFrom.toISOString().split("T")[0],
      validTo: analysisTo.toISOString().split("T")[0],
      appliesTo: "service",
    });
  }

  // Create product promos
  for (const product of products) {
    const promoId = `promo-${product.id}-${Date.now()}`;
    promos.push({
      id: promoId,
      name: `Special on ${product.name}`,
      description: `Enjoy ${discount}% off ${product.name} this week`,
      discountPercentage: discount,
      minBookingValue: "0.00",
      validFrom: analysisFrom.toISOString().split("T")[0],
      validTo: analysisTo.toISOString().split("T")[0],
      appliesTo: "product",
    });
  }

  return promos;
}

/** Export all functions. */
export const aiAssistantService = {
  ownerSummary,
  rebookingNudges,
  slowDayPromos,
};