import { z } from "zod";

export const publicAvailabilitySchema = z.object({
  serviceId: z.string().trim().min(1),
  date: z.iso.date(),
});

export const publicBookingSchema = z
  .object({
    serviceId: z.string().trim().min(1),
    startsAt: z.iso.datetime({ offset: true }),
    customerName: z.string().trim().min(1).max(200),
    customerPhone: z.string().trim().min(1).max(50).nullable().optional(),
    customerEmail: z.email().trim().toLowerCase().max(254).nullable().optional(),
    consentGiven: z.literal(true),
    noticeId: z.string().min(1),
  })
  .refine((input) => input.customerPhone || input.customerEmail, {
    message: "Provide a phone number or email so the salon can contact you.",
    path: ["customerPhone"],
  });

export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilitySchema>;
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;
