/**
 * CP-006 progress and self-service contracts — FR-RPT-04, FR-RPT-05 and FR-POS-09.
 *
 * Two read models live here:
 *
 * - **Month-to-date progress** (`payrollProgressViewSchema`): the per-staff plan,
 *   stage, base, current band rate and distance to the next band. It is a
 *   projection of a stored payroll *calculation snapshot*, so an unapproved month
 *   is an **estimate** and the contract says so (`estimated`, `basis`,
 *   `calculation.calculatedAt`) instead of letting a screen imply a final figure.
 *   When the month is approved the same numbers are the frozen ones the period
 *   report and the exports use, which is what "reconciles to the same inputs and
 *   rules" means in practice.
 * - **Own frozen statements** (`payrollOwnStatementsSchema`): the calling staff
 *   member's own approved months only. Salary, take-home and every other person's
 *   statement are deliberately absent, because the salary boundary belongs to the
 *   owner-only exports.
 *
 * Money stays a **string on the wire**, like every other payroll contract: a JSON
 * float has already lost the cent the till just charged. Both schemas are
 * `.strictObject()`, so a projection that grew a salary field would fail to parse
 * rather than quietly shipping it to a browser.
 */
import { z } from "zod";

import {
  payrollCalcMethodSchema,
  payrollCommissionTypeSchema,
  payrollDecimalSchema,
  payrollPeriodKeySchema,
} from "../commission-payroll/contracts.js";

const key = z.string().trim().min(1).max(128);
const instant = z.iso.datetime();

/**
 * `GET /api/payroll-close/progress` — omitted `period` means the current salon month.
 *
 * `scope=SELF` asks for the caller's own line, which is what Settings → My earnings
 * reads: an owner or manager holds a commission statement too, so the salon table is
 * not an acceptable answer under a "Your …" heading. The flag can only **narrow** — a
 * `STAFF` or outlet-scoped caller is narrowed whatever they send, and `SALON` is
 * refused rather than honoured — so no request can widen a self-service read. Omitting
 * it keeps the role-based default every existing caller relies on.
 */
export const payrollProgressQuerySchema = z.strictObject({
  period: payrollPeriodKeySchema.optional(),
  scope: z.literal("SELF").optional(),
});
export type PayrollProgressQuery = z.infer<typeof payrollProgressQuerySchema>;

/**
 * How the figures were obtained. `ESTIMATED` is a calculated but unapproved month:
 * the numbers are the engine's, but more postings may still arrive.
 */
export const payrollProgressBasisSchema = z.enum(["APPROVED", "ESTIMATED", "NOT_CALCULATED"]);

/** Which rows the caller was allowed to see: the whole salon or their own line. */
export const payrollProgressScopeSchema = z.enum(["SALON", "SELF"]);

/** One commission component, including the band the base currently sits in. */
export const payrollProgressComponentSchema = z.strictObject({
  key,
  name: key,
  method: payrollCalcMethodSchema,
  /** Pooled base after splits and carry, the figure the band is read from. */
  base: payrollDecimalSchema,
  ratePct: payrollDecimalSchema.nullable(),
  bandIndex: z.number().int().nonnegative().nullable(),
  nextThreshold: payrollDecimalSchema.nullable(),
  gapToNext: payrollDecimalSchema.nullable(),
  amount: payrollDecimalSchema,
  capped: z.boolean(),
});
export type PayrollProgressComponent = z.infer<typeof payrollProgressComponentSchema>;

export const payrollProgressRowSchema = z.strictObject({
  staff: z.strictObject({ id: key, name: z.string().min(1), disabled: z.boolean() }),
  /** Null when the statement used the flat fallback rules rather than a plan. */
  planId: key.nullable(),
  planName: key.nullable(),
  stageKey: key,
  stageName: key,
  tenureMonth: z.number().int().positive().nullable(),
  /** The tier component the seller is banded in, or null for a flat statement. */
  mainComponent: key.nullable(),
  mainBase: payrollDecimalSchema,
  currentRate: payrollDecimalSchema.nullable(),
  nextThreshold: payrollDecimalSchema.nullable(),
  gapToNext: payrollDecimalSchema.nullable(),
  /** Frozen statement money for the month, including any authorized commission adjustment. */
  commission: payrollDecimalSchema,
  incentive: payrollDecimalSchema,
  estimate: payrollDecimalSchema,
  lines: z.number().int().nonnegative(),
  baseAmount: payrollDecimalSchema,
  units: payrollDecimalSchema,
  components: z.array(payrollProgressComponentSchema),
  /** Base activity by type, not an invented allocation of pooled commission. */
  activity: z
    .array(
      z.object({
        commissionType: payrollCommissionTypeSchema,
        baseAmount: payrollDecimalSchema,
        units: payrollDecimalSchema,
      }),
    )
    .optional(),
});
export type PayrollProgressRow = z.infer<typeof payrollProgressRowSchema>;

export const payrollProgressViewSchema = z.strictObject({
  periodKey: payrollPeriodKeySchema,
  status: z.enum(["OPEN", "CALCULATED", "APPROVED"]),
  /** True until the month is approved; the UI must label the figures as estimates. */
  estimated: z.boolean(),
  basis: payrollProgressBasisSchema,
  scope: payrollProgressScopeSchema,
  calculation: z.strictObject({ version: key, inputHash: key, calculatedAt: instant }).nullable(),
  approval: z.strictObject({ at: instant }).nullable(),
  currency: z.literal("SGD").nullable(),
  timeZone: z.string().min(1).nullable(),
  startsAt: instant.nullable(),
  endsAt: instant.nullable(),
  rows: z.array(payrollProgressRowSchema),
  totals: z.strictObject({
    staff: z.number().int().nonnegative(),
    lines: z.number().int().nonnegative(),
    baseAmount: payrollDecimalSchema,
    units: payrollDecimalSchema,
    commission: payrollDecimalSchema,
    incentive: payrollDecimalSchema,
    estimate: payrollDecimalSchema,
  }),
});
export type PayrollProgressView = z.infer<typeof payrollProgressViewSchema>;

/** `GET /api/payroll-close/statements` — a bounded page of the caller's own frozen months. */
export const payrollStatementHistoryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(36).default(12),
});
export type PayrollStatementHistoryQuery = z.infer<typeof payrollStatementHistoryQuerySchema>;

/** One approved month for the caller. No salary, no take-home, no other staff. */
export const payrollOwnStatementSchema = z.strictObject({
  periodKey: payrollPeriodKeySchema,
  status: z.literal("APPROVED"),
  approvedAt: instant,
  /** When the salon recorded the actual payout, or null while it is still pending. */
  paidAt: instant.nullable(),
  calculation: z.strictObject({ version: key, inputHash: key, calculatedAt: instant }),
  commission: payrollDecimalSchema,
  incentive: payrollDecimalSchema,
  collection: payrollDecimalSchema,
  lines: z.number().int().nonnegative(),
  baseAmount: payrollDecimalSchema,
  units: payrollDecimalSchema,
});
export type PayrollOwnStatement = z.infer<typeof payrollOwnStatementSchema>;

export const payrollOwnStatementsSchema = z.strictObject({
  statements: z.array(payrollOwnStatementSchema),
  limit: z.number().int().positive(),
  /** True when older frozen months exist beyond `limit`. */
  hasMore: z.boolean(),
});
export type PayrollOwnStatements = z.infer<typeof payrollOwnStatementsSchema>;
