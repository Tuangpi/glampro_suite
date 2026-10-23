import { z } from "zod";

export const prepaidHoldingParamsSchema = z.object({
  id: z.string().min(1).max(64),
  holdingId: z.string().min(1).max(64),
});

export const transferPrepaidSchema = z.strictObject({
  targetCustomerId: z.string().min(1).max(64),
  expectedUpdatedAt: z.iso.datetime(),
  reason: z.string().trim().min(1).max(2000),
  confirmed: z.literal(true),
});

export const prepaidHoldingSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  name: z.string(),
  amountRemaining: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

/** Snapshot identifiers survive later customer, holding or account removal. */
export const prepaidTransferEventSchema = z.object({
  id: z.string(),
  holdingId: z.string(),
  fromCustomerId: z.string(),
  toCustomerId: z.string(),
  actorId: z.string(),
  amount: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});

export type TransferPrepaidInput = z.infer<typeof transferPrepaidSchema>;
export type PrepaidHolding = z.infer<typeof prepaidHoldingSchema>;
export type PrepaidTransferEvent = z.infer<typeof prepaidTransferEventSchema>;
