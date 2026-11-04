import { z } from "zod";
import { adminPasswordSchema, tenantStatusSchema } from "./auth.js";
import { emailSchema, paginationQuerySchema } from "./common.js";

export const createCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slug: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens."),
    ownerName: z.string().trim().min(1).max(120),
    ownerEmail: emailSchema.transform((value) => value.toLowerCase()),
  })
  .strict();
export const companyListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(160).default(""),
});
export const companySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: tenantStatusSchema,
  /**
   * When the company's subscription lapses — its latest `Subscription.endDate`,
   * `null` when no plan has been recorded. Read-only here: plan changes go
   * through the subscription screens, not the company form.
   */
  subscriptionEndsAt: z.string().nullable(),
  createdAt: z.string(),
  owner: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      disabled: z.boolean(),
    })
    .nullable(),
});
/**
 * Directory totals for the operator's overview tiles.
 *
 * Whole-directory counts, deliberately unaffected by the list's `search` and
 * paging: an operator reading "3 suspended" means the business, not the page.
 * `expiringSoon` counts live companies whose latest end date falls inside the
 * next 30 days — companies already past their end date are lapsed, not expiring.
 */
export const companyDirectoryStatsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  suspended: z.number().int(),
  expiringSoon: z.number().int(),
});
export const companyDetailSchema = companySummarySchema.extend({
  invitation: z
    .object({
      expiresAt: z.string(),
      acceptedAt: z.string().nullable(),
      revokedAt: z.string().nullable(),
    })
    .nullable(),
});
export const companyListSchema = z.object({
  items: z.array(companySummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  stats: companyDirectoryStatsSchema,
});
export const companyOnboardingSchema = z.object({
  company: companyDetailSchema,
  invitationDelivery: z.enum(["sent", "failed"]),
});
// Pure JS byte count keeps the contract browser-safe; bcrypt truncates after 72 bytes.
export const acceptOwnerInvitationSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    password: adminPasswordSchema.refine(
      (value) => new TextEncoder().encode(value).length <= 72,
      "Use a password of at most 72 UTF-8 bytes.",
    ),
  })
  .strict();
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type CompanyListQuery = z.infer<typeof companyListQuerySchema>;
export type CompanySummary = z.infer<typeof companySummarySchema>;
export type CompanyDirectoryStats = z.infer<typeof companyDirectoryStatsSchema>;
export type CompanyDetail = z.infer<typeof companyDetailSchema>;
export type CompanyList = z.infer<typeof companyListSchema>;
export type CompanyOnboarding = z.infer<typeof companyOnboardingSchema>;
export type AcceptOwnerInvitationInput = z.infer<typeof acceptOwnerInvitationSchema>;
