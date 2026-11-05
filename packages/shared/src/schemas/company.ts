import { z } from "zod";
import { adminPasswordSchema, tenantStatusSchema } from "./auth.js";
import { emailSchema, paginationQuerySchema } from "./common.js";

/**
 * A company's address in the salon portal: lowercase, hyphen-separated.
 *
 * Shared by creation and by an edit so the two cannot drift — a slug typed into
 * one form has to satisfy exactly the rule the other one enforces.
 */
const companySlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.");

/** An owner's name paired with the address their invitation is sent to. */
const ownerNameSchema = z.string().trim().min(1).max(120);
const ownerEmailSchema = emailSchema.transform((value) => value.toLowerCase());

const companyNameSchema = z.string().trim().min(1).max(160);

export const createCompanySchema = z
  .object({
    name: companyNameSchema,
    slug: companySlugSchema,
    ownerName: ownerNameSchema,
    ownerEmail: ownerEmailSchema,
  })
  .strict();

/**
 * `PATCH /api/platform/companies/:id` — correcting a company that already exists.
 *
 * The console could create a company and then never change it: a company whose
 * owner was never recorded read "Not assigned" on every owner row, and there was
 * no action anywhere that could fill it in. This is that action, so it is also
 * the one place an owner may be *assigned* after the fact.
 *
 * `reason` is required, like every other operator write, because the audit row is
 * what makes "who renamed this salon" answerable.
 *
 * The owner pair is optional, but both halves travel together: a name with no
 * address cannot be invited and an address with no name has nobody to greet. To
 * keep an owner as it is, send neither.
 */
export const updateCompanySchema = z
  .object({
    name: companyNameSchema,
    slug: companySlugSchema,
    ownerName: ownerNameSchema.optional(),
    ownerEmail: ownerEmailSchema.optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine((value) => (value.ownerName === undefined) === (value.ownerEmail === undefined), {
    message: "Give both the owner's name and email address, or neither.",
    path: ["ownerEmail"],
  });
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
/**
 * The answer to an edit: the company as it now reads, plus what happened to the
 * invitation.
 *
 * `null` means the edit needed no invitation — nothing was sent and there is
 * nothing to retry. `failed` means the company *was* saved and the mail was not;
 * the invitation row exists, so "Resend invitation" is the retry rather than
 * re-saving the form.
 */
export const companyUpdateResultSchema = z.object({
  company: companyDetailSchema,
  invitationDelivery: z.enum(["sent", "failed"]).nullable(),
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
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type CompanyListQuery = z.infer<typeof companyListQuerySchema>;
export type CompanySummary = z.infer<typeof companySummarySchema>;
export type CompanyDirectoryStats = z.infer<typeof companyDirectoryStatsSchema>;
export type CompanyDetail = z.infer<typeof companyDetailSchema>;
export type CompanyList = z.infer<typeof companyListSchema>;
export type CompanyOnboarding = z.infer<typeof companyOnboardingSchema>;
export type CompanyUpdateResult = z.infer<typeof companyUpdateResultSchema>;
export type AcceptOwnerInvitationInput = z.infer<typeof acceptOwnerInvitationSchema>;
