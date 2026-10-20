import { z } from "zod";
import { moneySchema } from "./common.js";

/** Direct-to-staff evidence only. Never a sale tender or a tax classification. */
export const recordDirectTipSchema = z
  .object({
    staffId: z.string().min(1).max(64),
    amount: moneySchema.refine(
      (value) => value > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
      "Enter a positive amount with at most two decimal places.",
    ),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const returnDirectTipSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
export const directTipParamsSchema = z.object({
  id: z.string().min(1).max(64),
  tipId: z.string().min(1).max(64),
});
export const directTipSchema = z.object({
  id: z.string(),
  saleId: z.string(),
  amount: z.string(),
  staffId: z.string(),
  staffName: z.string(),
  recordedByName: z.string(),
  recordedAt: z.string(),
  returnedAt: z.string().nullable(),
  returnedByName: z.string().nullable(),
  returnReason: z.string().nullable(),
});
export const directTipListSchema = z.object({ items: z.array(directTipSchema) });
export type RecordDirectTipInput = z.infer<typeof recordDirectTipSchema>;
export type DirectTipList = z.infer<typeof directTipListSchema>;
