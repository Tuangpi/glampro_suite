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
  PAYMENT_METHODS,
  dashboardSummarySchema,
  isRedemptionPaymentMethod,
  reportOverviewSchema,
  zReportSchema,
  type DashboardQuery,
  type DashboardSummary,
  type PaymentMethodCode,
  type ReportLiability,
  type ReportOverview,
  type ReportRangeQuery,
  type ReportTender,
  type ZReport,
  type ZReportQuery,
} from "@glampro_suite/shared";

import { prisma } from "../lib/prisma.js";
import { salonDayBounds } from "../lib/wall-clock.js";
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

interface TenderRow {
  method: PaymentMethodCode;
  amount: MoneyValue;
}

/**
 * One subtotal per tender that actually took money or credit in the window.
 *
 * Rows come back in the contract's own `PAYMENT_METHODS` order, so the close
 * reads the same way everywhere. A tender nobody used is omitted rather than
 * printed as `0.00`: the list is evidence of what happened, not a form.
 */
function tenderSubtotals(payments: readonly TenderRow[]): ReportTender[] {
  const totals = new Map<PaymentMethodCode, bigint>();
  for (const payment of payments) {
    totals.set(payment.method, addMoney(totals.get(payment.method) ?? 0n, payment.amount));
  }

  return PAYMENT_METHODS.filter((method) => totals.has(method)).map((method) => ({
    method,
    amount: centsToMoney(totals.get(method) ?? 0n),
    redemption: isRedemptionPaymentMethod(method),
  }));
}

/** Money and sessions customers still hold, as of this request. */
async function liabilitySnapshot(): Promise<ReportLiability> {
  const now = new Date();
  // Expired credit cannot be spent, so counting it would overstate what the salon
  // owes. A `null` expiry means "never expires" and stays in the figure.
  const unexpired = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

  const [packages, prepaid, giftCards, outstanding] = await Promise.all([
    prisma.customerPackageHolding.findMany({
      where: { quantityRemaining: { gt: 0 }, ...unexpired },
      select: { quantityRemaining: true },
    }),
    prisma.customerValuePackageHolding.findMany({
      where: { amountRemaining: { gt: 0 }, ...unexpired },
      select: { amountRemaining: true },
    }),
    prisma.customerGiftCardHolding.findMany({
      where: { valueRemaining: { gt: 0 }, ...unexpired },
      select: { valueRemaining: true },
    }),
    prisma.customerOutstanding.findMany({
      where: { unpaidAmount: { gt: 0 } },
      select: { customerId: true, unpaidAmount: true },
    }),
  ]);

  let prepaidBalance = 0n;
  for (const holding of prepaid) prepaidBalance = addMoney(prepaidBalance, holding.amountRemaining);

  let giftCardBalance = 0n;
  for (const holding of giftCards)
    giftCardBalance = addMoney(giftCardBalance, holding.valueRemaining);

  let outstandingBalance = 0n;
  const owingCustomers = new Set<string>();
  for (const row of outstanding) {
    outstandingBalance = addMoney(outstandingBalance, row.unpaidAmount);
    owingCustomers.add(row.customerId);
  }

  return {
    packageSessions: {
      holdings: packages.length,
      sessionsRemaining: packages.reduce((total, holding) => total + holding.quantityRemaining, 0),
    },
    prepaidCredit: { holdings: prepaid.length, balance: centsToMoney(prepaidBalance) },
    giftCards: { holdings: giftCards.length, balance: centsToMoney(giftCardBalance) },
    outstanding: {
      customers: owingCustomers.size,
      balance: centsToMoney(outstandingBalance),
    },
    totalMoney: centsToMoney(prepaidBalance + giftCardBalance + outstandingBalance),
  };
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

  const [sales, lines, performances, payments, commissions, liability] = await Promise.all([
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
        discountAmount: true,
      },
    }),
    prisma.employeePerformance.findMany({
      where: { sale: { status: "COMPLETED", soldAt } },
      select: {
        amount: true,
        user: { select: { id: true, name: true, position: true } },
      },
    }),
    prisma.salePayment.findMany({
      where: { sale: { status: "COMPLETED", soldAt } },
      select: { method: true, amount: true },
    }),
    // A commission either belongs to a completed sale in the range or, when it is
    // booked against a period, was created in the range. Counting the second kind
    // by its sale date would drop it when the sale predates the commission.
    prisma.employeeCommission.findMany({
      where: {
        OR: [
          { sale: { status: "COMPLETED", soldAt } },
          { saleId: null, createdAt: { gte: from, lte: to } },
        ],
      },
      select: {
        userId: true,
        amount: true,
        user: { select: { name: true, position: true } },
      },
    }),
    liabilitySnapshot(),
  ]);

  const byDay = new Map<
    string,
    { date: string; sales: number; quantity: number; revenue: bigint; paid: bigint; tax: bigint }
  >();
  let revenue = 0n;
  let paid = 0n;
  let tax = 0n;
  let discounts = 0n;
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
  const byService = new Map<
    string,
    { serviceId: string; name: string; quantity: number; revenue: bigint }
  >();
  for (const line of lines) {
    discounts = addMoney(discounts, line.discountAmount);

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

    if (line.itemType === "SERVICE") {
      const service = byService.get(line.itemId) ?? {
        serviceId: line.itemId,
        name: line.itemName,
        quantity: 0,
        revenue: 0n,
      };
      service.quantity += line.quantity;
      service.revenue = addMoney(service.revenue, line.lineTotal);
      byService.set(line.itemId, service);
    }
  }

  const byStaff = new Map<
    string,
    {
      userId: string;
      name: string;
      position: string | null;
      creditedLines: number;
      revenue: bigint;
      commission: bigint;
    }
  >();
  for (const performance of performances) {
    const row = byStaff.get(performance.user.id) ?? {
      userId: performance.user.id,
      name: performance.user.name,
      position: performance.user.position,
      creditedLines: 0,
      revenue: 0n,
      commission: 0n,
    };
    row.creditedLines += 1;
    row.revenue = addMoney(row.revenue, performance.amount);
    byStaff.set(row.userId, row);
  }
  for (const commission of commissions) {
    const row = byStaff.get(commission.userId) ?? {
      userId: commission.userId,
      name: commission.user.name,
      position: commission.user.position,
      creditedLines: 0,
      revenue: 0n,
      commission: 0n,
    };
    row.commission = addMoney(row.commission, commission.amount);
    byStaff.set(row.userId, row);
  }

  return reportOverviewSchema.parse({
    from: query.from,
    to: query.to,
    totals: {
      revenue: centsToMoney(revenue),
      paid: centsToMoney(paid),
      tax: centsToMoney(tax),
      discounts: centsToMoney(discounts),
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
    serviceSales: [...byService.values()]
      .sort((a, b) =>
        a.revenue === b.revenue ? b.quantity - a.quantity : a.revenue > b.revenue ? -1 : 1,
      )
      .map((row) => ({ ...row, revenue: centsToMoney(row.revenue) })),
    staffPerformance: [...byStaff.values()]
      .sort((a, b) =>
        a.revenue === b.revenue
          ? a.commission === b.commission
            ? b.creditedLines - a.creditedLines
            : a.commission > b.commission
              ? -1
              : 1
          : a.revenue > b.revenue
            ? -1
            : 1,
      )
      .slice(0, 10)
      .map((row) => ({
        userId: row.userId,
        name: row.name,
        position: row.position,
        creditedLines: row.creditedLines,
        revenue: centsToMoney(row.revenue),
        commission: centsToMoney(row.commission),
      })),
    tenders: tenderSubtotals(payments),
    liability,
    asOf: new Date().toISOString(),
  });
}

