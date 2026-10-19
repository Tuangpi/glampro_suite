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
    timeZone: z.string().min(1),
  })
  .refine((range) => new Date(range.from) <= new Date(range.to), {
    message: "The start of the report range must be before its end.",
    path: ["to"],
  })
  .refine(
    (range) => {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: range.timeZone }).format(new Date());
        return true;
      } catch {
        return false;
      }
    },
    { message: "The report timezone is not recognised.", path: ["timeZone"] },
  );

export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;

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
    sales: z.number().int().min(0),
    items: z.number().int().min(0),
  }),
  salesByDay: z.array(reportSalesByDaySchema),
  topItems: z.array(reportItemSchema),
  staffPerformance: z.array(reportStaffSchema),
  asOf: z.string(),
});

export type ReportOverview = z.infer<typeof reportOverviewSchema>;
