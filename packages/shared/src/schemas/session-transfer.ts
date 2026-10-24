import { z } from "zod";

export const sessionHoldingParamsSchema = z.object({
  id: z.string().min(1).max(64),
  holdingId: z.string().min(1).max(64),
});

export const transferSessionPackageSchema = z.strictObject({
  targetCustomerId: z.string().min(1).max(64),
  expectedUpdatedAt: z.iso.datetime(),
  reason: z.string().trim().min(1).max(2000),
  confirmed: z.literal(true),
});

export const sessionPackageHoldingSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  name: z.string(),
  quantityRemaining: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

/** Snapshot identifiers survive later customer, holding or account removal. */
export const sessionPackageTransferEventSchema = z.object({
  id: z.string(),
  holdingId: z.string(),
  fromCustomerId: z.string(),
  toCustomerId: z.string(),
  actorId: z.string(),
  quantity: z.number().int().positive(),
  expiresAt: z.iso.datetime().nullable(),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});

export type TransferSessionPackageInput = z.infer<typeof transferSessionPackageSchema>;
export type SessionPackageHolding = z.infer<typeof sessionPackageHoldingSchema>;
export type SessionPackageTransferEvent = z.infer<typeof sessionPackageTransferEventSchema>;
