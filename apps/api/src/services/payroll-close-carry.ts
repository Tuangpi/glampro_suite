import { z } from "zod";
import { payrollPeriodKeySchema } from "@glampro_suite/shared";
import { resolvePayrollOpeningCarry, type PayrollOpeningCarry } from "./payroll-close-opening.js";
import {
  calculatePayrollClose,
  openPayrollClose,
  payrollInputHash,
  type PayrollCloseState,
} from "./payroll-close-state.js";

const id = z.string().trim().min(1).max(128);
export interface PayrollCloseCarryRecords {
  tenantId: string;
  periodKey: string;
  /** Null means unavailable, never evidence that opening carry is zero. */
  previous: { id: string; tenantId: string; state: PayrollCloseState } | null;
  opening?: PayrollOpeningCarry;
}

/** Validates supplied frozen records only; grants no access and performs no DB reads.
 * Carry requires the preceding approved close or explicit audited cutover evidence. Replaying the
 * frozen inputs checks consistency, not authenticity or database immutability.
 * Supplied cutover approval is not authentication or proof of first-close eligibility.
 */
export function resolvePayrollCloseCarry(raw: PayrollCloseCarryRecords) {
  const tenantId = id.parse(raw.tenantId);
  const periodKey = payrollPeriodKeySchema.parse(raw.periodKey);
  const [year, month] = periodKey.split("-").map(Number);
  const previousPeriodKey = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const unavailable = (code: string) => ({
    status: "UNAVAILABLE" as const,
    earningsActive: false as const,
    periodKey,
    previousPeriodKey,
    blockers: [code],
    carry: null,
  });
  if (raw.opening && raw.previous) return unavailable("OPENING_PREVIOUS_CLOSE_CONFLICT");
  if (raw.opening) {
    const opening = resolvePayrollOpeningCarry(raw.opening, tenantId, periodKey);
    const staff = opening.staff;
    return structuredClone({
      status: "CARRY_EVIDENCE_READY" as const,
      earningsActive: false as const,
      periodKey,
      previousPeriodKey,
      blockers: [],
      carry: {
        previousCloseId: null,
        previousCloseRevision: null,
        approval: opening.approval,
        calculation: null,
        opening,
        staff,
        requiredStaffIds: staff
          .filter(
            (row) =>
              row.carryForward.some((part) => /[1-9]/.test(part.base + part.units)) ||
              /[1-9]/.test(row.fallbackCarryCommission),
          )
          .map((row) => row.staffId),
      },
    });
  }
  if (!raw.previous) return unavailable("APPROVED_PREVIOUS_CLOSE_UNAVAILABLE");
  if (raw.previous.tenantId !== tenantId)
    throw new Error("Payroll carry contains another salon's close.");
  id.parse(raw.previous.id);
  const state = raw.previous.state;
  if (state.periodKey !== previousPeriodKey) return unavailable("PREVIOUS_CLOSE_MONTH_MISMATCH");
  if (state.status !== "APPROVED" || !state.approval || !state.calculation)
    return unavailable("PREVIOUS_CLOSE_NOT_APPROVED");
  try {
    z.number().int().safe().min(2).parse(state.revision);
    id.parse(state.approval.actorId);
    z.string().trim().min(3).max(1000).parse(state.approval.reason);
    const approvedAt = z.iso.datetime().parse(state.approval.at);
    const calculatedAt = z.iso.datetime().parse(state.calculation.calculatedAt);
    id.parse(state.calculation.calculatedBy);
    if (
      new Date(approvedAt) < new Date(state.calculation.inputs.endsAt) ||
      new Date(approvedAt) < new Date(calculatedAt)
    )
      return unavailable("PREVIOUS_CLOSE_SNAPSHOT_INVALID");
    // Draft input loaders do not supply adjustments; replay from the stored period audit.
    const inputs = structuredClone(state.calculation.inputs);
    inputs.staff = inputs.staff.map((row) => ({ ...row, adjustments: [] }));
    const replay = calculatePayrollClose(
      { ...openPayrollClose(previousPeriodKey), adjustments: structuredClone(state.adjustments) },
      0,
      inputs,
      {
        id: state.calculation.calculatedBy,
        role: "MANAGER",
        disabled: false,
        twoFactorEnabled: false,
      },
      calculatedAt,
    ).calculation!;
    if (
      replay.version !== state.calculation.version ||
      replay.inputHash !== state.calculation.inputHash ||
      payrollInputHash(replay.inputs) !== payrollInputHash(state.calculation.inputs) ||
      payrollInputHash(replay.statements) !== payrollInputHash(state.calculation.statements)
    )
      return unavailable("PREVIOUS_CLOSE_SNAPSHOT_INVALID");
    const staff = replay.statements
      .map((statement) => ({
        staffId: statement.staff.id,
        carryForward: statement.result.carryForward,
        fallbackCarryCommission: statement.result.fallbackCarryCommission,
      }))
      .sort((a, b) => a.staffId.localeCompare(b.staffId));
    return structuredClone({
      status: "CARRY_EVIDENCE_READY" as const,
      earningsActive: false as const,
      periodKey,
      previousPeriodKey,
      blockers: [],
      carry: {
        previousCloseId: raw.previous.id,
        previousCloseRevision: state.revision,
        approval: state.approval,
        calculation: state.calculation,
        opening: null,
        staff,
        requiredStaffIds: staff
          .filter((row) => row.carryForward.length > 0 || /^-/.test(row.fallbackCarryCommission))
          .map((row) => row.staffId),
      },
    });
  } catch {
    return unavailable("PREVIOUS_CLOSE_SNAPSHOT_INVALID");
  }
}
