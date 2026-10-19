/**
 * Report contracts — handoff screen 05's tiles and screen 10's tables.
 *
 * The dashboard starts with four numbers the
 * **server** counted. Every tile on screen 05 is a tenant-scoped aggregate, so
 * the browser never derives a figure from the page of rows it happens to hold
 * (ADR 0010) — and "today's income" is a sum over `Sale`, which no list screen
 * would ever hold in full.
 *
 * Money is a **string on the wire**, like every other `Decimal(12,2)` in the
 * package: a JSON float has already lost the cent the till just charged.
 */
import { z } from "zod";

import { PAYMENT_METHODS } from "../constants.js";

/**
 * An IANA zone the browser sent. Validated once here so every report query —
 * the range overview and the daily Z-report — refuses a bad zone with the same
 * field-addressed `422` instead of letting `Intl` throw a `500` inside a service.
 */
const reportTimeZoneSchema = z
  .string()
  .min(1)
  .refine(
    (timeZone) => {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
        return true;
      } catch {
        return false;
      }
    },
    { message: "The report timezone is not recognised." },
  );

/**
 * `GET /api/reports/dashboard?from=&to=`
 *
 * One request for all four tiles rather than four endpoints: they are answered
 * in one pass over the same window, so the income figure and the count behind
 * it can never be observed a minute apart and disagree.
 *
 * `from`/`to` are the day's edges as the browser's clock draws them (the same
 * rule the appointment list keeps): "today" is the salon's day, and the
 * salon's timezone is not a column the schema has, so the screen sends the
 * instants rather than asking the server to guess them. Omitted, they default
 * to the server's current day — a `curl` against the endpoint still answers.
 *
 * `salesToday` counts the receipts `incomeToday` sums — the tile draws "$X in
 * N sales" from one row, and a count computed in the browser would be N−1
 * whenever a sale landed between two requests.
 */
export const dashboardQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const dashboardSummarySchema = z.object({
  /** Takings for today, `paidAmount` over completed sales. `"0.00"` when none. */
  incomeToday: z.string(),
  /** Receipts behind `incomeToday`. */
  salesToday: z.number().int().min(0),
  /** Bookings starting today, excluding the ones cancelled before they happened. */
  appointmentsToday: z.number().int().min(0),
  /** Customers whose row was created today. */
  newCustomersToday: z.number().int().min(0),
  /** Products at or below the tenant's own threshold (ADR 0010). */
  lowStock: z.number().int().min(0),
  /** When the API counted — ISO 8601, so the screen can say "as of 14:02". */
  asOf: z.string(),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/**
 * `GET /api/reports/overview?from=&to=` — screen 10's minimal-complete report.
 *
 * The range is required here (unlike the dashboard's convenient server-day
 * fallback): a report is a statement about an explicit period, and silently
 * choosing one would make an exported or shared figure impossible to reproduce.
 */
export const reportRangeQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    /** Browser IANA zone used only to label each sale with the salon's local day. */
    timeZone: reportTimeZoneSchema,
  })
  .refine((range) => new Date(range.from) <= new Date(range.to), {
    message: "The start of the report range must be before its end.",
    path: ["to"],
  });

export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;

/**
 * `GET /api/reports/z-report?date=&timeZone=` — the daily close.
 *
 * The date is a **salon-local calendar date**, not a UTC instant: a close at
 * 23:59 in Singapore belongs to that day even though most of it is the previous
 * UTC date. The route turns the date into the day's half-open instant window
 * with the same `Intl` rule the range report uses.
 */
export const zReportQuerySchema = z.object({
  date: z.iso.date(),
  timeZone: reportTimeZoneSchema,
});

export type ZReportQuery = z.infer<typeof zReportQuerySchema>;

/** A tender subtotal. Redemptions are credit spent, not money collected. */
export const reportTenderSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.string(),
  /** `PACKAGE` / `PREPAID_CREDIT` — the customer paid with a holding. */
  redemption: z.boolean(),
});

export type ReportTender = z.infer<typeof reportTenderSchema>;

/** Services sold in the range, ready for the "sales by service" table. */
export const reportServiceSalesSchema = z.object({
  serviceId: z.string(),
  name: z.string(),
  quantity: z.number().int().min(0),
  revenue: z.string(),
});

