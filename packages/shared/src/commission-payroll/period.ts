import { z } from "zod";
import {
  payrollBaseLineSchema,
  payrollBusinessDateSchema,
  payrollIncentiveSchema,
  payrollPeriodKeySchema,
  payrollPlanDefinitionSchema,
  payrollDecimalSchema,
  type PayrollBaseLine,
  type PayrollComponent,
  type PayrollIncentive,
  type PayrollPlanDefinition,
} from "./contracts.js";
import { calculatePayrollComponent, type PayrollComponentResult } from "./component.js";
import { add, cmp, exact, fixed, neg, percent, sum, ZERO } from "./decimal.js";
import { payrollMonthEnd, payrollTenureMonth, resolvePayrollStage } from "./stage.js";

export interface PayrollCarryBalance {
  componentKey: string;
  base: string;
  units: string;
}
export interface PayrollCarryResolution {
  fromKey: string;
  /** null = explicit write-off; authorization/audit belongs to the service. */
  toKey: string | null;
  reason: string;
}
export interface PayrollGroupMetric {
  ruleKey: string;
  periodKey: string;
  scope: "SALON" | "OUTLET";
  outletId: string | null;
  metric: "SALON_CASH" | "SUM_INDIVIDUAL";
  amount: string;
}
const carrySchema = z.strictObject({
  componentKey: z.string().min(1),
  base: payrollDecimalSchema,
  units: payrollDecimalSchema,
});
const resolutionSchema = z.strictObject({
  fromKey: z.string().min(1),
  toKey: z.string().min(1).nullable(),
  reason: z.string().trim().min(3),
});
const groupMetricSchema = z.strictObject({
  ruleKey: z.string().min(1),
  periodKey: payrollPeriodKeySchema,
  scope: z.enum(["SALON", "OUTLET"]),
  outletId: z.string().min(1).nullable(),
  metric: z.enum(["SALON_CASH", "SUM_INDIVIDUAL"]),
  amount: payrollDecimalSchema,
});
const fallbackCarrySchema = z.string().regex(/^-?(0|[1-9]\d{0,23})\.\d{10}$/);
export interface PayrollIncentiveResult {
  ruleKey: string;
  scope: "SALON" | "OUTLET";
  outletId: string | null;
  individualMetric: string;
  groupMetric: string | null;
  rowIndex: number | null;
  amount: string;
}
export interface PayrollStaffPeriodInput {
  staffId: string;
  periodKey: string;
  joinDate: string | null;
  plan: { planId: string; versionId: string; definition: PayrollPlanDefinition } | null;
  lines: PayrollBaseLine[];
  groupMetrics?: PayrollGroupMetric[];
  carryForward?: PayrollCarryBalance[];
  carryResolutions?: PayrollCarryResolution[];
  negativeBase?: "CARRY_FORWARD" | "WRITE_OFF";
  stageEndOverride?: number | null;
  joinAfterDay?: number | null;
  /** Exact resolved commission debt, not a base repriced at a future fallback rate. */
  fallbackCarryCommission?: string;
}
export interface PayrollStaffPeriodResult {
  staffId: string;
  periodKey: string;
  planId: string | null;
  versionId: string | null;
  tenureMonth: number | null;
  stageKey: string;
  components: PayrollComponentResult[];
  incentives: PayrollIncentiveResult[];
  commissionTotal: string;
  incentiveTotal: string;
  carryForward: PayrollCarryBalance[];
  carryWriteOffs: { componentKey: string; base: string; units: string; reason: string }[];
  fallbackCarryCommission: string;
}

