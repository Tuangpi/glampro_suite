import { z } from "zod";

const money = z.string().regex(/^\d+\.\d{2}$/);
const signedMoney = z.string().regex(/^-?\d+\.\d{2}$/);

/** Read-only facts. Money includes all completed-sale tenders, not cash-only income. */
export const ownerSummarySchema = z
  .object({
    /** Legacy alias of completedSalePaid; retained for existing clients. */
    incomeToday: money,
    completedSalePaid: money,
    refundsToday: money,
    netPaid: signedMoney,
    salesToday: z.number().int().nonnegative(),
    /** Pre-refund completedSalePaid / salesToday; zero when no completed receipts. */
    averageTicket: money,
    appointmentsToday: z.number().int().nonnegative(),
    newCustomersToday: z.number().int().nonnegative(),
    /** Current active products, not historical stock within the reporting window. */
    lowStockCount: z.number().int().nonnegative(),
    lowStockThreshold: z.number().int().nonnegative(),
    timeZone: z.string().min(1),
    /** Resolved half-open interval [from, to). */
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    asOf: z.iso.datetime({ offset: true }),
  })
  .refine((value) => Date.parse(value.from) < Date.parse(value.to), {
    message: "from must precede to",
    path: ["to"],
  });

export type OwnerSummary = z.infer<typeof ownerSummarySchema>;

export const rebookingNudgeSchema = z.object({
  customerId: z.string().min(1),
  customerName: z.string(),
  email: z.string(), // Legacy field; eligibility is channel/destination based, not email based.
  appointmentId: z.string().min(1),
  lastServiceDate: z.iso.date(),
  serviceName: z.string(),
  suggestedRebookDate: z.iso.date(),
  daysSinceLastService: z.number().int().nonnegative(),
  serviceInterval: z.number().int().min(1).max(3650),
  intervalSource: z.enum(["service", "company", "query"]),
  channel: z.enum(["SMS", "WHATSAPP"]),
  destination: z.string().regex(/^\+[1-9]\d{7,14}$/),
  message: z.string().min(1).max(2000),
  draftId: z.string().min(1),
});
export type RebookingNudge = z.infer<typeof rebookingNudgeSchema>;

export const assistantDraftInputSchema = z
  .object({
    customerId: z.string().min(1).max(64),
    appointmentId: z.string().min(1).max(64),
    channel: z.literal("SMS"),
    destination: z.string().regex(/^\+[1-9]\d{7,14}$/),
    message: z.string().trim().min(1).max(1000),
  })
  .strict();
export const assistantDraftEditSchema = assistantDraftInputSchema
  .extend({
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const assistantDraftActionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const assistantDraftReviewSchema = assistantDraftActionSchema
  .extend({ reason: z.string().trim().min(3).max(500) })
  .strict();
export const assistantDraftSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  appointmentId: z.string(),
  channel: z.literal("SMS"),
  destination: z.string(),
  message: z.string(),
  body: z.string(),
  sender: z.string(),
  version: z.number().int().positive(),
  status: z.enum(["DRAFT", "APPROVED", "QUEUED"]),
  reviewDueAt: z.iso.datetime(),
  job: z
    .object({ id: z.string(), status: z.string(), errorCode: z.string().nullable() })
    .nullable(),
});
export type AssistantDraftInput = z.infer<typeof assistantDraftInputSchema>;
export type AssistantDraft = z.infer<typeof assistantDraftSchema>;

/** Deliberately no discount/content/recipient fields: this endpoint cannot publish offers. */
export const quietDayQuerySchema = z
  .object({
    serviceId: z.string().trim().min(1).max(64),
    days: z.coerce.number().int().min(1).max(7).default(7),
  })
  .strict();
export type QuietDayQuery = z.infer<typeof quietDayQuerySchema>;

export const quietDayResponseSchema = z.object({
  asOf: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  serviceId: z.string().min(1),
  serviceName: z.string(),
  durationMinutes: z.number().int().positive(),
  lowBookingThreshold: z.literal(3),
  checkedSlots: z.number().int().min(0).max(120),
  searchLimited: z.boolean(),
  discountPercentage: z.literal(0),
  requiresApproval: z.literal(true),
  limitations: z.array(z.string()),
  opportunities: z
    .array(
      z.object({
        date: z.iso.date(),
        bookingCount: z.number().int().min(0).max(2),
        startsAt: z.iso.datetime({ offset: true }),
        endsAt: z.iso.datetime({ offset: true }),
        staffId: z.string().min(1),
        action: z.literal("Review this opening before offering a regular-price appointment."),
      }),
    )
    .max(7),
});
export type QuietDayResponse = z.infer<typeof quietDayResponseSchema>;
