import { z } from "zod";

/** Salon-authored wording, not a claim of legal compliance. Versions are immutable. */
export const configurePrivacyNoticeSchema = z
  .object({
    version: z.string().trim().min(1).max(100),
    dataConsentText: z.string().trim().min(1).max(10_000),
    marketingConsentText: z.string().trim().min(1).max(10_000),
  })
  .strict();

export type ConfigurePrivacyNoticeInput = z.infer<typeof configurePrivacyNoticeSchema>;

export const privacyNoticeSchema = configurePrivacyNoticeSchema.extend({
  id: z.string(),
  createdAt: z.string(),
});
export type PrivacyNotice = z.infer<typeof privacyNoticeSchema>;

export const recordCustomerConsentSchema = z
  .object({
    pdpaConsent: z.boolean(),
    marketingOptIn: z.boolean(),
    /** Optimistic concurrency: do not overwrite a withdrawal made in another tab. */
    expectedRevision: z.number().int().min(0),
    /** Must match the current notice when granting either choice. */
    noticeId: z.string().min(1).nullable(),
  })
  .strict()
  .refine((value) => !value.marketingOptIn || value.pdpaConsent, {
    message: "Marketing opt-in requires personal-data consent.",
    path: ["marketingOptIn"],
  });
export type RecordCustomerConsentInput = z.infer<typeof recordCustomerConsentSchema>;

export const customerConsentEventSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  pdpaConsent: z.boolean(),
  marketingOptIn: z.boolean(),
  recordedAt: z.string(),
  recordedById: z.string(),
  notice: privacyNoticeSchema.nullable(),
});

export const customerConsentSchema = z.object({
  pdpaConsent: z.boolean(),
  marketingOptIn: z.boolean(),
  revision: z.number().int(),
  currentNotice: privacyNoticeSchema.nullable(),
  history: z.array(customerConsentEventSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type CustomerConsent = z.infer<typeof customerConsentSchema>;