export function evaluatePayrollIncentive(
  value: PayrollIncentive,
  individual: string,
  group: string | null,
  outletId: string | null = null,
): PayrollIncentiveResult {
  const rule = payrollIncentiveSchema.parse(value);
  if ((rule.scope === "OUTLET") !== (outletId !== null))
    throw new Error("Incentive scope requires the correct outlet.");
  const own = exact(individual);
  const groupValue = group === null ? null : exact(group);
  let reached: number | null = null;
  rule.rows.forEach((row, index) => {
    if (
      cmp(own, exact(row.individualTarget)) >= 0 &&
      (rule.type === "INDIVIDUAL_TARGET" ||
        (groupValue !== null && cmp(groupValue, exact(row.groupTarget!)) >= 0))
    )
      reached = index;
  });
  return {
    ruleKey: rule.key,
    scope: rule.scope,
    outletId,
    individualMetric: fixed(own, 4),
    groupMetric:
      rule.type === "INDIVIDUAL_TARGET" || groupValue === null ? null : fixed(groupValue, 4),
    rowIndex: reached,
    amount: reached === null ? "0.00" : fixed(exact(rule.rows[reached].amount), 2),
  };
}

function matches(component: PayrollComponent, line: PayrollBaseLine): boolean {
  const category = line.productCategory ?? "";
  return (
    line.mode === "FOLLOW_PLAN" &&
    component.commissionTypes.includes(line.commissionType) &&
    (!component.categoryInclude?.length || component.categoryInclude.includes(category)) &&
    !component.categoryExclude?.includes(category)
  );
}

