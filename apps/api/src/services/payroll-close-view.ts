import {
  fixed,
  payrollAdjustmentTotal,
  payrollCommissionColumns,
  type PayrollStatement,
} from "@glampro_suite/shared";
import type { PayrollCloseState } from "./payroll-close-state.js";

/**
 * Manual commission adjustments, rendered beside the component columns so the
 * on-screen breakdown adds up to `payroll.commission` (components + adjustments).
 */
function commissionAdjustments(statement: PayrollStatement) {
  return fixed(payrollAdjustmentTotal(statement.inputs.adjustments, "COMMISSION_ADJ"), 2);
}

/** Self-service exposes earned commission, not salary profiles or take-home pay. */
export function payrollCommissionStatementView(statement: PayrollStatement) {
  return {
    staff: statement.staff,
    result: statement.result,
    commissionAdjustments: commissionAdjustments(statement),
    payroll: {
      commission: statement.payroll.commission,
      incentive: statement.payroll.incentive,
      collection: statement.payroll.collection,
    },
  };
}

/** Never serialize source/configuration input inventories to a management screen.
 * Managers calculate/adjust but cannot read salary profiles or salary-derived KPIs. */
export function payrollCloseView(state: PayrollCloseState, owner: boolean) {
  return {
    periodKey: state.periodKey,
    revision: state.revision,
    status: state.status,
    adjustments: state.adjustments,
    approval: state.approval,
    payout: state.payout,
    calculation: state.calculation
      ? {
          calculatedAt: state.calculation.calculatedAt,
          /** Period columns are plan components, readable by both roles: no salary. */
          commissionColumns: payrollCommissionColumns(
            state.calculation.statements.map((statement) => statement.result),
          ),
          statements: state.calculation.statements.map((statement) =>
            owner
              ? {
                  staff: statement.staff,
                  result: statement.result,
                  payroll: statement.payroll,
                  commissionAdjustments: commissionAdjustments(statement),
                }
              : payrollCommissionStatementView(statement),
          ),
        }
      : null,
  };
}
