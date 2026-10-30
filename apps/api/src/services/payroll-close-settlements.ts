import { z } from "zod";
import { payrollPeriodKeySchema, type PayrollCarryBalance } from "@glampro_suite/shared";
import { payrollInputHash } from "./payroll-close-state.js";

const id = z.string().trim().min(1).max(128);
export const payrollCarrySettlementSchema = z.object({
  id,
  tenantId: id,
  periodKey: payrollPeriodKeySchema,
  staffId: id,
  revision: z.number().int().safe().positive(),
  /** Hash of the exact preceding resolved staff carry record. */
  balanceHash: z.string().regex(/^[0-9a-f]{64}$/),
  approval: z.object({
    actorId: id,
    at: z.iso.datetime(),
    reason: z.string().trim().min(3).max(1000),
  }),
  evidence: z.unknown().refine((value) => value !== null && value !== undefined),
  components: z.array(
    z.object({ fromKey: id, toKey: id.nullable(), reason: z.string().trim().min(3).max(1000) }),
  ),
  /** Only an explicitly audited write-off is supported here. Actual cash debt
   * repayment requires independent settlement evidence, not a commission adjustment. */
  fallbackWriteOff: z
    .object({ amount: z.string().regex(/^-(0|[1-9]\d{0,23})\.\d{10}$/) })
    .nullable(),
});
export type PayrollCarrySettlement = z.input<typeof payrollCarrySettlementSchema>;
interface CarryStaff {
  staffId: string;
  carryForward: PayrollCarryBalance[];
  fallbackCarryCommission: string;
}

/** Supplied authorization evidence only, never an owner permission boundary.
 * The authoritative loader must authenticate approval and historical balances. */
export function resolvePayrollCarrySettlements(
  raw: PayrollCarrySettlement[],
  tenantId: string,
  periodKey: string,
  staff: CarryStaff[],
) {
  const records = z
    .array(payrollCarrySettlementSchema)
    .parse(raw)
    .sort((a, b) => a.staffId.localeCompare(b.staffId));
  if (
    new Set(records.map((row) => row.id)).size !== records.length ||
    new Set(records.map((row) => row.staffId)).size !== records.length
  )
    throw new Error("Duplicate payroll carry settlement.");
  for (const record of records) {
    if (record.tenantId !== tenantId || record.periodKey !== periodKey)
      throw new Error("Payroll carry settlement scope mismatch.");
    const balance = staff.find((row) => row.staffId === record.staffId);
    if (!balance || payrollInputHash(balance) !== record.balanceHash)
      throw new Error("Payroll carry settlement balance changed.");
    if (!record.components.length && !record.fallbackWriteOff)
      throw new Error("Payroll carry settlement has no action.");
    if (
      new Set(record.components.map((row) => row.fromKey)).size !== record.components.length ||
      record.components.some(
        (row) => !balance.carryForward.some((part) => part.componentKey === row.fromKey),
      )
    )
      throw new Error("Payroll carry settlement component mismatch.");
    if (
      record.fallbackWriteOff &&
      (record.fallbackWriteOff.amount !== balance.fallbackCarryCommission ||
        !/[1-9]/.test(record.fallbackWriteOff.amount))
    )
      throw new Error("Payroll fallback settlement must write off the exact nonzero debt.");
    record.components.sort((a, b) => a.fromKey.localeCompare(b.fromKey));
  }
  payrollInputHash(records);
  return structuredClone(records);
}