/**
 * The daily close for one salon-local date.
 *
 * A Z-report is the till's own statement, so it counts **completed** sales in a
 * half-open day, the discounts they gave, what each tender took, the voids
 * stamped that day, and the unpaid balances the day created. `grossSales` is
 * net plus discount: the catalogue's value before the reduction, which is what
 * a manager reconciles against the day's promotions.
 */
export async function zReport(query: ZReportQuery): Promise<ZReport> {
  const { from, to } = salonDayBounds(query.date, query.timeZone);
  const soldAt = { gte: from, lt: to };

  const [sales, lines, payments, voids, outstanding] = await Promise.all([
    prisma.sale.findMany({
      where: { status: "COMPLETED", soldAt },
      select: { totalQuantity: true, totalAmount: true, paidAmount: true, taxAmount: true },
    }),
    prisma.saleLine.findMany({
      where: { sale: { status: "COMPLETED", soldAt } },
      select: { discountAmount: true },
    }),
    prisma.salePayment.findMany({
      where: { sale: { status: "COMPLETED", soldAt } },
      select: { method: true, amount: true },
    }),
    // `voidedAt` is the event a close cares about: the sale may have been rung up
    // yesterday and voided today, and today's Z-report must show the reversal.
    prisma.sale.findMany({
      where: { status: "VOID", voidedAt: { gte: from, lt: to } },
      select: { totalAmount: true },
    }),
    prisma.customerOutstanding.findMany({
      where: { sale: { soldAt } },
      select: { unpaidAmount: true },
    }),
  ]);

  let netSales = 0n;
  let paid = 0n;
  let tax = 0n;
  let items = 0;
  for (const sale of sales) {
    netSales = addMoney(netSales, sale.totalAmount);
    paid = addMoney(paid, sale.paidAmount);
    tax = addMoney(tax, sale.taxAmount);
    items += sale.totalQuantity;
  }

  let discounts = 0n;
  for (const line of lines) discounts = addMoney(discounts, line.discountAmount);

  let collected = 0n;
  let redeemed = 0n;
  for (const payment of payments) {
    if (isRedemptionPaymentMethod(payment.method)) {
      redeemed = addMoney(redeemed, payment.amount);
    } else {
      collected = addMoney(collected, payment.amount);
    }
  }

  let voidAmount = 0n;
  for (const sale of voids) voidAmount = addMoney(voidAmount, sale.totalAmount);

  let outstandingCreated = 0n;
  for (const row of outstanding)
    outstandingCreated = addMoney(outstandingCreated, row.unpaidAmount);

  return zReportSchema.parse({
    date: query.date,
    timeZone: query.timeZone,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      grossSales: centsToMoney(netSales + discounts),
      discounts: centsToMoney(discounts),
      netSales: centsToMoney(netSales),
      tax: centsToMoney(tax),
      paid: centsToMoney(paid),
      collected: centsToMoney(collected),
      redeemed: centsToMoney(redeemed),
      sales: sales.length,
      items,
    },
    tenders: tenderSubtotals(payments),
    voids: { count: voids.length, amount: centsToMoney(voidAmount) },
    outstandingCreated: centsToMoney(outstandingCreated),
    asOf: new Date().toISOString(),
  });
}
