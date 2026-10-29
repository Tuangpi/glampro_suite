import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assemblePayrollStatement,
  payrollAdjustmentSchema,
  payrollPeriodKeySchema,
  type PayrollAdjustment,
  type PayrollStatement,
  type PayrollStatementInput,
} from "@glampro_suite/shared";
import { conflict, forbidden } from "../lib/http-error.js";
import { salonDayBounds } from "../lib/wall-clock.js";

export const PAYROLL_CALCULATION_VERSION = "cp-005-v2";
export interface PayrollCloseActor {
  id: string;
  role: string;
  disabled: boolean;
  twoFactorEnabled: boolean;
}
export interface PayrollCloseInputs {
  periodKey: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  currency: "SGD";
  /** Complete source/configuration/carry/collection evidence, including record revisions. */
  evidence: unknown;
  staff: PayrollStatementInput[];
}
export interface PayrollCloseState {
  periodKey: string;
  status: "OPEN" | "CALCULATED" | "APPROVED";
  revision: number;
  adjustments: PayrollAdjustment[];
  calculation: {
    version: string;
    inputHash: string;
    inputs: PayrollCloseInputs;
    statements: PayrollStatement[];
    calculatedAt: string;
    calculatedBy: string;
  } | null;
  approval: { at: string; actorId: string; reason: string } | null;
  payout: { at: string; actorId: string; reference: string; reason: string } | null;
}