export type ReportServiceSales = z.infer<typeof reportServiceSalesSchema>;

/**
 * What customers can still spend. Package sessions are counted, not valued:
 * the catalogue stores member and non-member prices, so assigning a per-session
 * dollar value here would pick one of two real prices on the salon's behalf.
 * The three monetary liabilities are sums of what is still outstanding.
 */
export const reportLiabilitySchema = z.object({
  packageSessions: z.object({
    holdings: z.number().int().min(0),
    sessionsRemaining: z.number().int().min(0),
  }),
  prepaidCredit: z.object({
    holdings: z.number().int().min(0),
    balance: z.string(),
  }),
  giftCards: z.object({
    holdings: z.number().int().min(0),
    balance: z.string(),
  }),
  outstanding: z.object({
    customers: z.number().int().min(0),
    balance: z.string(),
  }),
  /** Prepaid credit + gift cards + unpaid balances. Sessions are not money. */
  totalMoney: z.string(),
});

export type ReportLiability = z.infer<typeof reportLiabilitySchema>;

export const reportSalesByDaySchema = z.object({
  /** `YYYY-MM-DD` in the browser timezone supplied with the range. */
  date: z.iso.date(),
  sales: z.number().int().min(0),
  quantity: z.number().int().min(0),
  revenue: z.string(),
  paid: z.string(),
  /** GST included in the day's revenue, as money (TK2610-0009 / P0-01). */
  tax: z.string(),
});

export type ReportSalesByDay = z.infer<typeof reportSalesByDaySchema>;

export const reportItemSchema = z.object({
  itemType: z.enum(["SERVICE", "PRODUCT", "PACKAGE", "VALUE_PACKAGE", "GIFT_CARD"]),
  itemId: z.string(),
  itemName: z.string(),
  quantity: z.number().int().min(0),
  revenue: z.string(),
});

export type ReportItem = z.infer<typeof reportItemSchema>;

export const reportStaffSchema = z.object({
  userId: z.string(),
  name: z.string(),
  position: z.string().nullable(),
  creditedLines: z.number().int().min(0),
  revenue: z.string(),
  /** Commission rows booked in the range; `"0.00"` when none are recorded. */
  commission: z.string(),
});

export type ReportStaff = z.infer<typeof reportStaffSchema>;

export const reportOverviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object({
    revenue: z.string(),
    paid: z.string(),
    /** GST included in the range's revenue, as money (TK2610-0009 / P0-01). */
    tax: z.string(),
    /** Discounts given on the range's completed lines. */
    discounts: z.string(),
    sales: z.number().int().min(0),
    items: z.number().int().min(0),
  }),
  salesByDay: z.array(reportSalesByDaySchema),
  topItems: z.array(reportItemSchema),
  staffPerformance: z.array(reportStaffSchema),
  /** Service-only sales, split out because staff credit is per line. */
  serviceSales: z.array(reportServiceSalesSchema),
  /** Every tender used by a completed sale in the range. */
  tenders: z.array(reportTenderSchema),
  /** What customers can still spend, as of the request. */
  liability: reportLiabilitySchema,
  asOf: z.string(),
});

export type ReportOverview = z.infer<typeof reportOverviewSchema>;

/**
 * The daily close. Gross sales less discounts is net sales, which is what the
 * till took; `collected` is money tenders and `redeemed` is credit spent.
 */
export const zReportSchema = z.object({
  date: z.iso.date(),
  timeZone: z.string(),
  /** Half-open instant window: `[from, to)`. */
  from: z.string(),
  to: z.string(),
  totals: z.object({
    grossSales: z.string(),
    discounts: z.string(),
    netSales: z.string(),
    tax: z.string(),
    paid: z.string(),
    collected: z.string(),
    redeemed: z.string(),
    sales: z.number().int().min(0),
    items: z.number().int().min(0),
  }),
  tenders: z.array(reportTenderSchema),
  voids: z.object({
    count: z.number().int().min(0),
    amount: z.string(),
  }),
  /** Unpaid balances created by the day's sales. */
  outstandingCreated: z.string(),
  asOf: z.string(),
});

export type ZReport = z.infer<typeof zReportSchema>;
