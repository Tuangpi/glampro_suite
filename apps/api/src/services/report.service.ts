/**
 * Reports — handoff screen 05's tiles, `/api/reports`.
 *
 * The phase's full report catalogue, export and charts are still ahead of this
 * file (`docs/roadmap.md` → Phase 7); the MVP carries the dashboard's four
 * numbers plus screen 10's date-range overview. The tiles live here rather than
 * in four bespoke endpoints because they are **one question asked of one
 * window**: how was today.
 *
 * Every figure is a tenant-scoped aggregate the server counts — the browser
 * never sums the page of rows it happens to hold (ADR 0010). Runs inside the
 * tenant scope `middleware/auth.ts` opened; no function takes a tenant id.
 */
import {
  dashboardSummarySchema,
  reportOverviewSchema,
  type DashboardQuery,
  type DashboardSummary,
  type ReportOverview,
  type ReportRangeQuery,
} from "@glampro_suite/shared";

import { prisma } from "../lib/prisma.js";
import { resolveLowStockThreshold } from "./catalogue.service.js";

/** A `Decimal(12,2)` on the wire is a string, so no cent is lost to a float. */
function money(value: { toFixed: (digits: number) => string } | null): string {
  return value ? value.toFixed(2) : "0.00";
}

/**
 * The server's current day, for a caller that sent no edges — a `curl` against
 * the endpoint still answers. The browser always sends its own edges (see
 * `dashboardQuerySchema`), so this fallback is the unusual case rather than
 * the one the dashboard depends on.
 */
function serverDay(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from, to };
}

function windowOf(query: DashboardQuery): { from: Date | undefined; to: Date | undefined } {
  const fallback = serverDay();
  return {
    from: query.from ? new Date(query.from) : fallback.from,
    to: query.to ? new Date(query.to) : fallback.to,
  };
}

/**
 * The four tiles, counted in one pass.
 *
 * All three windowed counts use the same `gte`/`lte` pair, because the client's
 * `to` is the last instant of the day rather than the next midnight, and one
 * rule across all three is what stops the income tile and the appointment tile
 * from disagreeing about whether 23:59:59 falls inside the day.
 */
export async function dashboardSummary(query: DashboardQuery): Promise<DashboardSummary> {
  const { from, to } = windowOf(query);

  const window = {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };

  const [sales, appointments, newCustomers, threshold] = await Promise.all([
    prisma.sale.aggregate({
      where: { status: "COMPLETED", soldAt: window },
      _sum: { paidAmount: true },
      _count: { _all: true },
    }),
    prisma.appointment.count({
      // A cancelled booking did not happen; everything else in the window —
      // including a no-show — is a slot the salon held and is shown as one.
      where: { startsAt: window, status: { not: "CANCELLED" } },
    }),
    prisma.customer.count({ where: { createdAt: window } }),
    resolveLowStockThreshold(),
  ]);

  const lowStock = await prisma.product.count({
    where: { quantity: { lte: threshold } },
  });

  return dashboardSummarySchema.parse({
    incomeToday: money(sales._sum.paidAmount),
    salesToday: sales._count._all,
    appointmentsToday: appointments,
    newCustomersToday: newCustomers,
    lowStock,
    asOf: new Date().toISOString(),
  });
}

/** Decimal-like values returned by Prisma aggregates and rows. */
interface MoneyValue {
  toFixed: (digits: number) => string;
}

/** Adds decimal strings without routing money through a JavaScript float. */
function addMoney(current: bigint, value: MoneyValue): bigint {
  const fixed = value.toFixed(2);
  const negative = fixed.startsWith("-");
  const [whole = "0", fraction = "00"] = fixed.replace("-", "").split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return current + (negative ? -cents : cents);
}

function centsToMoney(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}

/**
 * Screen 10's minimal report: totals plus three real tables over one range.
 *
 * The lists are intentionally read and folded in application code for this MVP
 * slice. Prisma's tenant extension scopes each read, and the full reporting phase
 * can replace these folds with RLS-protected SQL once the catalogue is large enough
 * to justify it (`TENANCY.md` §9).
 */
