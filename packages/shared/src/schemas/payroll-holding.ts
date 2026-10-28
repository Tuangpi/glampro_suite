import { z } from "zod";
import { commissionSharesSchema } from "./commission-attribution.js";
import { payrollPackageSettingsSchema } from "../commission-payroll/package-settings.js";
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
export const refundPayrollPackageSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(100),
  expectedUpdatedAt: z.iso.datetime(),
  reason: z.string().trim().min(3).max(500),
  adminFeeNetCents: z.string().regex(/^(0|[1-9]\d{0,11})$/),
  payoutGrossCents: z.string().regex(/^[1-9]\d{0,11}$/),
  payoutMethod: z.enum(["CASH", "CARD", "PAYNOW", "NETS", "BANK_TRANSFER"]),
});
export type RefundPayrollPackage = z.infer<typeof refundPayrollPackageSchema>;
export const voidPayrollSessionSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(100),
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(500),
});
