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
/**
 * The same change for every add-on at once.
 *
 * The operator makes one decision — "give this company everything", "take every
 * add-on away" — with one reason and one term, so the body carries a single
 * `reason` and a single `expiresAt` rather than a list of per-module changes that
 * could disagree with each other.
 *
 * It is deliberately **not** a list of codes: which modules may be granted is
 * platform data (core modules are always on, and `UNENFORCED_MODULE_CODES` have no
 * screen behind them), so the server decides the set and a client cannot widen it
 * by naming a module the console would have disabled. `strict()` turns an attempt
 * to try into a `422` rather than a silently ignored field.
 */
export const companyModulesBulkSchema = z
  .object({
    enabled: z.boolean(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    reason: reasonSchema,
  })
  .strict()
  .refine((value) => value.enabled || value.expiresAt === null, {
    message: "A revoked module cannot have an expiry.",
    path: ["expiresAt"],
  });
/**
 * What a bulk change actually did.
 *
 * `changed` moved; `unchanged` was already in the requested state and was left
 * alone — a granted add-on keeps its own expiry rather than having a new term
 * stamped over one an operator chose earlier. The console reports both counts, so
 * "nothing happened" and "less happened than you expected" read differently.
 */
export const companyModulesBulkResultSchema = z.object({
  changed: z.array(z.string()),
  unchanged: z.array(z.string()),
});
export const companyAuditQuerySchema = paginationQuerySchema;
/**
 * Permanent removal of a company and every row that points at it.
 *
 * Deliberately not part of `companyLifecycleSchema`: suspend, reactivate and
 * cancel keep the data and stay reversible, while a purge does not. The slug has
 * to be typed back so a mis-click cannot empty a salon that shares its name.
 */
export const companyPurgeSchema = z
  .object({
    confirmSlug: z.string().trim().min(3).max(64),
    reason: reasonSchema,
  })
  .strict();
export const companyPurgeResultSchema = z.object({
  purged: z.literal(true),
  company: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  /** Rows removed across every tenant-scoped table, for the audit entry. */
  deletedRows: z.number().int().nonnegative(),
});
export const companyAdministrationSchema = z.object({
  /**
   * The status written on the company row — what the lifecycle verbs branch on.
   *
   * `effectiveStatus` is the same question asked of reality (a stored `ACTIVE`
   * company whose last period has ended reads `EXPIRED`); `status` is the stored
   * value, and it is the one `changeCompanyLifecycle` compares against to decide
   * whether "reactivate" means anything. The console needs both: the badge shows
   * what the company can do now, the buttons decide what the record allows.
   */
  status: tenantStatusSchema,
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
export type CompanyModulesBulkInput = z.infer<typeof companyModulesBulkSchema>;
export type CompanyModulesBulkResult = z.infer<typeof companyModulesBulkResultSchema>;
export type CompanyAuditQuery = z.infer<typeof companyAuditQuerySchema>;
export type CompanyPurgeInput = z.infer<typeof companyPurgeSchema>;
export type CompanyPurgeResult = z.infer<typeof companyPurgeResultSchema>;
export type CompanyAdministration = z.infer<typeof companyAdministrationSchema>;
export type CompanyAudit = z.infer<typeof companyAuditSchema>;