export function calculatePayrollStaffPeriod(
  input: PayrollStaffPeriodInput,
): PayrollStaffPeriodResult {
  z.string().min(1).parse(input.staffId);
  payrollPeriodKeySchema.parse(input.periodKey);
  if (input.joinDate !== null) payrollBusinessDateSchema.parse(input.joinDate);
  if (input.joinDate !== null && input.joinDate > payrollMonthEnd(input.periodKey))
    throw new Error("Period precedes employment.");
  if (
    input.negativeBase !== undefined &&
    !["CARRY_FORWARD", "WRITE_OFF"].includes(input.negativeBase)
  )
    throw new Error("Invalid negative-base policy.");
  const lines = input.lines.map((line) => payrollBaseLineSchema.parse(line));
  if (new Set(lines.map((line) => line.id)).size !== lines.length)
    throw new Error("Duplicate base line IDs.");
  if (
    lines.some(
      (line) => line.staffId !== input.staffId || line.businessDate.slice(0, 7) !== input.periodKey,
    )
  )
    throw new Error("Base lines must belong to the requested staff and posting month.");
  const active = lines.filter((line) => line.status !== "REVERSED");
  const plan = input.plan ? payrollPlanDefinitionSchema.parse(input.plan.definition) : null;
  const tenure =
    input.joinDate === null
      ? null
      : payrollTenureMonth(input.joinDate, input.periodKey, input.joinAfterDay);
  const stage = resolvePayrollStage(plan?.stages ?? [], tenure, input.stageEndOverride);
  const carry = (input.carryForward ?? []).map((row) => carrySchema.parse(row));
  const resolutions = (input.carryResolutions ?? []).map((row) => resolutionSchema.parse(row));
  const fallbackCarry = exact(
    fallbackCarrySchema.parse(input.fallbackCarryCommission ?? "0.0000000000"),
  );
  if (cmp(fallbackCarry, ZERO) > 0) throw new Error("Fallback carry cannot be positive.");
  if (plan && cmp(fallbackCarry, ZERO) !== 0)
    throw new Error(
      "Plan switch requires separate explicit settlement of fallback commission debt.",
    );
  let fallbackCarryOut = "0.0000000000";
  if (
    new Set(carry.map((row) => row.componentKey)).size !== carry.length ||
    new Set(resolutions.map((row) => row.fromKey)).size !== resolutions.length
  )
    throw new Error("Duplicate carry balance or resolution.");
  const components = plan?.components ?? [];
  const keys = new Set(components.map((component) => component.key));
  if (!plan) keys.add("flat_rules");
  const mapped = new Map<string, { base: string; units: string }>();
  const writeOffs: PayrollStaffPeriodResult["carryWriteOffs"] = [];
  for (const resolution of resolutions) {
    z.string().trim().min(3).parse(resolution.reason);
    if (!carry.some((row) => row.componentKey === resolution.fromKey))
      throw new Error("Carry resolution has no balance.");
  }
  for (const balance of carry) {
    if (cmp(exact(balance.base), ZERO) > 0 || cmp(exact(balance.units), ZERO) > 0)
      throw new Error("Carry balances must not be positive.");
    const resolution = resolutions.find((row) => row.fromKey === balance.componentKey);
    const target = resolution ? resolution.toKey : balance.componentKey;
    if (target === null) {
      writeOffs.push({
        componentKey: balance.componentKey,
        base: fixed(exact(balance.base), 4),
        units: fixed(exact(balance.units), 4),
        reason: resolution!.reason,
      });
      continue;
    }
    if (!keys.has(target))
      throw new Error("Removed component carry requires explicit mapping or write-off.");
    const component = components.find((row) => row.key === target);
    if (cmp(exact(balance.units), ZERO) !== 0 && component?.method !== "FIXED_PER_UNIT")
      throw new Error("Unit carry requires a fixed-per-unit target.");
    if (cmp(exact(balance.base), ZERO) !== 0 && component?.method === "FIXED_PER_UNIT")
      throw new Error("Base carry cannot map to a fixed-unit component.");
    const prior = mapped.get(target) ?? { base: "0", units: "0" };
    mapped.set(target, {
      base: fixed(add(exact(prior.base), exact(balance.base)), 4),
      units: fixed(add(exact(prior.units), exact(balance.units)), 4),
    });
  }
  const results = [...components]
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
    .map((component) => {
      const selected = active.filter((line) => matches(component, line));
      return calculatePayrollComponent(
        component,
        fixed(sum(selected.map((line) => exact(line.baseAmount))), 4),
        {
          stageKey: stage.key,
          units: fixed(sum(selected.map((line) => exact(line.units))), 4),
          carryForwardIn: mapped.get(component.key)?.base,
          carryUnitsIn: mapped.get(component.key)?.units,
          negativeBase: input.negativeBase,
        },
      );
    });
  if (!plan) {
    const selected = active.filter((line) => line.mode === "FOLLOW_PLAN");
    if (selected.some((line) => line.fallbackRatePct === undefined))
      throw new Error(
        "Fallback requires source-time resolved rate evidence on every eligible line.",
      );
    const raw = sum(selected.map((line) => exact(line.baseAmount)));
    const amount = add(
      fallbackCarry,
      sum(selected.map((line) => percent(exact(line.baseAmount), line.fallbackRatePct!))),
    );
    // A base-only carry cannot reconstruct mixed fallback rates. Do not guess.
    if (mapped.has("flat_rules") && cmp(exact(mapped.get("flat_rules")!.base), ZERO) !== 0)
      throw new Error("Fallback carry requires rate-specific settlement or explicit write-off.");
    if (cmp(amount, ZERO) < 0 && input.negativeBase !== "WRITE_OFF")
      fallbackCarryOut = fixed(amount, 10);
    results.push(
      syntheticResult(
        "flat_rules",
        "Flat rules",
        fixed(raw, 4),
        fixed(cmp(amount, ZERO) < 0 ? ZERO : amount, 2),
      ),
    );
  }
  const fixedLines = active.filter((line) => line.mode === "FIXED");
  if (fixedLines.length)
    results.push(
      syntheticResult(
        "package_fixed",
        "Package fixed commission",
        "0.0000",
        fixed(sum(fixedLines.map((line) => exact(line.fixedCommission!))), 2),
      ),
    );
  const metrics = (input.groupMetrics ?? []).map((row) => groupMetricSchema.parse(row));
  const metricKeys = metrics.map((metric) =>
    JSON.stringify([metric.ruleKey, metric.scope, metric.outletId]),
  );
  if (new Set(metricKeys).size !== metricKeys.length) throw new Error("Duplicate group metrics.");
  metrics.forEach((metric) => {
    exact(metric.amount);
    if (
      metric.periodKey !== input.periodKey ||
      (metric.scope === "OUTLET") !== (metric.outletId !== null)
    )
      throw new Error("Group metric month/scope mismatch.");
  });
  const incentives = (plan?.incentives ?? []).flatMap((rule) => {
    const eligible = active.filter((line) =>
      rule.individualMetricTypes.includes(line.commissionType),
    );
    if (rule.scope === "OUTLET" && eligible.some((line) => line.outletId === null))
      throw new Error("Outlet incentives require evidenced outlet attribution.");
    const outlets: (string | null)[] =
      rule.scope === "SALON" ? [null] : [...new Set(eligible.map((line) => line.outletId))];
    return outlets.map((outletId) => {
      const individual = sum(
        eligible
          .filter((line) => rule.scope === "SALON" || line.outletId === outletId)
          .map((line) => exact(line.baseAmount)),
      );
      const metric = metrics.find(
        (row) => row.ruleKey === rule.key && row.scope === rule.scope && row.outletId === outletId,
      );
      if (rule.type === "GROUP_AND_INDIVIDUAL" && (!metric || metric.metric !== rule.groupMetric))
        throw new Error("A matching authoritative group metric is required.");
      return evaluatePayrollIncentive(rule, fixed(individual, 4), metric?.amount ?? null, outletId);
    });
  });
  return {
    staffId: input.staffId,
    periodKey: input.periodKey,
    planId: input.plan?.planId ?? null,
    versionId: input.plan?.versionId ?? null,
    tenureMonth: tenure,
    stageKey: stage.key,
    components: results,
    incentives,
    commissionTotal: fixed(sum(results.map((result) => exact(result.amount))), 2),
    incentiveTotal: fixed(sum(incentives.map((result) => exact(result.amount))), 2),
    carryForward: results
      .filter((result) => result.carryForwardOut !== "0.0000" || result.carryUnitsOut !== "0.0000")
      .map((result) => ({
        componentKey: result.componentKey,
        base: result.carryForwardOut,
        units: result.carryUnitsOut,
      })),
    carryWriteOffs: writeOffs,
    fallbackCarryCommission: fallbackCarryOut,
  };
}

