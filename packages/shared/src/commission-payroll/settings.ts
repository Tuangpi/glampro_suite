import { z } from "zod";
import {
  payrollBusinessDateSchema,
  payrollPlanDefinitionSchema,
  payrollDecimalSchema,
} from "./contracts.js";

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().min(3).max(1000);
const revision = z.number().int().nonnegative();
const money = payrollDecimalSchema.refine(
  (value) => !value.startsWith("-"),
  "Must be nonnegative.",
);
const percentage = money.refine((value) => Number(value) <= 100, "Maximum is 100%.");
export const payrollPlanMetadataSchema = z.strictObject({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(2000),
  positions: z.array(id).max(100),
  outletIds: z.array(id).max(100),
});
export const payrollCreatePlanSchema = payrollPlanMetadataSchema.extend({
  definition: payrollPlanDefinitionSchema,
  reason,
});
export const payrollSaveDraftSchema = z.strictObject({
  expectedRevision: revision,
  effectiveFrom: payrollBusinessDateSchema,
  definition: payrollPlanDefinitionSchema,
  reason,
});
export const payrollRevisionSchema = z.strictObject({ expectedRevision: revision, reason });
export const payrollAssignmentWriteSchema = z.strictObject({
  expectedRevision: revision,
  staffIds: z
    .array(id)
    .min(1)
    .max(100)
    .refine((values) => new Set(values).size === values.length),
  planId: id.nullable(),
  fromDate: payrollBusinessDateSchema,
  reason,
});
export const payrollStaffSettingsSchema = z.strictObject({
  expectedRevision: revision,
  expectedJoinDate: payrollBusinessDateSchema.nullable(),
  joinDate: payrollBusinessDateSchema,
  stageEndOverride: z.number().int().min(0).max(1200).nullable(),
  /** Omitted preserves the audited classification; legacy staff remain unclassified. */
  commissionRole: z.enum(["COMMISSION_EARNING", "NON_COMMISSION"]).optional(),
  reason,
});
export const payrollProfileSchema = z.strictObject({
  basicSalary: money,
  fixedOvertime: money,
  levy: money,
  salesAlertPct: percentage,
});
export const payrollProfileWriteSchema = payrollProfileSchema.extend({
  expectedRevision: revision,
  reason,
});
export const payrollSettingsSchema = z.strictObject({
  joinAfterDay: z.number().int().min(1).max(31).nullable(),
  negativeBase: z.enum(["CARRY_FORWARD", "WRITE_OFF"]),
  minimumDepositPct: percentage,
  refundAdminFee: money,
  requireAttribution: z.boolean(),
});
export const payrollSettingsWriteSchema = payrollSettingsSchema.extend({
  expectedRevision: revision,
  reason,
});
export const PAYROLL_DEFAULT_SETTINGS: z.infer<typeof payrollSettingsSchema> = {
  joinAfterDay: null,
  negativeBase: "CARRY_FORWARD",
  minimumDepositPct: "30",
  refundAdminFee: "100",
  requireAttribution: true,
};

export type PayrollPlanMetadata = z.infer<typeof payrollPlanMetadataSchema>;
export type PayrollCreatePlan = z.infer<typeof payrollCreatePlanSchema>;
export type PayrollSaveDraft = z.infer<typeof payrollSaveDraftSchema>;
export type PayrollRevision = z.infer<typeof payrollRevisionSchema>;
export type PayrollAssignmentWrite = z.infer<typeof payrollAssignmentWriteSchema>;
export type PayrollStaffSettingsWrite = z.infer<typeof payrollStaffSettingsSchema>;
export type PayrollProfileWrite = z.infer<typeof payrollProfileWriteSchema>;
export type PayrollSettingsWrite = z.infer<typeof payrollSettingsWriteSchema>;
