import { z } from "zod";

const positiveCents = z.string().regex(/^[1-9]\d{0,11}$/);
const cents = z.string().regex(/^\d+$/);

/** Cashier-confirmed recorded money, not a gateway charge or historical backfill. */
export const recordSaleCollectionSchema = z
  .strictObject({
    idempotencyKey: z.uuid(),
    currency: z.literal("SGD"),
    collected: z.literal(true),
    grossCents: positiveCents,
    reason: z.string().trim().min(3).max(500),
    allocations: z
      .array(
        z.strictObject({
          saleLineId: z.string().min(1).max(128),
          grossCents: positiveCents,
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine((input, ctx) => {
    if (
      !positiveCents.safeParse(input.grossCents).success ||
      input.allocations.some((row) => !positiveCents.safeParse(row.grossCents).success)
    )
      return;
    if (new Set(input.allocations.map((row) => row.saleLineId)).size !== input.allocations.length)
      ctx.addIssue({ code: "custom", path: ["allocations"], message: "Allocate each line once." });
    if (
      input.allocations.reduce((sum, row) => sum + BigInt(row.grossCents), 0n) !==
      BigInt(input.grossCents)
    )
      ctx.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Allocations must equal the collected amount.",
      });
  });

export const saleCollectionStateSchema = z.object({
  saleId: z.string(),
  currency: z.literal("SGD").nullable(),
  outstandingCents: cents,
  canCollect: z.boolean(),
  /** Only explicitly allocated money; excludes unknown prior payments. */
  lines: z.array(
    z.object({
      saleLineId: z.string(),
      itemName: z.string(),
      contractedGrossCents: cents,
      allocatedGrossCents: cents,
    }),
  ),
  payments: z.array(
    z.object({
      collectionId: z.string(),
      paymentId: z.string(),
      grossCents: positiveCents,
      occurredAt: z.string(),
      reason: z.string(),
      allocations: z.array(z.object({ saleLineId: z.string(), grossCents: positiveCents })),
    }),
  ),
});

export type RecordSaleCollectionInput = z.infer<typeof recordSaleCollectionSchema>;
export type SaleCollectionState = z.infer<typeof saleCollectionStateSchema>;
