import { z } from "zod";

/** Basis points avoid floating-point percentage sums. Omitted means unknown, not cashier. */
export const commissionSharesSchema = z
  .array(
    z
      .object({
        staffId: z.string().min(1).max(64),
        share: z.number().int().min(1).max(10000),
      })
      .strict(),
  )
  .min(1)
  .max(4)
  .superRefine((rows, ctx) => {
    if (new Set(rows.map((row) => row.staffId)).size !== rows.length)
      ctx.addIssue({ code: "custom", message: "Select each credited staff member only once." });
    if (rows.reduce((sum, row) => sum + row.share, 0) !== 10000)
      ctx.addIssue({ code: "custom", message: "Commission shares must total 100%." });
  });
export const commissionAttributionSchema = z
  .object({
    sellers: commissionSharesSchema.optional(),
    performers: commissionSharesSchema.optional(),
  })
  .strict()
  .refine((value) => value.sellers !== undefined || value.performers !== undefined, {
    message: "Select a seller or performer, or omit attribution entirely.",
  });
export type CommissionShares = z.infer<typeof commissionSharesSchema>;
export type CommissionAttribution = z.infer<typeof commissionAttributionSchema>;

export const correctRedemptionAttributionSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    idempotencyKey: z.string().min(8).max(128),
    performers: commissionSharesSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type CorrectRedemptionAttribution = z.infer<typeof correctRedemptionAttributionSchema>;

export const commissionAttributionPolicySchema = z
  .object({
    requireSellers: z.boolean(),
    requireServicePerformers: z.boolean(),
    requireRedemptionPerformers: z.boolean(),
  })
  .strict();
export const publishCommissionAttributionPolicySchema = commissionAttributionPolicySchema
  .extend({
    expectedRevision: z.string().nullable(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type CommissionAttributionPolicy = z.infer<typeof commissionAttributionPolicySchema>;
export type PublishCommissionAttributionPolicy = z.infer<
  typeof publishCommissionAttributionPolicySchema
>;