/** Stable JSON hashing rejects non-JSON evidence instead of silently dropping fields. */
export function payrollInputHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return JSON.stringify(item);
    if (typeof item === "number" && Number.isSafeInteger(item)) return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      return `{${Object.keys(item)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`)
        .join(",")}}`;
    }
    throw new Error(
      "Payroll evidence must contain only explicit JSON values and integer revisions.",
    );
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}

const reasonSchema = z.string().trim().min(3).max(1000);
function permitted(actor: PayrollCloseActor, ownerOnly = false) {
  if (
    actor.disabled ||
    !actor.id ||
    !["SUPER_ADMIN", ...(ownerOnly ? [] : ["MANAGER"])].includes(actor.role)
  )
    throw forbidden("This payroll close action is not permitted.");
  if (actor.role === "SUPER_ADMIN" && !actor.twoFactorEnabled)
    throw forbidden("Owner verification is required.");
}
function mutable(state: PayrollCloseState, expectedRevision: number) {
  if (state.revision !== expectedRevision)
    throw conflict("Payroll period changed. Reload before saving.");
  if (state.status === "APPROVED") throw conflict("Approved payroll statements are immutable.");
}
function timestamp(value: string) {
  return z.iso.datetime().parse(value);
}

export function openPayrollClose(periodKey: string): PayrollCloseState {
  return {
    periodKey: payrollPeriodKeySchema.parse(periodKey),
    status: "OPEN",
    revision: 0,
    adjustments: [],
    calculation: null,
    approval: null,
    payout: null,
  };
}

/** Append-only adjustment history survives every re-run. Changes invalidate the current draft. */
export function adjustPayrollClose(
  state: PayrollCloseState,
  expectedRevision: number,
  raw: PayrollAdjustment,
  actor: PayrollCloseActor,
): PayrollCloseState {
  permitted(actor);
  mutable(state, expectedRevision);
  const adjustment = payrollAdjustmentSchema.parse(raw);
  if (adjustment.actorId !== actor.id) throw forbidden("Adjustment actor mismatch.");
  const prior = state.adjustments.find((row) => row.id === adjustment.id);
  if (prior) {
    if (payrollInputHash(prior) !== payrollInputHash(adjustment))
      throw conflict("Adjustment retry has different evidence.");
    return structuredClone(state);
  }
  return {
    ...structuredClone(state),
    status: "OPEN",
    revision: state.revision + 1,
    calculation: null,
    adjustments: [...structuredClone(state.adjustments), adjustment],
  };
}

function resolvedInputs(state: PayrollCloseState, raw: PayrollCloseInputs) {
  if (raw.periodKey !== state.periodKey) throw conflict("Calculation period mismatch.");
  if (raw.currency !== "SGD") throw conflict("Mixed or unsupported payroll currency.");
  timestamp(raw.startsAt);
  timestamp(raw.endsAt);
  const [year, month] = raw.periodKey.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const from = salonDayBounds(`${raw.periodKey}-01`, raw.timeZone).from;
  const to = salonDayBounds(nextMonth, raw.timeZone).from;
  if (
    new Date(raw.startsAt).getTime() !== from.getTime() ||
    new Date(raw.endsAt).getTime() !== to.getTime()
  )
    throw conflict("Payroll boundaries must match the complete salon-local calendar month.");
  const ids = new Set(raw.staff.map((row) => row.staff.id));
  if (ids.size !== raw.staff.length) throw conflict("Duplicate payroll staff inputs.");
  if (state.adjustments.some((row) => !ids.has(row.staffId)))
    throw conflict("Staff with manual amounts owed must be included in payroll.");
  const staff = raw.staff.map((row) => {
    if (row.calculation.periodKey !== state.periodKey)
      throw conflict("Staff calculation month mismatch.");
    if (row.adjustments.length)
      throw conflict("Adjustments must come from the period audit, not the input loader.");
    return {
      ...row,
      adjustments: state.adjustments.filter((adjustment) => adjustment.staffId === row.staff.id),
    };
  });
  return structuredClone({ ...raw, staff });
}

/** Pure transition. The persistence adapter must hold the shared source/configuration lock. */
export function calculatePayrollClose(
  state: PayrollCloseState,
  expectedRevision: number,
  raw: PayrollCloseInputs,
  actor: PayrollCloseActor,
  at: string,
): PayrollCloseState {
  permitted(actor);
  mutable(state, expectedRevision);
  const inputs = resolvedInputs(state, raw);
  const statements = inputs.staff.map(assemblePayrollStatement);
  return {
    ...structuredClone(state),
    status: "CALCULATED",
    revision: state.revision + 1,
    calculation: {
      version: PAYROLL_CALCULATION_VERSION,
      inputHash: payrollInputHash({ version: PAYROLL_CALCULATION_VERSION, inputs }),
      inputs,
      statements,
      calculatedAt: timestamp(at),
      calculatedBy: actor.id,
    },
  };
}

export function approvePayrollClose(
  state: PayrollCloseState,
  expectedRevision: number,
  authoritativeInputs: PayrollCloseInputs,
  actor: PayrollCloseActor,
  at: string,
  reason: string,
): PayrollCloseState {
  permitted(actor, true);
  mutable(state, expectedRevision);
  if (state.status !== "CALCULATED" || !state.calculation)
    throw conflict("Calculate payroll before approval.");
  const inputs = resolvedInputs(state, authoritativeInputs);
  if (new Date(timestamp(at)) < new Date(inputs.endsAt))
    throw conflict("The salon-local calendar month must end before approval.");
  if (new Date(at) < new Date(timestamp(state.calculation.calculatedAt)))
    throw conflict("Approval cannot predate calculation.");
  const hash = payrollInputHash({ version: PAYROLL_CALCULATION_VERSION, inputs });
  if (
    state.calculation.version !== PAYROLL_CALCULATION_VERSION ||
    state.calculation.inputHash !== hash
  )
    throw conflict("Payroll inputs changed. Recalculate before approval.");
  if (
    payrollInputHash(state.calculation.inputs) !== payrollInputHash(inputs) ||
    payrollInputHash(state.calculation.statements) !==
      payrollInputHash(inputs.staff.map(assemblePayrollStatement))
  )
    throw conflict("Payroll calculation snapshot changed. Recalculate before approval.");
  return {
    ...structuredClone(state),
    status: "APPROVED",
    revision: state.revision + 1,
    approval: { at: timestamp(at), actorId: actor.id, reason: reasonSchema.parse(reason) },
  };
}

/** Approval freezes entitlement. This separate operation records an actual payout, not a provider transfer. */
export function confirmPayrollPayout(
  state: PayrollCloseState,
  expectedRevision: number,
  actor: PayrollCloseActor,
  at: string,
  reference: string,
  reason: string,
): PayrollCloseState {
  permitted(actor, true);
  if (state.revision !== expectedRevision)
    throw conflict("Payroll period changed. Reload before saving.");
  if (state.status !== "APPROVED") throw conflict("Approve payroll before recording payout.");
  if (!state.approval || new Date(timestamp(at)) < new Date(state.approval.at))
    throw conflict("Payout confirmation cannot predate approval.");
  if (state.payout) throw conflict("Payroll payout is already confirmed.");
  return {
    ...structuredClone(state),
    revision: state.revision + 1,
    payout: {
      at: timestamp(at),
      actorId: actor.id,
      reference: z.string().trim().min(1).max(128).parse(reference),
      reason: reasonSchema.parse(reason),
    },
  };
}

/** Self-service reads return one frozen statement, never another staff member's salary or raw salon inputs. */
export function readFrozenPayrollStatement(
  state: PayrollCloseState,
  staffId: string,
  actor: PayrollCloseActor,
): PayrollStatement {
  if (actor.disabled || !actor.id) throw forbidden("A current salon actor is required.");
  if (actor.id !== staffId) permitted(actor, true);
  if (state.status !== "APPROVED" || !state.calculation)
    throw conflict("Only approved statements are available through frozen statement reads.");
  const statement = state.calculation.statements.find((row) => row.staff.id === staffId);
  if (!statement) throw forbidden("No statement is available for this staff member.");
  return structuredClone(statement);
}
