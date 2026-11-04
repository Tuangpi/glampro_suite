import {
  add,
  cmp,
  exact,
  fixed,
  sum,
  type PayrollOwnStatement,
  type PayrollProgressRow,
  type PayrollProgressView,
  type PayrollStatement,
} from "@glampro_suite/shared";
import type { PayrollCloseState } from "./payroll-close-state.js";

/**
 * CP-006 progress read model (FR-RPT-04, FR-POS-09) and own-data statement summaries
 * (FR-RPT-05).
 *
 * Both are pure projections of a **stored** payroll close. Nothing here loads a source
 * record, recalculates a band or re-reads a price:
 *
 * - The figures are the engine's own output (`calculation.statements`), produced by
 *   `assemblePayrollStatement` from the frozen inputs. An approved month therefore
 *   reports exactly what the period report and the exports report, and an unapproved
 *   month is the same arithmetic on inputs that newer postings may still extend —
 *   which is precisely why it is labelled an estimate.
 * - Reusing the snapshot is also what keeps the read inside the CP-007 budget: it is
 *   a single row read, not a full monthly loader pass over every receipt.
 *
 * Salary is absent by construction: `payroll.commission`, `payroll.incentive` and the
 * component results are taken, and `basicSalary`, `fixedOvertime`, `levy` and
 * `takeHome` are never copied into the projection.
 */

/** Frozen base totals are four-decimal, like the line amounts they add up. */
function total4(
  lines: readonly { baseAmount: string; units: string }[],
  field: "baseAmount" | "units",
) {
  return fixed(sum(lines.map((line) => exact(line[field]))), 4);
}

/**
 * The salon-local payroll month `now` falls in.
 *
 * A payroll month is a wall-clock month at the salon, so the key is read from the
 * tenant's zone rather than from the server's UTC clock — a salon in Singapore is
 * already in the next month while a UTC container still reads the old one.
 */
export function salonPeriodKey(timeZone: string, now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return day.slice(0, 7);
}

/** Stage names live in the frozen plan definition, so no extra plan read is needed. */
function stageName(statement: PayrollStatement): string {
  const stages = statement.inputs.calculation.plan?.definition.stages ?? [];
  const stage = stages.find((row) => row.key === statement.result.stageKey);
  if (stage) return stage.name;
  return statement.result.stageKey === "std" ? "Standard" : statement.result.stageKey;
}

/**
 * The tier component the statement is currently banded in.
 *
 * Same rule as the reference overview: a banded tier with a positive base wins,
 * otherwise the first tier component (a seller below the first band still wants to
 * see how far the next one is), otherwise there is no band to show.
 */
function mainComponent(statement: PayrollStatement) {
  const banded = statement.result.components.find(
    (row) => row.bandIndex !== null && cmp(exact(row.pooledBase), exact("0")) > 0,
  );
  return (
    banded ?? statement.result.components.find((row) => row.method.startsWith("TIER_")) ?? null
  );
}

/** One staff member's month-to-date line, copied from their stored statement. */
export function payrollProgressRow(
  statement: PayrollStatement,
  planName: string | null,
): PayrollProgressRow {
  const main = mainComponent(statement);
  const lines = statement.inputs.calculation.lines;
  const commission = statement.payroll.commission;
  const incentive = statement.payroll.incentive;
  return {
    staff: {
      id: statement.staff.id,
      name: statement.staff.name,
      disabled: statement.staff.disabled,
    },
    planId: statement.result.planId,
    planName,
    stageKey: statement.result.stageKey,
    stageName: stageName(statement),
    tenureMonth: statement.result.tenureMonth,
    mainComponent: main?.componentName ?? null,
    mainBase: main?.pooledBase ?? "0.0000",
    currentRate: main?.ratePct ?? null,
    nextThreshold: main?.nextThreshold ?? null,
    gapToNext: main?.gapToNext ?? null,
    // `payroll.commission` already includes an authorized COMMISSION_ADJ, so the
    // estimate reconciles to the report's commission total rather than to the raw
    // component total.
    commission,
    incentive,
    estimate: fixed(add(exact(commission), exact(incentive)), 2),
    lines: lines.length,
    baseAmount: total4(lines, "baseAmount"),
    units: total4(lines, "units"),
    components: statement.result.components.map((row) => ({
      key: row.componentKey,
      name: row.componentName,
      method: row.method,
      base: row.pooledBase,
      ratePct: row.ratePct,
      bandIndex: row.bandIndex,
      nextThreshold: row.nextThreshold,
      gapToNext: row.gapToNext,
      amount: row.amount,
      capped: row.capped,
    })),
  };
}