function syntheticResult(
  key: string,
  name: string,
  base: string,
  amount: string,
): PayrollComponentResult {
  return {
    componentKey: key,
    componentName: name,
    method: key === "package_fixed" ? "FIXED_PER_UNIT" : "FLAT",
    rawBase: base,
    pooledBase: base,
    units: "0.0000",
    amount,
    bandIndex: null,
    ratePct: null,
    capped: false,
    nextThreshold: null,
    gapToNext: null,
    carryForwardOut: "0.0000",
    carryUnitsOut: "0.0000",
    working: [],
  };
}

/** Preview and actual runs share the exact same calculation entry point. */
export function previewPayrollImpact(
  inputs: PayrollStaffPeriodInput[],
  definition: PayrollPlanDefinition,
) {
  const draft = payrollPlanDefinitionSchema.parse(definition);
  const rows = inputs.map((input) => {
    if (!input.plan) throw new Error("Impact preview requires an assigned plan.");
    const before = calculatePayrollStaffPeriod(input);
    const after = calculatePayrollStaffPeriod({
      ...input,
      plan: { ...input.plan, definition: draft },
    });
    const total = (result: PayrollStaffPeriodResult) =>
      add(exact(result.commissionTotal), exact(result.incentiveTotal));
    return {
      staffId: input.staffId,
      before,
      after,
      change: fixed(add(total(after), neg(total(before))), 2),
    };
  });
  return { rows, totalChange: fixed(sum(rows.map((row) => exact(row.change))), 2) };
}
