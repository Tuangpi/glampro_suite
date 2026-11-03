import { z } from "zod";
import { formatPrice } from "@/lib/utils";

/** Money crosses the wire as exact decimal strings, never as a float. */
const money = z.string().regex(/^-?(0|[1-9]\d{0,11})\.\d{2}$/);
/** The server's impact payload: the posted month valued under the saved rules. */
export const impactSchema = z.object({
  currency: z.string(),
  /** The calculator contract that produced the money, e.g. `"cp-005-v2"`. It is a
   * label rather than a counter, and it is part of the hashed input snapshot. */
  calculationVersion: z.string().min(1),
  inputHash: z.string(),
  afterVersion: z.object({
    id: z.string(),
    versionNo: z.number().int(),
    status: z.string(),
    effectiveFrom: z.string(),
  }),
  rows: z.array(
    z.object({
      staffId: z.string(),
      staffName: z.string(),
      disabled: z.boolean(),
      assignedVersion: z.object({ id: z.string(), versionNo: z.number().int().nullable() }),
      beforeTotal: money,
      afterTotal: money,
      change: money,
    }),
  ),
  staffWithoutActivity: z.array(
    z.object({ staffId: z.string(), staffName: z.string(), disabled: z.boolean() }),
  ),
  totals: z.object({ before: money, after: money, change: money }),
});
export type PayrollImpact = z.infer<typeof impactSchema>;
/** A frozen close is the month's own record; the loader path is a live month. */
export const sourceLabels = {
  FROZEN_CLOSE: "the month's frozen approved calculation",
  AUTHORITATIVE_LOADER: "authoritative inputs, not yet frozen by a close",
} as const;
export type InputSource = keyof typeof sourceLabels;
/** What the readiness check publishes so other plan views show the same money. */
export type PayrollPostedMoney = {
  periodKey: string;
  inputSource: InputSource;
  impact: PayrollImpact;
};
/** `formatPrice` renders an exact decimal string; a change reads better signed. */
export function signedMoney(value: string, currency: string) {
  const formatted = formatPrice(value, currency);
  return Number(value) > 0 ? `+${formatted}` : formatted;
}