export async function reportOverview(query: ReportRangeQuery): Promise<ReportOverview> {
  const from = new Date(query.from);
  const to = new Date(query.to);
  const soldAt = { gte: from, lte: to };
  const localDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: query.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function dateKey(value: Date): string {
    const parts = Object.fromEntries(
      localDay
        .formatToParts(value)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
  }

  const [sales, lines, performances] = await Promise.all([
    prisma.sale.findMany({
      where: { status: "COMPLETED", soldAt },
      select: {
        soldAt: true,
        totalQuantity: true,
        totalAmount: true,
        paidAmount: true,
        taxAmount: true,
      },
      orderBy: { soldAt: "asc" },
    }),
    prisma.saleLine.findMany({
      where: { sale: { status: "COMPLETED", soldAt } },
      select: {
        itemType: true,
        itemId: true,
        itemName: true,
        quantity: true,
        lineTotal: true,
      },
    }),
    prisma.employeePerformance.findMany({
      where: { sale: { status: "COMPLETED", soldAt } },
      select: {
        amount: true,
        user: { select: { id: true, name: true, position: true } },
      },
    }),
  ]);

  const byDay = new Map<
    string,
    { date: string; sales: number; quantity: number; revenue: bigint; paid: bigint; tax: bigint }
  >();
  let revenue = 0n;
  let paid = 0n;
  let tax = 0n;
  let items = 0;

  for (const sale of sales) {
    const date = dateKey(sale.soldAt);
    const row = byDay.get(date) ?? { date, sales: 0, quantity: 0, revenue: 0n, paid: 0n, tax: 0n };
    row.sales += 1;
    row.quantity += sale.totalQuantity;
    row.revenue = addMoney(row.revenue, sale.totalAmount);
    row.paid = addMoney(row.paid, sale.paidAmount);
    // Stored GST summed, never recomputed: history is what the till charged.
    row.tax = addMoney(row.tax, sale.taxAmount);
    byDay.set(date, row);

    revenue = addMoney(revenue, sale.totalAmount);
    paid = addMoney(paid, sale.paidAmount);
    tax = addMoney(tax, sale.taxAmount);
    items += sale.totalQuantity;
  }

  const byItem = new Map<
    string,
    {
      itemType: (typeof lines)[number]["itemType"];
      itemId: string;
      itemName: string;
      quantity: number;
      revenue: bigint;
    }
  >();
  for (const line of lines) {
    const key = `${line.itemType}:${line.itemId}`;
    const row = byItem.get(key) ?? {
      itemType: line.itemType,
      itemId: line.itemId,
      itemName: line.itemName,
      quantity: 0,
      revenue: 0n,
    };
    row.quantity += line.quantity;
    row.revenue = addMoney(row.revenue, line.lineTotal);
    byItem.set(key, row);
  }

  const byStaff = new Map<
    string,
    {
      userId: string;
      name: string;
      position: string | null;
      creditedLines: number;
      revenue: bigint;
    }
  >();
  for (const performance of performances) {
    const row = byStaff.get(performance.user.id) ?? {
      userId: performance.user.id,
      name: performance.user.name,
      position: performance.user.position,
      creditedLines: 0,
      revenue: 0n,
    };
    row.creditedLines += 1;
    row.revenue = addMoney(row.revenue, performance.amount);
    byStaff.set(row.userId, row);
  }

  return reportOverviewSchema.parse({
    from: query.from,
    to: query.to,
    totals: {
      revenue: centsToMoney(revenue),
      paid: centsToMoney(paid),
      tax: centsToMoney(tax),
      sales: sales.length,
      items,
    },
    salesByDay: [...byDay.values()].map((row) => ({
      ...row,
      revenue: centsToMoney(row.revenue),
      paid: centsToMoney(row.paid),
      tax: centsToMoney(row.tax),
    })),
    topItems: [...byItem.values()]
      .sort((a, b) =>
        a.revenue === b.revenue ? b.quantity - a.quantity : a.revenue > b.revenue ? -1 : 1,
      )
      .slice(0, 10)
      .map((row) => ({ ...row, revenue: centsToMoney(row.revenue) })),
    staffPerformance: [...byStaff.values()]
      .sort((a, b) =>
        a.revenue === b.revenue
          ? b.creditedLines - a.creditedLines
          : a.revenue > b.revenue
            ? -1
            : 1,
      )
      .slice(0, 10)
      .map((row) => ({ ...row, revenue: centsToMoney(row.revenue) })),
    asOf: new Date().toISOString(),
  });
}
