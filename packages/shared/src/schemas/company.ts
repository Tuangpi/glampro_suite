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
export type CompanyDetail = z.infer<typeof companyDetailSchema>;
export type CompanyList = z.infer<typeof companyListSchema>;
export type CompanyOnboarding = z.infer<typeof companyOnboardingSchema>;
export type AcceptOwnerInvitationInput = z.infer<typeof acceptOwnerInvitationSchema>;
