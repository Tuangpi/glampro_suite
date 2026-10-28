import { z } from "zod";
import { cmp, exact } from "./decimal.js";

const money = z.string().regex(/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/);
const award = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("FOLLOW_PLAN") }),
  z.strictObject({ mode: z.literal("EXCLUDE") }),
  z.strictObject({ mode: z.literal("FIXED"), amount: money }),
]);
export const payrollPackageSettingsSchema = z.strictObject({
  sale: award,
  redemption: award,
  minimumDepositPct: z
    .string()
    .regex(/^(0|[1-9]\d{0,2})(?:\.\d{1,2})?$/)
    .refine(
      (value) =>
        /^(0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(value) && cmp(exact(value), exact("100")) <= 0,
      "Deposit must be between 0 and 100%.",
    ),
});
export type PayrollPackageSettings = z.infer<typeof payrollPackageSettingsSchema>;
