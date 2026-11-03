import {
  payrollImpactTotal,
  payrollImpactTotals,
  previewScopedPayrollImpact,
  type PayrollPlanDefinition,
} from "@glampro_suite/shared";
import { HttpError } from "../lib/http-error.js";
import { verifiedPayrollClose, type PayrollCloseTransaction } from "./payroll-close-store.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import {
  PAYROLL_CALCULATION_VERSION,
  openPayrollClose,
  payrollInputHash,
  type PayrollCloseInputs,
} from "./payroll-close-state.js";

const REFUSAL = "Authoritative payroll inputs unavailable: ";

/** The authoritative loader refuses with a 409 naming every evidence gate it could
 * not clear. Only that refusal becomes a readiness blocker; anything else is a real
 * failure and must surface instead of being reported as missing money. */
export function payrollInputRefusalCodes(error: unknown): string[] | null {
  if (!(error instanceof HttpError) || error.statusCode !== 409) return null;
  if (!error.message.startsWith(REFUSAL) || !error.message.endsWith(".")) return null;
  const codes = error.message
    .slice(REFUSAL.length, -1)
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  if (!codes.length) return null;
  return [...new Set(codes)].sort();
}

export interface PayrollHistoricalVersion {
  id: string;
  versionNo: number;
  status: string;
  effectiveFrom: string;
  definition: PayrollPlanDefinition;
}

export interface PayrollHistoricalStaff {
  staffId: string;
  staffName: string;
  disabled: boolean;
  version: { id: string; versionNo: number };
}

/** A frozen calculation is the month's authoritative record once it exists; a
 * source reload could disagree with an approved statement. */
export async function readPayrollHistoricalInputs(
  tx: PayrollCloseTransaction,
  periodKey: string,
): Promise<{
  inputs: PayrollCloseInputs | null;
  /** Hash of the snapshot the money came from: the frozen close hash, or the hash
   * the next calculation of this month would freeze. */
  inputHash: string | null;
  source: "FROZEN_CLOSE" | "AUTHORITATIVE_LOADER" | null;
  blockers: string[];
}> {
  const stored = await verifiedPayrollClose(tx, periodKey);
  if (stored?.state.calculation)
    return {
      inputs: stored.state.calculation.inputs,
      inputHash: stored.state.calculation.inputHash,
      source: "FROZEN_CLOSE",
      blockers: [],
    };
  try {
    const inputs = await loadAuthoritativePayrollCloseInputs(
      tx,
      stored?.state ?? openPayrollClose(periodKey),
    );
    return {
      inputs,
      inputHash: payrollInputHash({ version: PAYROLL_CALCULATION_VERSION, inputs }),
      source: "AUTHORITATIVE_LOADER",
      blockers: [],
    };
  } catch (error) {
    const codes = payrollInputRefusalCodes(error);
    if (!codes) throw error;
    return { inputs: null, inputHash: null, source: null, blockers: codes };
  }
}

/** Pure composition: authoritative month inputs in, exact money out. Only staff
 * resolved to `planId` are compared, so another plan's staff never appear. */
export function resolvePayrollHistoricalImpact(input: {
  planId: string;
  inputs: PayrollCloseInputs;
  inputHash: string;
  afterVersion: PayrollHistoricalVersion;
  staff: PayrollHistoricalStaff[];
}) {
  const statements = input.inputs.staff
    .filter((row) => row.calculation.plan?.planId === input.planId)
    .sort((left, right) => left.staff.id.localeCompare(right.staff.id));
  const preview = previewScopedPayrollImpact(
    statements.map((row) => row.calculation),
    input.afterVersion.definition,
  );
  const configuration = new Map(input.staff.map((row) => [row.staffId, row]));
  const rows = preview.rows.map((row, index) => {
    const statement = statements[index];
    const plan = statement.calculation.plan!;
    const resolved = configuration.get(row.staffId);
    return {
      staffId: row.staffId,
      staffName: resolved?.staffName ?? statement.staff.name,
      disabled: statement.staff.disabled,
      assignedVersion: {
        id: plan.versionId,
        versionNo: resolved?.version.id === plan.versionId ? resolved.version.versionNo : null,
      },
      before: row.before,
      after: row.after,
      beforeTotal: payrollImpactTotal(row.before),
      afterTotal: payrollImpactTotal(row.after),
      change: row.change,
    };
  });
  return {
    currency: input.inputs.currency,
    calculationVersion: PAYROLL_CALCULATION_VERSION,
    /** Which authoritative snapshot produced this money: the frozen close reuses the
     * hash of its own calculation, a live load matches the next calculation. */
    inputHash: input.inputHash,
    afterVersion: {
      id: input.afterVersion.id,
      versionNo: input.afterVersion.versionNo,
      status: input.afterVersion.status,
      effectiveFrom: input.afterVersion.effectiveFrom,
    },
    rows,
    /** Staff on the plan with no authoritative activity this month: no statement,
     * and no invented zero statement either. */
    staffWithoutActivity: input.staff
      .filter((row) => !rows.some((line) => line.staffId === row.staffId))
      .sort((left, right) => left.staffId.localeCompare(right.staffId))
      .map(({ staffId, staffName, disabled }) => ({ staffId, staffName, disabled })),
    totals: payrollImpactTotals(preview.rows),
  };
}
