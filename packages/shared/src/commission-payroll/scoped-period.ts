import {
  calculatePayrollStaffPeriod,
  partitionPayrollOutletLines,
  type PayrollStaffPeriodInput,
  type PayrollStaffPeriodResult,
} from "./period.js";
import { exact, fixed, sum } from "./decimal.js";
import { z } from "zod";

/** Statement orchestration only. The low-level plan calculator still rejects
 * unpartitioned activity. Source-time fallback rates never reprice plan debt. */
export function calculateScopedPayrollStaffPeriod(
  input: PayrollStaffPeriodInput,
): PayrollStaffPeriodResult {
  if (!input.plan?.outletIds?.length) return calculatePayrollStaffPeriod(input);
  const partition = partitionPayrollOutletLines(input.lines, input.plan.outletIds);
  const fallbackDebt = z
    .string()
    .regex(/^-?(0|[1-9]\d{0,23})\.\d{10}$/)
    .parse(input.fallbackCarryCommission ?? "0.0000000000");
  if (/[1-9]/.test(fallbackDebt) && !fallbackDebt.startsWith("-"))
    throw new Error("Fallback carry cannot be positive.");
  const hasDebt = /[1-9]/.test(fallbackDebt);
  if (hasDebt && !partition.fallbackLines.some((line) => line.status !== "REVERSED"))
    throw new Error(
      "Plan switch requires separate explicit settlement of fallback commission debt.",
    );
  const plan = calculatePayrollStaffPeriod({
    ...input,
    lines: partition.planLines,
    fallbackCarryCommission: "0.0000000000",
  });
  if (!partition.fallbackLines.length && !hasDebt) return plan;
  const fallback = calculatePayrollStaffPeriod({
    ...input,
    plan: null,
    lines: partition.fallbackLines,
    carryForward: [],
    carryResolutions: [],
    groupMetrics: [],
    fallbackCarryCommission: fallbackDebt,
  });
  // FIXED awards can occur on either side. Pool the original exact awards and
  // round once, rather than summing independently rounded partition awards.
  const components = [...plan.components];
  for (const component of fallback.components) {
    const existing = components.find((row) => row.componentKey === component.componentKey);
    if (!existing) components.push(component);
    else if (component.componentKey !== "package_fixed")
      throw new Error("Scoped payroll component identity conflict.");
  }
  const fixedComponent = components.find((row) => row.componentKey === "package_fixed");
  if (fixedComponent)
    fixedComponent.amount = fixed(
      sum(
        input.lines
          .filter((line) => line.status !== "REVERSED" && line.mode === "FIXED")
          .map((line) => exact(line.fixedCommission!)),
      ),
      2,
    );
  return {
    ...plan,
    components,
    commissionTotal: fixed(sum(components.map((row) => exact(row.amount))), 2),
    carryForward: [...plan.carryForward, ...fallback.carryForward],
    carryWriteOffs: [...plan.carryWriteOffs, ...fallback.carryWriteOffs],
    fallbackCarryCommission: fallback.fallbackCarryCommission,
  };
}
