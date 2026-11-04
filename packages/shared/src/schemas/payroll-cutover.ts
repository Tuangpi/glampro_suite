/**
 * CP-007 prospective migration contracts — FR-SET-07 and NFR-03 completion evidence.
 *
 * The cutover is **prospective by construction**:
 *
 * - `payrollCutoverInventorySchema` is a **read-only classification** of the money
 *   already recorded by the legacy commission ledger for a window of salon months,
 *   next to the plan payroll status of those same months. It classifies evidence
 *   (`RELIABLE` / `INCOMPLETE` / `ALREADY_PAID`) and lists `BLOCKER`/`WARNING`
 *   issues; it never rewrites a legacy row and never invents an earning.
 * - `payrollCutoverStateSchema` carries the frozen activation record and its
 *   append-only history. The activation month is the first month plan payroll is
 *   the payroll of record; nothing before it changes, because a closed month is
 *   history, not a draft.
 *
 * `inventoryHash` is the attestation: activation must quote the hash of the exact
 * inventory the owner reviewed, so an inventory that moved in between is refused
 * instead of silently covered. Money stays a **string on the wire** and every
 * object is `.strictObject()`, so a projection that grew a payroll input field
 * would fail to parse rather than quietly shipping it to a browser.
 */
import { z } from "zod";

import { payrollDecimalSchema, payrollPeriodKeySchema } from "../commission-payroll/contracts.js";

const key = z.string().trim().min(1).max(128);
const instant = z.iso.datetime();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative();
const reason = z.string().trim().min(3).max(1000);

/** `NOT_ACTIVATED` is the absence of a row, not a stored status. */
export const payrollCutoverStatusSchema = z.enum(["NOT_ACTIVATED", "ACTIVE", "ROLLED_BACK"]);
export type PayrollCutoverStatus = z.infer<typeof payrollCutoverStatusSchema>;

/**
 * How complete the legacy evidence for one month is.
 *
 * `ALREADY_PAID` means legacy money left for that month; `INCOMPLETE` means a row
 * cannot be traced to a sale or a clawback is outstanding; `RELIABLE` means every
 * recorded row is traceable (unpaid traceable rows are simply superseded by plan
 * payroll, which re-derives the same sale from its own inputs).
 */
export const payrollCutoverVerdictSchema = z.enum(["RELIABLE", "INCOMPLETE", "ALREADY_PAID"]);
export type PayrollCutoverVerdict = z.infer<typeof payrollCutoverVerdictSchema>;

/**
 * Why a month is flagged. `BLOCKER` refuses activation; `WARNING` is frozen into
 * the attested inventory and therefore acknowledged by the activating owner.
 */
export const payrollCutoverIssueCodeSchema = z.enum([
  "EFFECTIVE_PERIOD_PRECEDES_CURRENT_MONTH",
  "LEGACY_PAYOUT_INSIDE_COVERED_MONTH",
  "LEGACY_EARNING_WITHOUT_SOURCE",
  "LEGACY_WITHOUT_SALE",
  "LEGACY_CLAWBACK_OUTSTANDING",
  "LEGACY_EARNING_SUPERSEDED",
  "PAYROLL_APPROVED_AT_OR_AFTER_ROLLBACK_MONTH",
  "INVENTORY_CHANGED_SINCE_REVIEW",
]);
export type PayrollCutoverIssueCode = z.infer<typeof payrollCutoverIssueCodeSchema>;

export const payrollCutoverIssueSchema = z.strictObject({
  code: payrollCutoverIssueCodeSchema,
  severity: z.enum(["BLOCKER", "WARNING"]),
  periodKey: payrollPeriodKeySchema,
  /** Present when the issue is confined to one staff member's evidence. */
  staffId: key.nullable(),
  rows: count,
  amount: payrollDecimalSchema,
});
export type PayrollCutoverIssue = z.infer<typeof payrollCutoverIssueSchema>;

const bucketSchema = z.strictObject({ rows: count, amount: payrollDecimalSchema });
export type PayrollCutoverBucket = z.infer<typeof bucketSchema>;

