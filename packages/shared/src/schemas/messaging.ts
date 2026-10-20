import { z } from "zod";

export const messageChannelSchema = z.enum(["WHATSAPP", "SMS"]);
export const messagingSettingsSchema = z
  .object({
    whatsappEnabled: z.boolean().default(false),
    smsEnabled: z.boolean().default(false),
    reminderHours: z.number().int().min(1).max(168).default(24),
    rebookingDays: z.number().int().min(1).max(365).default(28),
    quietStart: z.number().int().min(0).max(23).default(20),
    quietEnd: z.number().int().min(0).max(23).default(9),
    cancellationHours: z.number().int().min(0).max(168).default(2),
    consentVersion: z.string().trim().max(100).default(""),
    serviceConsentText: z.string().trim().max(10000).default(""),
    marketingConsentText: z.string().trim().max(10000).default(""),
  })
  .strict()
  .refine((v) => v.quietStart !== v.quietEnd, { message: "Quiet-hour boundaries must differ." });
export type MessagingSettingsInput = z.infer<typeof messagingSettingsSchema>;
export const channelConsentSchema = z
  .object({
    channel: messageChannelSchema,
    service: z.boolean(),
    marketing: z.boolean(),
    preferred: z.boolean(),
    expectedRevision: z.number().int().min(0),
    noticeVersion: z.string().max(100),
    presented: z.boolean(),
  })
  .strict();
export type ChannelConsentInput = z.infer<typeof channelConsentSchema>;
export const sendReceiptMessageSchema = z.object({ channel: messageChannelSchema }).strict();
export const bookingActionSchema = z.object({ action: z.enum(["confirm", "cancel"]) }).strict();
