import { z } from "zod";
import { tenantStatusSchema } from "./auth.js";
import { paginationQuerySchema } from "./common.js";

const reasonSchema = z.string().trim().min(3).max(500);
export const companyLifecycleSchema = z
  .object({
    action: z.enum(["suspend", "reactivate", "cancel"]),
    reason: reasonSchema,
  })
  .strict();

// Money is a decimal string, never a binary floating-point calculation.
export const recordSubscriptionSchema = z
  .object({
    startDate: z.iso.datetime({ offset: true }),
    endDate: z.iso.datetime({ offset: true }),
    amount: z.string().regex(/^(?:0|[1-9]\d{0,9})\.\d{2}$/, "Use an amount such as 99.00."),
    currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
    reason: reasonSchema,
  })
  .strict()
  .refine((value) => new Date(value.endDate) > new Date(value.startDate), {
    message: "The end must be after the start.",
    path: ["endDate"],
  });
export const companyModuleSchema = z
  .object({
    code: z.string().min(1).max(80),
    enabled: z.boolean(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    reason: reasonSchema,
  })
  .strict();
export const companyAuditQuerySchema = paginationQuerySchema;
export const companyAdministrationSchema = z.object({
  effectiveStatus: tenantStatusSchema,
  subscriptions: z.array(
    z.object({
      id: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      status: z.enum(["PENDING", "ACTIVE", "EXPIRED", "CANCELLED"]),
      amount: z.string(),
      currency: z.string(),
      createdAt: z.string(),
    }),
  ),
  modules: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      isCore: z.boolean(),
      enabled: z.boolean(),
      entitled: z.boolean(),
      expiresAt: z.string().nullable(),
    }),
  ),
});
export const companyAuditSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      targetType: z.string(),
      targetId: z.string().nullable(),
      createdAt: z.string(),
      actor: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
      metadata: z.unknown(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type CompanyLifecycleInput = z.infer<typeof companyLifecycleSchema>;
export type RecordSubscriptionInput = z.infer<typeof recordSubscriptionSchema>;
export type CompanyModuleInput = z.infer<typeof companyModuleSchema>;
export type CompanyAuditQuery = z.infer<typeof companyAuditQuerySchema>;
export type CompanyAdministration = z.infer<typeof companyAdministrationSchema>;
export type CompanyAudit = z.infer<typeof companyAuditSchema>;