export interface PayrollProgressOptions {
  /** `SALON` is a management read; `SELF` is one staff member's own line. */
  scope: "SALON" | "SELF";
  /** The staff row a self-service read may see. Ignored for a salon-wide read. */
  staffId?: string | null;
  /** Plan names resolved in the same transaction; an unknown id stays null. */
  planNames?: ReadonlyMap<string, string>;
}

/**
 * Month-to-date progress for one period.
 *
 * `estimated` is true until approval, and `basis` says why: a stored calculation is an
 * `ESTIMATED` month, while a month nobody has calculated yet is `NOT_CALCULATED` and
 * reports no rows at all rather than inventing a zero that would look like a figure.
 */
export function payrollProgressView(
  state: PayrollCloseState,
  options: PayrollProgressOptions,
): PayrollProgressView {
  const calculation = state.calculation;
  const visible = (calculation?.statements ?? []).filter(
    (statement) => options.scope === "SALON" || statement.staff.id === options.staffId,
  );
  const rows = visible.map((statement) =>
    payrollProgressRow(
      statement,
      statement.result.planId ? (options.planNames?.get(statement.result.planId) ?? null) : null,
    ),
  );
  const money = (field: "commission" | "incentive" | "estimate") =>
    fixed(sum(rows.map((row) => exact(row[field]))), 2);
  return {
    periodKey: state.periodKey,
    status: state.status,
    estimated: state.status !== "APPROVED",
    basis: state.status === "APPROVED" ? "APPROVED" : calculation ? "ESTIMATED" : "NOT_CALCULATED",
    scope: options.scope,
    calculation: calculation
      ? {
          version: calculation.version,
          inputHash: calculation.inputHash,
          calculatedAt: calculation.calculatedAt,
        }
      : null,
    approval: state.approval ? { at: state.approval.at } : null,
    currency: calculation?.inputs.currency ?? null,
    timeZone: calculation?.inputs.timeZone ?? null,
    startsAt: calculation?.inputs.startsAt ?? null,
    endsAt: calculation?.inputs.endsAt ?? null,
    rows,
    totals: {
      staff: rows.length,
      lines: rows.reduce((count, row) => count + row.lines, 0),
      baseAmount: fixed(sum(rows.map((row) => exact(row.baseAmount))), 4),
      units: fixed(sum(rows.map((row) => exact(row.units))), 4),
      commission: money("commission"),
      incentive: money("incentive"),
      estimate: money("estimate"),
    },
  };
}

/**
 * One approved month as that staff member may read it.
 *
 * Returns `null` for a month that is not an approved snapshot or that does not contain
 * this staff member: self-service lists frozen statements only, exactly like the
 * single-statement read, so a draft never looks like a payslip.
 */
export function ownPayrollStatement(
  state: PayrollCloseState,
  staffId: string,
): PayrollOwnStatement | null {
  const calculation = state.calculation;
  if (state.status !== "APPROVED" || !calculation || !state.approval) return null;
  const statement = calculation.statements.find((row) => row.staff.id === staffId);
  if (!statement) return null;
  const lines = statement.inputs.calculation.lines;
  return {
    periodKey: state.periodKey,
    status: "APPROVED",
    approvedAt: state.approval.at,
    paidAt: state.payout?.at ?? null,
    calculation: {
      version: calculation.version,
      inputHash: calculation.inputHash,
      calculatedAt: calculation.calculatedAt,
    },
    commission: statement.payroll.commission,
    incentive: statement.payroll.incentive,
    collection: statement.payroll.collection,
    lines: lines.length,
    baseAmount: total4(lines, "baseAmount"),
    units: total4(lines, "units"),
  };
}
