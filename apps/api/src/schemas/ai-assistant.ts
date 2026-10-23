import { z } from "zod";

const edge = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const fields = { from: edge.optional(), to: edge.optional() };
// Mixed date/instant edges can only be ordered after resolving the salon zone.
const ordered = (value: { from?: string; to?: string }) =>
  !value.from ||
  !value.to ||
  (value.from.length === 10) !== (value.to.length === 10) ||
  Date.parse(value.from) <= Date.parse(value.to);
const orderError = { message: "from must not be after to", path: ["to"] };

export const assistantRangeSchema = z.object(fields).strict().refine(ordered, orderError);
export const rebookingQuerySchema = z
  .object({
    ...fields,
    daysThreshold: z.coerce.number().int().min(1).max(3650).optional(),
  })
  .strict()
  .refine(ordered, orderError);
export const promoQuerySchema = z
  .object({
    ...fields,
    discountPercentage: z.coerce.number().min(1).max(100).optional(),
  })
  .strict()
  .refine(ordered, orderError);

export type AssistantRange = z.infer<typeof assistantRangeSchema>;
export type RebookingQuery = z.infer<typeof rebookingQuerySchema>;
export type PromoQuery = z.infer<typeof promoQuerySchema>;
