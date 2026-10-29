import { z } from "zod";
import { payrollDecimalSchema } from "./contracts.js";
import { type PayrollStaffPeriodInput } from "./period.js";
import { calculateScopedPayrollStaffPeriod } from "./scoped-period.js";
import { payrollProfileSchema } from "./settings.js";
import { add, cmp, div, exact, fixed, mul, neg, sum, ZERO } from "./decimal.js";

const id = z.string().trim().min(1).max(128);
export const payrollAdjustmentSchema = z
  .strictObject({
    id,
    staffId: id,
    kind: z.enum(["UNPAID_LEAVE", "OVERTIME", "ADDITION", "DEDUCTION", "COMMISSION_ADJ"]),
    amount: z.string().regex(/^-?(0|[1-9]\d{0,11})\.\d{2}$/),
    reason: z.string().trim().min(3).max(1000),
    actorId: id,
  })
  .superRefine((value, context) => {
    if (value.kind !== "COMMISSION_ADJ" && value.amount.startsWith("-"))
      context.addIssue({ code: "custom", message: "Only commission adjustments may be negative." });
  });
export type PayrollAdjustment = z.infer<typeof payrollAdjustmentSchema>;

/** Complete calculation inputs are retained, not re-resolved when an approved statement is read. */
export interface PayrollStatementInput {
  staff: { id: string; name: string; disabled: boolean };
  calculation: PayrollStaffPeriodInput;
  profile: z.infer<typeof payrollProfileSchema>;
  profileRevision: number;
  adjustments: PayrollAdjustment[];
  /** Actual, source-evidenced external net collection. Never a redemption or FOC base. */
  collection: string;
}

export function assemblePayrollStatement(raw: PayrollStatementInput) {
  const staff = z
    .strictObject({ id, name: z.string().min(1), disabled: z.boolean() })
    .parse(raw.staff);
  if (staff.id !== raw.calculation.staffId)
    throw new Error("Statement staff does not match calculation.");
  const profile = payrollProfileSchema.parse(raw.profile);
  const profileRevision = z.number().int().nonnegative().parse(raw.profileRevision);
  const adjustments = payrollAdjustmentSchema.array().parse(raw.adjustments);
  if (new Set(adjustments.map((row) => row.id)).size !== adjustments.length)
    throw new Error("Adjustment IDs must be unique.");
  if (adjustments.some((row) => row.staffId !== staff.id))
    throw new Error("Statement contains another staff member's adjustment.");
  const result = calculateScopedPayrollStaffPeriod(raw.calculation);
  const total = (kind: PayrollAdjustment["kind"]) =>
    sum(adjustments.filter((row) => row.kind === kind).map((row) => exact(row.amount)));
  // Round salary components independently, so displayed statement lines reconcile to the cent.
  const basicSalary = fixed(exact(profile.basicSalary), 2);
  const fixedOvertime = fixed(exact(profile.fixedOvertime), 2);
  const levy = fixed(exact(profile.levy), 2);
  const commission = fixed(add(exact(result.commissionTotal), total("COMMISSION_ADJ")), 2);
  const takeHome = sum([
    exact(basicSalary),
    exact(fixedOvertime),
    exact(commission),
    exact(result.incentiveTotal),
    total("OVERTIME"),
    total("ADDITION"),
    neg(total("UNPAID_LEAVE")),
    neg(total("DEDUCTION")),
  ]);
  const collection = exact(payrollDecimalSchema.parse(raw.collection));
  const ratio =
    cmp(collection, ZERO) > 0
      ? mul(div(add(takeHome, exact(levy)), collection), exact("100"))
      : null;
  return structuredClone({
    staff,
    inputs: { ...raw, staff, profile, profileRevision, adjustments },
    result,
    payroll: {
      basicSalary,
      fixedOvertime,
      levy,
      unpaidLeave: fixed(total("UNPAID_LEAVE"), 2),
      commission,
      incentive: result.incentiveTotal,
      overtime: fixed(total("OVERTIME"), 2),
      additions: fixed(total("ADDITION"), 2),
      deductions: fixed(total("DEDUCTION"), 2),
      takeHome: fixed(takeHome, 2),
      collection: fixed(collection, 4),
      payrollSalesPct: ratio === null ? null : fixed(ratio, 2),
      alert: ratio !== null && cmp(ratio, exact(profile.salesAlertPct)) > 0,
    },
  });
}

export type PayrollStatement = ReturnType<typeof assemblePayrollStatement>;
