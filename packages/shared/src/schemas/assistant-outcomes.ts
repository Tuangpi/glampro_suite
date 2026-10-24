import { z } from "zod";

export const assistantOutcomeSchema = z.object({
  asOf: z.iso.datetime(),
  from: z.iso.datetime().nullable(),
  to: z.iso.datetime().nullable(),
  windowDays: z.literal(30),
  jobStatus: z.string().nullable(),
  delivery: z.enum(["not_queued", "provider_reported_delivered", "not_confirmed"]),
  bookingsCreated: z.number().int().nonnegative().nullable(),
  completedSales: z.number().int().nonnegative().nullable(),
  salesVisible: z.boolean(),
  limitations: z.array(z.string()),
});
export type AssistantOutcome = z.infer<typeof assistantOutcomeSchema>;

/** Only the signed callback's delivered state establishes provider-reported delivery. */
export function assistantDelivery(status: string | null): AssistantOutcome["delivery"] {
  if (status === null) return "not_queued";
  return status === "DELIVERED" || status === "READ"
    ? "provider_reported_delivered"
    : "not_confirmed";
}
