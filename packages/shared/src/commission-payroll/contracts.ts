import { z } from "zod";
import { cmp, exact } from "./decimal.js";

const key = z.string().trim().min(1).max(128);
export const payrollDecimalSchema = z.string().regex(/^-?(0|[1-9]\d{0,11})(?:\.\d{1,4})?$/);
const nonnegative = payrollDecimalSchema.pipe(
  z.string().refine((value) => cmp(exact(value), exact("0")) >= 0, {
    message: "Amount must be nonnegative.",
  }),
);
const rate = nonnegative.pipe(
  z.string().refine((value) => cmp(exact(value), exact("100")) <= 0, {
    message: "Percentage must be between 0 and 100.",
  }),
);
export const payrollPeriodKeySchema = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
export const payrollBusinessDateSchema = z.iso.date().refine((value) => /^[1-9]\d{3}-/.test(value));
export const payrollCommissionTypeSchema = z.enum([
  "SVC",
  "PRD",
  "PKG_SALE",
  "PKG_RED",
  "FOC",
  "VP_SALE",
  "VP_SPEND",
  "GC_SALE",
]);
export const payrollCalcMethodSchema = z.enum([
  "FLAT",
  "TIER_WHOLE",
  "TIER_SLICE",
  "TIER_MIXED",
  "FIXED_PER_UNIT",
]);
export const payrollStageSchema = z.strictObject({
  key,
  name: key,
  fromMonth: z.number().int().min(1).max(1200),
  toMonth: z.number().int().min(1).max(1200).nullable(),
});
const bandSchema = z.strictObject({
  upperLimit: nonnegative.nullable(),
  ratePct: rate,
  stageRates: z.record(key, rate.nullable()).optional(),
  applyMode: z.enum(["WHOLE", "SLICE"]).default("WHOLE"),
});
export const payrollComponentSchema = z
  .strictObject({
    key,
    name: key,
    commissionTypes: z.array(payrollCommissionTypeSchema).min(1).max(8),
    categoryInclude: z.array(key).max(100).optional(),
    categoryExclude: z.array(key).max(100).optional(),
    basePct: rate,
    method: payrollCalcMethodSchema,
    flatRatePct: rate.optional(),
    fixedAmount: nonnegative.optional(),
    monthlyCap: nonnegative.nullable().optional(),
    bands: z.array(bandSchema).max(100),
    sort: z.number().int().min(0).max(1000),
  })
  .superRefine((component, ctx) => {
    const error = (message: string) => ctx.addIssue({ code: "custom", message });
    if (
      component.bands.some(
        (band) =>
          band.upperLimit !== null && !payrollDecimalSchema.safeParse(band.upperLimit).success,
      )
    )
      return;
    if (new Set(component.commissionTypes).size !== component.commissionTypes.length)
      error("Commission types must not repeat.");
    if (component.method === "FLAT" && component.flatRatePct === undefined)
      error("A flat component requires a rate.");
    if (component.method === "FIXED_PER_UNIT" && component.fixedAmount === undefined)
      error("A fixed-per-unit component requires an amount.");
    if (component.method.startsWith("TIER_")) {
      if (!component.bands.length) error("A tier component requires bands.");
      let previous = exact("0");
      component.bands.forEach((band, index) => {
        if (band.upperLimit === null) {
          if (index !== component.bands.length - 1) error("Only the last band may be uncapped.");
        } else {
          const upper = exact(band.upperLimit);
          if (cmp(upper, previous) <= 0) error("Band limits must be positive and increasing.");
          previous = upper;
          if (index === component.bands.length - 1) error("The final tier must be uncapped.");
        }
      });
    }
  });

