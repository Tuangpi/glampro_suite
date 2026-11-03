import { payrollPlanDefinitionSchema, type PayrollPlanDefinition } from "./contracts.js";
import { add, exact, fixed, neg, sum } from "./decimal.js";
import {
  calculatePayrollStaffPeriod,
  type PayrollStaffPeriodInput,
  type PayrollStaffPeriodResult,
} from "./period.js";
import { calculateScopedPayrollStaffPeriod } from "./scoped-period.js";

/** Commission plus incentive for one engine result, rounded once to the cent. */
export function payrollImpactTotal(result: PayrollStaffPeriodResult) {
  return fixed(add(exact(result.commissionTotal), exact(result.incentiveTotal)), 2);
}

/**
 * One calculator for preview and posted money. A preview row must equal what the
 * monthly close would post for the *same* authoritative input, so this swaps only
 * the plan definition: bases, carry, group metrics and stage evidence are never
 * re-derived here.
 */
export function previewPayrollImpactWith(
  inputs: PayrollStaffPeriodInput[],
  definition: PayrollPlanDefinition,
  calculate: (input: PayrollStaffPeriodInput) => PayrollStaffPeriodResult,
) {
  const draft = payrollPlanDefinitionSchema.parse(definition);
  const rows = inputs.map((input) => {
    if (!input.plan) throw new Error("Impact preview requires an assigned plan.");
    const before = calculate(input);
    const after = calculate({ ...input, plan: { ...input.plan, definition: draft } });
    const total = (result: PayrollStaffPeriodResult) =>
      add(exact(result.commissionTotal), exact(result.incentiveTotal));
    return {
      staffId: input.staffId,
      before,
      after,
      change: fixed(add(total(after), neg(total(before))), 2),
    };
  });
  return {
    rows,
    totalChange: fixed(sum(rows.map((row) => exact(row.change))), 2),
  };
}

/** Plan-scale preview; rejects unpartitioned outlet activity like a plan run does. */
export function previewPayrollImpact(
  inputs: PayrollStaffPeriodInput[],
  definition: PayrollPlanDefinition,
) {
  return previewPayrollImpactWith(inputs, definition, calculatePayrollStaffPeriod);
}

/** Statement-scale preview: outlet partitioning and source-time fallback debt apply,
 * so the result matches a calculated month rather than an unpartitioned plan run. */
export function previewScopedPayrollImpact(
  inputs: PayrollStaffPeriodInput[],
  definition: PayrollPlanDefinition,
) {
  return previewPayrollImpactWith(inputs, definition, calculateScopedPayrollStaffPeriod);
}

/** Exact salon totals for preview rows; each column is summed before it is rounded. */
export function payrollImpactTotals(
  rows: { before: PayrollStaffPeriodResult; after: PayrollStaffPeriodResult; change: string }[],
) {
  return {
    before: fixed(sum(rows.map((row) => exact(payrollImpactTotal(row.before)))), 2),
    after: fixed(sum(rows.map((row) => exact(payrollImpactTotal(row.after)))), 2),
    change: fixed(sum(rows.map((row) => exact(row.change))), 2),
  };
}
