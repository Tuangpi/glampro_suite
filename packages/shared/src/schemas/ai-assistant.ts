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
