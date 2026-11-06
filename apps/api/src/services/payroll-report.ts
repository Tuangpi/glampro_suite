import { z } from "zod";
import {
  exact,
  fixed,
  payrollAdjustmentTotal,
  payrollBusinessDateSchema,
  payrollCommissionColumns,
  payrollCommissionTypeSchema,
  sum,
  type PayrollBaseLine,
  type PayrollCommissionType,
  type PayrollStatement,
} from "@glampro_suite/shared";
import { notFound } from "../lib/http-error.js";
import type { PayrollCloseState } from "./payroll-close-state.js";
import {
  filterPayrollBaseLines,
  frozenPayrollExportModel,
  type PayrollBaseLineFilters,
} from "./payroll-export-data.js";

/**
 * CP-006 period report and base-line drill-down.
 *
 * Every figure comes from the frozen approved snapshot through the same export model the
 * workbook and payslips use, so the report cannot drift from a downloaded file (TC-20).
 * Commission is split by the plan component the engine actually pooled it under, plus the
 * manual commission adjustments, so the columns reconcile to `payroll.commission`.
 * Salary fields are deliberately absent: managers may read this report, and the salary /
 * take-home boundary stays with the owner-only exports. The salary-derived Payroll/Sales %
 * follows that same boundary and is only serialized for an owner reader.
 */

/** Filters accepted by the drill-down. Strict, so an unknown filter fails instead of being
 * dropped and silently widening (or narrowing) the answer. */
export const payrollStatementLineQuerySchema = z.strictObject({
  outletId: z.string().trim().min(1).max(128).optional(),
  commissionType: payrollCommissionTypeSchema.optional(),
  status: z.enum(["EARNED", "REVERSED", "PAID"]).optional(),
  from: payrollBusinessDateSchema.optional(),
  to: payrollBusinessDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});
export type PayrollStatementLineQuery = z.infer<typeof payrollStatementLineQuerySchema>;

export interface PayrollReportStaffRow {
  staff: PayrollStatement["staff"];
  /** Frozen statement money. Never salary, and never split by outlet or line type. */
  payroll: { commission: string; incentive: string; collection: string };
  /**
   * How the frozen commission splits across plan components, exactly as the
   * engine pooled it. No per-type allocation is invented here.
   */
  commissionComponents: { componentKey: string; componentName: string; amount: string }[];
  /** Manual commission adjustments: `payroll.commission` = components + this. */
  commissionAdjustments: string;
  /**
   * Salary-derived KPI. Present only when the caller may read salary (owner), so
   * managers keep the report's "never salary" boundary intact.
   */
  payrollSalesPct?: string | null;
  alert?: boolean;
  lines: number;
  baseAmount: string;
  units: string;
  outlets: string[];
  commissionTypes: PayrollCommissionType[];
  firstBusinessDate: string | null;
  lastBusinessDate: string | null;
}

export interface PayrollReportTotals {
  staff: number;
  lines: number;
  commission: string;
  incentive: string;
  collection: string;
  baseAmount: string;
  units: string;
}

export interface PayrollPeriodReport {
  periodKey: string;
  currency: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  calculation: { version: string; inputHash: string; calculatedAt: string };
  approval: { at: string; reason: string };
  /** Plan-component commission columns for this period, in first-appearance order. */
  commissionColumns: { key: string; name: string }[];
  /** Whole-month aggregates of the frozen statements, independent of any filter. */
  totals: PayrollReportTotals;
  staff: PayrollReportStaffRow[];
}

/** Frozen base totals are four-decimal like the line amounts they add up. */
const baseTotal = (lines: readonly PayrollBaseLine[], field: "baseAmount" | "units") =>
  fixed(sum(lines.map((line) => exact(line[field]))), 4);

/** Period summary and per-staff breakdown. Unapproved months are refused by the export model. */
export function payrollPeriodReport(state: PayrollCloseState, owner = false): PayrollPeriodReport {
  const model = frozenPayrollExportModel(state);
  const adjustmentsByStaff = new Map(
    (state.calculation?.statements ?? []).map((statement) => [
      statement.staff.id,
      statement.inputs.adjustments,
    ]),
  );
  const rows: PayrollReportStaffRow[] = model.staff.map((row) => {
    const dates = row.lines.map((item) => item.businessDate).sort();
    return {
      staff: row.staff,
      payroll: {
        commission: row.payroll.commission,
        incentive: row.payroll.incentive,
        collection: row.payroll.collection,
      },
      commissionComponents: row.result.components.map((component) => ({
        componentKey: component.componentKey,
        componentName: component.componentName,
        amount: component.amount,
      })),
      commissionAdjustments: fixed(
        payrollAdjustmentTotal(adjustmentsByStaff.get(row.staff.id) ?? [], "COMMISSION_ADJ"),
        2,
      ),
      ...(owner ? { payrollSalesPct: row.payroll.payrollSalesPct, alert: row.payroll.alert } : {}),
      lines: row.lines.length,
      baseAmount: baseTotal(row.lines, "baseAmount"),
      units: baseTotal(row.lines, "units"),
      outlets: [
        ...new Set(
          row.lines.map((item) => item.outletId).filter((id): id is string => id !== null),
        ),
      ].sort(),
      commissionTypes: [...new Set(row.lines.map((item) => item.commissionType))].sort(),
      firstBusinessDate: dates[0] ?? null,
      lastBusinessDate: dates.at(-1) ?? null,
    };
  });
  const allLines = model.staff.flatMap((row) => row.lines);
  return {
    periodKey: model.periodKey,
    currency: model.currency,
    timeZone: model.timeZone,
    startsAt: model.startsAt,
    endsAt: model.endsAt,
    calculation: {
      version: model.calculation.version,
      inputHash: model.calculation.inputHash,
      calculatedAt: model.calculation.calculatedAt,
    },
    approval: { at: model.approval.at, reason: model.approval.reason },
    commissionColumns: payrollCommissionColumns(model.staff.map((row) => row.result)),
    totals: {
      staff: rows.length,
      lines: allLines.length,
      commission: model.totals.commission,
      incentive: model.totals.incentive,
      collection: model.totals.collection,
      baseAmount: baseTotal(allLines, "baseAmount"),
      units: baseTotal(allLines, "units"),
    },
    staff: rows,
  };
}

