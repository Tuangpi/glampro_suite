import { ownerSummarySchema, type OwnerSummary } from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { badRequest, notFound } from "../lib/http-error.js";
import { salonDayBounds } from "../lib/wall-clock.js";
import { assistantRangeSchema, type AssistantRange } from "../schemas/ai-assistant.js";
import { resolveLowStockThreshold } from "./catalogue.service.js";

/** Shared dashboard/assistant definitions; explicit instant end edges are inclusive. */
export async function ownerMetrics(input: AssistantRange): Promise<OwnerSummary> {
  const query = assistantRangeSchema.parse(input);
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Owner metrics require a tenant scope.");
  const tenant = await prisma.tenant.findUnique({
    where: { id: scope.tenantId },
    select: { timeZone: true },
  });
  if (!tenant) throw notFound("Salon not found.", "TENANT_NOT_FOUND");
  const asOf = new Date();
  const timeZone = tenant.timeZone;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(asOf);
  const fallback = salonDayBounds(today, timeZone);
  const from = query.from
    ? query.from.length === 10
      ? salonDayBounds(query.from, timeZone).from
      : new Date(query.from)
    : fallback.from;
  const to = query.to
    ? query.to.length === 10
      ? salonDayBounds(query.to, timeZone).to
      : new Date(Date.parse(query.to) + 1)
    : fallback.to;
  if (from >= to) throw badRequest("from must not be after to.");
  const window = { gte: from, lt: to };
  const lowStockThreshold = await resolveLowStockThreshold();
  const [sales, appointments, customers, refunds, lowStock] = await Promise.all([
    prisma.sale.aggregate({
      where: { status: "COMPLETED", soldAt: window },
      _sum: { paidAmount: true },
      _count: { _all: true },
    }),
    prisma.appointment.count({ where: { startsAt: window, status: { not: "CANCELLED" } } }),
    prisma.customer.count({ where: { createdAt: window } }),
    prisma.saleRefund.aggregate({ where: { refundedAt: window }, _sum: { amount: true } }),
    prisma.product.count({ where: { status: "ACTIVE", quantity: { lte: lowStockThreshold } } }),
  ]);
  const paid = sales._sum.paidAmount ?? new Prisma.Decimal(0);
  const refunded = refunds._sum.amount ?? new Prisma.Decimal(0);
  return ownerSummarySchema.parse({
    incomeToday: paid.toFixed(2),
    completedSalePaid: paid.toFixed(2),
    refundsToday: refunded.toFixed(2),
    netPaid: paid.minus(refunded).toFixed(2),
    salesToday: sales._count._all,
    averageTicket: sales._count._all ? paid.div(sales._count._all).toFixed(2) : "0.00",
    appointmentsToday: appointments,
    newCustomersToday: customers,
    lowStockCount: lowStock,
    lowStockThreshold,
    timeZone,
    from: from.toISOString(),
    to: to.toISOString(),
    asOf: asOf.toISOString(),
  });
}