/** One salon month of legacy evidence next to its plan payroll status. */
export const payrollCutoverMonthSchema = z.strictObject({
  periodKey: payrollPeriodKeySchema,
  verdict: payrollCutoverVerdictSchema,
  /** The month is at or after the effective (or proposed) month. */
  covered: z.boolean(),
  legacy: z.strictObject({
    total: bucketSchema,
    paid: bucketSchema,
    unpaid: bucketSchema,
    /** `reconciliationRequired` rows: an unsettled refund clawback. */
    clawback: bucketSchema,
    /** Rows with no `saleId`, so their source sale cannot be verified. */
    unidentified: bucketSchema,
  }),
  payroll: z.strictObject({
    status: z.enum(["OPEN", "CALCULATED", "APPROVED"]).nullable(),
    payoutConfirmed: z.boolean(),
  }),
});
export type PayrollCutoverMonth = z.infer<typeof payrollCutoverMonthSchema>;

/** `GET /api/payroll-cutover/inventory` — the reviewed, hash-attested window. */
export const payrollCutoverInventorySchema = z.strictObject({
  timeZone: z.string().trim().min(1).max(64),
  currentPeriodKey: payrollPeriodKeySchema,
  fromPeriodKey: payrollPeriodKeySchema,
  toPeriodKey: payrollPeriodKeySchema,
  /** The active cutover's month, or the candidate month this dry run asked about. */
  effectivePeriodKey: payrollPeriodKeySchema.nullable(),
  /** True when `effectivePeriodKey` came from the request rather than a stored row. */
  proposed: z.boolean(),
  months: z.array(payrollCutoverMonthSchema).min(1).max(24),
  issues: z.array(payrollCutoverIssueSchema),
  totals: z.strictObject({
    months: count,
    coveredMonths: count,
    /** The same buckets, added up across the whole window. */
    legacy: z.strictObject({
      total: bucketSchema,
      paid: bucketSchema,
      unpaid: bucketSchema,
      clawback: bucketSchema,
      unidentified: bucketSchema,
    }),
  }),
  /** `sha256` of everything above; activation must quote it back. */
  inventoryHash: hash,
});
export type PayrollCutoverInventory = z.infer<typeof payrollCutoverInventorySchema>;

export const payrollCutoverInventoryQuerySchema = z.strictObject({
  /** How many salon months to classify, ending with the current month. */
  months: z.coerce.number().int().min(1).max(24).default(12),
  /** Dry run a candidate activation month instead of the stored one. */
  effectivePeriodKey: payrollPeriodKeySchema.optional(),
});
export type PayrollCutoverInventoryQuery = z.infer<typeof payrollCutoverInventoryQuerySchema>;

export const payrollCutoverHistoryEntrySchema = z.strictObject({
  revision: z.number().int().positive(),
  action: z.enum(["ACTIVATE", "ROLLBACK"]),
  actorId: key,
  reason: z.string(),
  at: instant,
  effectivePeriodKey: payrollPeriodKeySchema.nullable(),
  inventoryHash: hash.nullable(),
  stateHash: hash,
  previousHash: hash.nullable(),
});
export type PayrollCutoverHistoryEntry = z.infer<typeof payrollCutoverHistoryEntrySchema>;

/** `GET /api/payroll-cutover` — owner-visible activation record and its history. */
export const payrollCutoverStateSchema = z.strictObject({
  status: payrollCutoverStatusSchema,
  revision: count,
  effectivePeriodKey: payrollPeriodKeySchema.nullable(),
  inventoryHash: hash.nullable(),
  activatedAt: instant.nullable(),
  activatedBy: key.nullable(),
  rolledBackAt: instant.nullable(),
  rolledBackBy: key.nullable(),
  rolledBackReason: z.string().nullable(),
  history: z.array(payrollCutoverHistoryEntrySchema),
});
export type PayrollCutoverState = z.infer<typeof payrollCutoverStateSchema>;

/**
 * Activation is owner-only and must quote the reviewed inventory hash. Legacy
 * earnings already written are never touched; from `effectivePeriodKey` onwards the
 * plan is the payroll of record and the legacy accrual writer stops writing rows.
 */
export const payrollCutoverActivateSchema = z.strictObject({
  expectedRevision: z.number().int().safe().nonnegative(),
  effectivePeriodKey: payrollPeriodKeySchema,
  /** The window the reviewed inventory was built over; the hash is window-specific. */
  inventoryMonths: z.number().int().min(1).max(24),
  inventoryHash: hash,
  reason,
});
export type PayrollCutoverActivate = z.infer<typeof payrollCutoverActivateSchema>;

/** Rollback resumes legacy accrual from the current salon month. Approved plan months refuse it. */
export const payrollCutoverRollbackSchema = z.strictObject({
  expectedRevision: z.number().int().safe().positive(),
  reason,
});
export type PayrollCutoverRollback = z.infer<typeof payrollCutoverRollbackSchema>;
