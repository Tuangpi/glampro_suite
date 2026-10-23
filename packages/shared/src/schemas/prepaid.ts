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

const familyIdSchema = z.string().min(1).max(64);
const familyReasonSchema = z.string().trim().min(1).max(2000);
export const createPrepaidFamilySchema = z.object({
  name: z.string().trim().min(1).max(100),
  reason: familyReasonSchema,
  confirmed: z.literal(true),
});
export const changePrepaidMembershipSchema = z.object({
  familyId: familyIdSchema.nullable(),
  expectedFamilyId: familyIdSchema.nullable(),
  reason: familyReasonSchema,
  confirmed: z.literal(true),
});
export const prepaidFamilySchema = z.object({
  id: familyIdSchema,
  name: z.string(),
  members: z.array(z.object({ customerId: z.string(), name: z.string(), archived: z.boolean() })),
});
export const prepaidFamilyEventSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  fromFamilyId: z.string().nullable(),
  toFamilyId: z.string().nullable(),
  actorId: z.string(),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});
export type CreatePrepaidFamilyInput = z.infer<typeof createPrepaidFamilySchema>;
export type ChangePrepaidMembershipInput = z.infer<typeof changePrepaidMembershipSchema>;
export type PrepaidFamily = z.infer<typeof prepaidFamilySchema>;
export type PrepaidFamilyEvent = z.infer<typeof prepaidFamilyEventSchema>;
