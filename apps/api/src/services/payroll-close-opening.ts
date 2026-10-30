import { z } from "zod";
import { payrollDecimalSchema, payrollPeriodKeySchema } from "@glampro_suite/shared";
import { salonDayBounds } from "../lib/wall-clock.js";
import { payrollInputHash } from "./payroll-close-state.js";

const id = z.string().trim().min(1).max(128);
const nonpositive = payrollDecimalSchema.refine(
  (value) => !/[1-9]/.test(value) || value.startsWith("-"),
);
export const payrollOpeningCarrySchema = z.object({
  id,
  tenantId: id,
  periodKey: payrollPeriodKeySchema,
  timeZone: id,
  effectiveAt: z.iso.datetime(),
  revision: z.number().int().safe().positive(),
  /** Trusted loader must independently establish first-close eligibility and
   * complete opening debt inventory. These assertions are not authentication. */
  firstClose: z.literal(true),
  completeInventory: z.literal(true),
  approval: z.object({
    actorId: id,
    at: z.iso.datetime(),
    reason: z.string().trim().min(3).max(1000),
  }),
  evidence: z.unknown().refine((value) => value !== null && value !== undefined),
  staff: z.array(
    z.object({
      staffId: id,
      carryForward: z.array(z.object({ componentKey: id, base: nonpositive, units: nonpositive })),
      fallbackCarryCommission: z
        .string()
        .regex(/^-?(0|[1-9]\d{0,23})\.\d{10}$/)
        .refine((value) => !/[1-9]/.test(value) || value.startsWith("-")),
    }),
  ),
});
export type PayrollOpeningCarry = z.input<typeof payrollOpeningCarrySchema>;

/** Supplied cutover evidence only. Never creates balances or authorizes cutover.
 * Approval must precede the first month's boundary; later changes need revisions. */
export function resolvePayrollOpeningCarry(
  raw: PayrollOpeningCarry,
  tenantId: string,
  periodKey: string,
) {
  const opening = payrollOpeningCarrySchema.parse(raw);
  if (opening.tenantId !== tenantId)
    throw new Error("Payroll opening carry contains another salon's records.");
  if (opening.periodKey !== periodKey) throw new Error("Payroll opening carry month mismatch.");
  const boundary = salonDayBounds(`${periodKey}-01`, opening.timeZone).from;
  if (
    new Date(opening.effectiveAt).getTime() !== boundary.getTime() ||
    new Date(opening.approval.at) > boundary
  )
    throw new Error(
      "Payroll opening carry must be approved by its salon-local effective boundary.",
    );
  if (
    new Set(opening.staff.map((row) => row.staffId)).size !== opening.staff.length ||
    opening.staff.some(
      (row) =>
        new Set(row.carryForward.map((part) => part.componentKey)).size !== row.carryForward.length,
    )
  )
    throw new Error("Duplicate payroll opening carry staff or components.");
  const snapshot = {
    ...opening,
    staff: opening.staff
      .map((row) => ({
        ...row,
        carryForward: [...row.carryForward].sort((a, b) =>
          a.componentKey.localeCompare(b.componentKey),
        ),
      }))
      .sort((a, b) => a.staffId.localeCompare(b.staffId)),
  };
  payrollInputHash(snapshot);
  return structuredClone(snapshot);
}
