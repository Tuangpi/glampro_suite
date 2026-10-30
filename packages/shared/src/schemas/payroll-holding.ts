import { z } from "zod";
import { commissionSharesSchema } from "./commission-attribution.js";
import { payrollPackageSettingsSchema } from "../commission-payroll/package-settings.js";
import { payrollValuePackagePurchaseSchema } from "../commission-payroll/value-package-refund.js";

const nonnegativeInteger = z.string().regex(/^(0|[1-9]\d*)$/);
export const payrollValueHoldingDetailSchema = z.object({
  holdingId: z.string(),
  updatedAt: z.iso.datetime(),
  creditRemaining: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/),
  purchase: payrollValuePackagePurchaseSchema.nullable(),
  originalTaxCents: nonnegativeInteger.nullable(),
  collectedNetCents: nonnegativeInteger.nullable(),
  collectedTaxCents: nonnegativeInteger.nullable(),
  usedBaseTicks: nonnegativeInteger.nullable(),
  missingEvidence: z.array(z.string()),
  refunded: z.boolean(),
  refund: z
    .object({
      occurredAt: z.iso.datetime(),
      grossCents: nonnegativeInteger,
      netCents: nonnegativeInteger,
      taxCents: nonnegativeInteger,
      reason: z.string(),
      payoutMethod: z.string(),
    })
    .nullable(),
});
export type PayrollValueHoldingDetail = z.infer<typeof payrollValueHoldingDetailSchema>;

export const payrollHoldingDetailSchema = z.object({
  holdingId: z.string(),
  updatedAt: z.iso.datetime(),
  purchaseSaleId: z.string().nullable(),
  currency: z.string().nullable(),
  netCents: z.string().nullable(),
  balanceDueCents: z.string().nullable(),
  collectedNetCents: z.string().nullable(),
  collectedTaxCents: z.string().nullable(),
  usedBaseTicks: z.string().nullable(),
  sessionValue: z.string().nullable(),
  grantedSessions: z.number().int(),
  remainingSessions: z.number().int(),
  paidSessionsRemaining: z.number().int().nullable(),
  sellers: commissionSharesSchema.nullable(),
  settings: payrollPackageSettingsSchema.nullable(),
  missingEvidence: z.array(z.string()),
  refunded: z.boolean(),
  payments: z.array(
    z.object({
      id: z.string(),
      occurredAt: z.iso.datetime(),
      grossCents: z.string(),
      netCents: z.string(),
      taxCents: z.string(),
    }),
  ),
  sessions: z.array(
    z.object({
      id: z.string(),
      saleId: z.string(),
      quantity: z.number().int(),
      usedAt: z.iso.datetime(),
      revertedAt: z.iso.datetime().nullable(),
      revision: z.number().int().nullable(),
      performers: commissionSharesSchema.nullable(),
      baseAmount: z.string().nullable(),
      signature: z.string().nullable(),
    }),
  ),
});
export type PayrollHoldingDetail = z.infer<typeof payrollHoldingDetailSchema>;
export const refundPayrollPackageSchema = z
  .strictObject({
    idempotencyKey: z.string().min(8).max(100),
    expectedUpdatedAt: z.iso.datetime(),
    reason: z.string().trim().min(3).max(500),
    adminFeeNetCents: z.string().regex(/^(0|[1-9]\d{0,11})$/),
    payoutGrossCents: z.string().regex(/^(0|[1-9]\d{0,11})$/),
    payoutMethod: z.enum(["NONE", "CASH", "CARD", "PAYNOW", "NETS", "BANK_TRANSFER"]),
    settlement: z
      .strictObject({
        confirmed: z.literal(true),
        reference: z.string().trim().min(3).max(128),
      })
      .optional(),
  })
  .refine((value) => (value.payoutGrossCents === "0") === (value.payoutMethod === "NONE"), {
    message: "Zero payout requires NONE; a positive payout requires its actual tender.",
    path: ["payoutMethod"],
  });
export type RefundPayrollPackage = z.infer<typeof refundPayrollPackageSchema>;
export const voidPayrollSessionSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(100),
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(500),
});
