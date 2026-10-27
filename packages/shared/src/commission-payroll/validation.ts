import { payrollPlanDefinitionSchema } from "./contracts.js";
import { add, cmp, exact, fixed, neg, percent } from "./decimal.js";

export function validatePayrollPlan(value: unknown): { errors: string[]; warnings: string[] } {
  const parsed = payrollPlanDefinitionSchema.safeParse(value);
  if (!parsed.success)
    return {
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      warnings: [],
    };
  const warnings: string[] = [];
  for (const component of parsed.data.components) {
    if (component.method !== "TIER_WHOLE" && component.method !== "TIER_MIXED") continue;
    for (let index = 1; index < component.bands.length; index++) {
      const current = component.bands[index];
      if (component.method === "TIER_MIXED" && current.applyMode !== "WHOLE") continue;
      const previous = component.bands[index - 1];
      const jump = percent(
        exact(previous.upperLimit!),
        fixed(add(exact(current.ratePct), neg(exact(previous.ratePct))), 4),
      );
      if (cmp(jump, exact("0")) > 0)
        warnings.push(
          `${component.name}: whole-amount jump ${fixed(jump, 2)} above ${fixed(exact(previous.upperLimit!), 4)} (standard rates).`,
        );
    }
  }
  return { errors: [], warnings };
}