export const payrollIncentiveSchema = z
  .strictObject({
    key,
    name: key,
    type: z.enum(["INDIVIDUAL_TARGET", "GROUP_AND_INDIVIDUAL"]),
    individualMetricTypes: z.array(payrollCommissionTypeSchema).min(1).max(8),
    groupMetric: z.enum(["SALON_CASH", "SUM_INDIVIDUAL"]),
    scope: z.enum(["SALON", "OUTLET"]),
    rows: z
      .array(
        z.strictObject({
          individualTarget: nonnegative,
          groupTarget: nonnegative.optional(),
          amount: nonnegative,
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((rule, ctx) => {
    if (
      rule.rows.some(
        (row) =>
          !payrollDecimalSchema.safeParse(row.individualTarget).success ||
          (row.groupTarget !== undefined &&
            !payrollDecimalSchema.safeParse(row.groupTarget).success),
      )
    )
      return;
    if (new Set(rule.individualMetricTypes).size !== rule.individualMetricTypes.length)
      ctx.addIssue({ code: "custom", message: "Individual metric types must not repeat." });
    if (
      rule.type === "GROUP_AND_INDIVIDUAL" &&
      rule.rows.some((row) => row.groupTarget === undefined)
    )
      ctx.addIssue({ code: "custom", message: "Group incentives require group targets." });
    for (let i = 1; i < rule.rows.length; i++) {
      const previous = rule.rows[i - 1];
      const current = rule.rows[i];
      if (
        cmp(exact(current.individualTarget), exact(previous.individualTarget)) <= 0 ||
        (rule.type === "GROUP_AND_INDIVIDUAL" &&
          cmp(exact(current.groupTarget ?? "0"), exact(previous.groupTarget ?? "0")) < 0)
      )
        ctx.addIssue({ code: "custom", message: "Incentive targets must increase in row order." });
    }
  });

export const payrollPlanDefinitionSchema = z
  .strictObject({
    stages: z.array(payrollStageSchema).max(50),
    components: z.array(payrollComponentSchema).min(1).max(100),
    incentives: z.array(payrollIncentiveSchema).max(50),
  })
  .superRefine((plan, ctx) => {
    const error = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const rows of [plan.stages, plan.components, plan.incentives])
      if (new Set(rows.map((row) => row.key)).size !== rows.length)
        error("Keys must be unique within each collection.");
    if (
      plan.components.some((component) => ["flat_rules", "package_fixed"].includes(component.key))
    )
      error("Component key is reserved for system results.");
    const stages = [...plan.stages].sort((a, b) => a.fromMonth - b.fromMonth);
    let next = 1;
    stages.forEach((stage, index) => {
      if (stage.fromMonth !== next)
        error("Stages must cover tenure without gaps or overlap starting at month 1.");
      if (stage.toMonth !== null && stage.toMonth < stage.fromMonth)
        error("Stage end precedes start.");
      if ((stage.toMonth === null) !== (index === stages.length - 1))
        error("Only the last stage must be open-ended.");
      next = (stage.toMonth ?? 0) + 1;
    });
    const stageKeys = new Set(["std", ...stages.map((stage) => stage.key)]);
    for (const component of plan.components)
      for (const band of component.bands)
        if (Object.keys(band.stageRates ?? {}).some((name) => !stageKeys.has(name)))
          error("Unknown stage rate key.");
  });

/** Credited amounts/units already include staff split. Never apply the split again. */
export const payrollBaseLineSchema = z
  .strictObject({
    id: key,
    staffId: key,
    outletId: key.nullable(),
    commissionType: payrollCommissionTypeSchema,
    baseAmount: payrollDecimalSchema,
    units: payrollDecimalSchema,
    businessDate: payrollBusinessDateSchema,
    status: z.enum(["EARNED", "REVERSED", "PAID"]),
    productCategory: key.nullable().optional(),
    mode: z.enum(["FOLLOW_PLAN", "EXCLUDE", "FIXED"]),
    fixedCommission: payrollDecimalSchema.optional(),
    /** Source-time rate resolved by the existing item/department/staff/company engine. */
    fallbackRatePct: rate.optional(),
  })
  .superRefine((line, ctx) => {
    if ((line.mode === "FIXED") !== (line.fixedCommission !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "Exactly FIXED lines require fixedCommission (including zero).",
      });
  });

export type PayrollPlanDefinition = z.infer<typeof payrollPlanDefinitionSchema>;
export type PayrollComponent = z.infer<typeof payrollComponentSchema>;
export type PayrollStage = z.infer<typeof payrollStageSchema>;
export type PayrollIncentive = z.infer<typeof payrollIncentiveSchema>;
export type PayrollBaseLine = z.infer<typeof payrollBaseLineSchema>;
export type PayrollCalcMethod = z.infer<typeof payrollCalcMethodSchema>;
export type PayrollCommissionType = z.infer<typeof payrollCommissionTypeSchema>;
