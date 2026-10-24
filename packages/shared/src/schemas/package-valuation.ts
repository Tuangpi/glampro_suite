import { z } from "zod";

/** Policy 1 and the current POS support SGD purchase consideration only.
 * Never accept an arbitrary billing currency while the till formats sales as SGD.
 */
export const activatePackageValuationSchema = z.strictObject({
  policyVersion: z.literal(1),
  currency: z.literal("SGD"),
  reason: z.string().trim().min(1).max(2000),
  confirmed: z.literal(true),
});

export const packageValuationActivationSchema = z.object({
  id: z.string(),
  policyVersion: z.literal(1),
  currency: z.literal("SGD"),
  activatedAt: z.iso.datetime(),
  actorId: z.string(),
  reason: z.string(),
});

export type ActivatePackageValuationInput = z.infer<typeof activatePackageValuationSchema>;
export type PackageValuationActivationView = z.infer<typeof packageValuationActivationSchema>;

const valuationBucketSchema = z.object({
  holdings: z.number().int().nonnegative(),
  sessionsRemaining: z.number().int().nonnegative(),
  net: z.string().regex(/^\d+\.\d{2}$/),
  originalTax: z.string().regex(/^\d+\.\d{2}$/),
  gross: z.string().regex(/^\d+\.\d{2}$/),
});
const unvaluedBucketSchema = z.object({
  holdings: z.number().int().nonnegative(),
  sessionsRemaining: z.number().int().nonnegative(),
});

/** Current company-wide purchase value, never a historical closing or cash balance. */
export const packageValuationReportSchema = z.object({
  scope: z.literal("COMPANY"),
  asOf: z.iso.datetime(),
  activation: packageValuationActivationSchema.nullable(),
  active: valuationBucketSchema,
  expired: valuationBucketSchema,
  unvalued: z.object({ active: unvaluedBucketSchema, expired: unvaluedBucketSchema }),
  unpaidPurchases: z.object({
    sales: z.number().int().nonnegative(),
    holdings: z.number().int().nonnegative(),
    /** Whole source-sale receivables; not an allocation to package lines. */
    sourceSaleOutstanding: z.string().regex(/^\d+\.\d{2}$/),
  }),
  reconciliation: z.object({
    status: z.literal("RECONCILED"),
    purchases: z.number().int().nonnegative(),
    movements: z.number().int().nonnegative(),
  }),
});

export type PackageValuationReport = z.infer<typeof packageValuationReportSchema>;