/** Originating record metadata captured when the base line was posted. */
export interface PayrollLineSource {
  sourceType: string;
  sourceId: string;
  saleId: string;
  occurredAt: string;
}

export interface PayrollReportLine {
  line: PayrollBaseLine;
  /** `null` when no captured source event matches; the frozen money is still shown. */
  source: PayrollLineSource | null;
}

export interface PayrollStatementLinePage {
  periodKey: string;
  staff: PayrollStatement["staff"];
  lines: PayrollReportLine[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  /** Totals over every matching line, not just this page. */
  matching: { lines: number; baseAmount: string; units: string };
}

/** Page plus the source keys the store must resolve in the same transaction. */
export interface PayrollStatementLineSelection {
  page: PayrollStatementLinePage;
  sourceKeys: string[];
}

/** Source events are immutable evidence of where a line came from; identity fields only. */
const payrollLineEventSchema = z.strictObject({
  sourceKey: z.string().min(1).max(512),
  sourceType: z.string().min(1).max(64),
  sourceId: z.string().min(1).max(128),
  saleId: z.string().min(1).max(128),
  occurredAt: z.date(),
});
export type PayrollLineEvent = z.input<typeof payrollLineEventSchema>;

/** Posted lines are keyed `<sourceKey>:<staffId>`; accept a bare source key too. */
export function payrollLineSourceCandidates(lineId: string, staffId: string): string[] {
  const suffix = `:${staffId}`;
  return lineId.endsWith(suffix) ? [lineId.slice(0, -suffix.length), lineId] : [lineId];
}

/** One staff member's frozen lines for the period, filtered and paginated. */
export function selectPayrollStatementLines(
  state: PayrollCloseState,
  staffId: string,
  rawQuery: unknown = {},
): PayrollStatementLineSelection {
  const query = payrollStatementLineQuerySchema.parse(rawQuery);
  const model = frozenPayrollExportModel(state);
  const staff = model.staff.find((row) => row.staff.id === staffId);
  if (!staff) throw notFound("No frozen statement is available for that staff member.");
  const filters: PayrollBaseLineFilters = query;
  const matching = filterPayrollBaseLines(staff.lines, filters);
  const start = (query.page - 1) * query.limit;
  const pageLines = matching.slice(start, start + query.limit);
  return {
    page: {
      periodKey: model.periodKey,
      staff: staff.staff,
      lines: pageLines.map((line) => ({ line, source: null })),
      total: matching.length,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(matching.length / query.limit),
      matching: {
        lines: matching.length,
        baseAmount: baseTotal(matching, "baseAmount"),
        units: baseTotal(matching, "units"),
      },
    },
    sourceKeys: [
      ...new Set(pageLines.flatMap((line) => payrollLineSourceCandidates(line.id, staffId))),
    ],
  };
}

/**
 * Attaches the captured source reference to each line.
 *
 * A row that does not parse, or a line with no matching event, keeps `source: null`: the
 * drill-down falls back to the frozen line rather than inventing a source or failing the
 * whole report. No amount is re-read from the source, so a later void or refund cannot
 * change an approved statement's numbers.
 */
export function attachPayrollLineSources(
  selection: PayrollStatementLineSelection,
  events: readonly PayrollLineEvent[],
): PayrollStatementLinePage {
  const bySourceKey = new Map<string, z.infer<typeof payrollLineEventSchema>>();
  for (const event of events) {
    const parsed = payrollLineEventSchema.safeParse(event);
    if (parsed.success) bySourceKey.set(parsed.data.sourceKey, parsed.data);
  }
  return {
    ...selection.page,
    lines: selection.page.lines.map((row) => {
      const event = payrollLineSourceCandidates(row.line.id, selection.page.staff.id)
        .map((key) => bySourceKey.get(key))
        .find((candidate) => candidate !== undefined);
      return {
        line: row.line,
        source: event
          ? {
              sourceType: event.sourceType,
              sourceId: event.sourceId,
              saleId: event.saleId,
              occurredAt: event.occurredAt.toISOString(),
            }
          : null,
      };
    }),
  };
}
