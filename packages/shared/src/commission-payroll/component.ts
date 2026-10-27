import {
  payrollComponentSchema,
  payrollDecimalSchema,
  type PayrollCalcMethod,
  type PayrollComponent,
} from "./contracts.js";
import {
  add,
  cmp,
  div,
  exact,
  fixed,
  min,
  mul,
  neg,
  percent,
  ZERO,
  type Exact,
} from "./decimal.js";

export interface PayrollWorkingLine {
  kind: "BASE" | "CARRY" | "FLAT" | "WHOLE" | "SLICE" | "FIXED" | "CAP";
  base: string;
  ratePct: string | null;
  amount: string;
}

export interface PayrollComponentResult {
  componentKey: string;
  componentName: string;
  method: PayrollCalcMethod;
  rawBase: string;
  pooledBase: string;
  units: string;
  bandIndex: number | null;
  ratePct: string | null;
  amount: string;
  capped: boolean;
  nextThreshold: string | null;
  gapToNext: string | null;
  carryForwardOut: string;
  carryUnitsOut: string;
  working: PayrollWorkingLine[];
}

export interface PayrollComponentOptions {
  stageKey?: string;
  units?: string;
  carryForwardIn?: string;
  carryUnitsIn?: string;
  negativeBase?: "CARRY_FORWARD" | "WRITE_OFF";
}

/** Pure calculator used by both monthly results and settings previews. */
export function calculatePayrollComponent(
  value: PayrollComponent,
  rawBase: string,
  options: PayrollComponentOptions = {},
): PayrollComponentResult {
  const component = payrollComponentSchema.parse(value);
  payrollDecimalSchema.parse(rawBase);
  if (options.units !== undefined) payrollDecimalSchema.parse(options.units);
  if (
    component.method === "FIXED_PER_UNIT" &&
    options.carryForwardIn !== undefined &&
    cmp(exact(options.carryForwardIn), ZERO) !== 0
  )
    throw new Error("Fixed-unit components require unit carry, not base carry.");
  if (
    component.method !== "FIXED_PER_UNIT" &&
    options.carryUnitsIn !== undefined &&
    cmp(exact(options.carryUnitsIn), ZERO) !== 0
  )
    throw new Error("Percentage components cannot consume unit carry.");
  const stage = options.stageKey ?? "std";
  const carry = exact(options.carryForwardIn ?? "0");
  const carryUnits = exact(options.carryUnitsIn ?? "0");
  if (cmp(carry, ZERO) > 0 || cmp(carryUnits, ZERO) > 0)
    throw new Error("Carry-forward balances must not be positive.");
  if (
    options.negativeBase !== undefined &&
    !["CARRY_FORWARD", "WRITE_OFF"].includes(options.negativeBase)
  )
    throw new Error("Invalid negative-base policy.");
  // Ledger/result pool precision is four decimals. Round once after pooling and
  // base percentage, not on every source line or tier slice.
  const raw = exact(rawBase);
  const adjusted = exact(fixed(percent(raw, component.basePct), 4));
  const base = add(adjusted, carry);
  const units = add(exact(options.units ?? "0"), carryUnits);
  const result: PayrollComponentResult = {
    componentKey: component.key,
    componentName: component.name,
    method: component.method,
    rawBase: fixed(raw, 4),
    pooledBase: fixed(base, 4),
    units: fixed(units, 4),
    bandIndex: null,
    ratePct: null,
    amount: "0.00",
    capped: false,
    nextThreshold: null,
    gapToNext: null,
    carryForwardOut: "0.0000",
    carryUnitsOut: "0.0000",
    working: [
      { kind: "BASE", base: fixed(adjusted, 4), ratePct: component.basePct, amount: "0.00" },
    ],
  };
  if (cmp(carry, ZERO) !== 0 || cmp(carryUnits, ZERO) !== 0)
    result.working.push({ kind: "CARRY", base: fixed(carry, 4), ratePct: null, amount: "0.00" });
  const keepNegative = options.negativeBase !== "WRITE_OFF";
  let amount = ZERO;
  if (component.method === "FIXED_PER_UNIT") {
    // Fractional credited units prevent each split recipient earning a full award.
    if (cmp(units, ZERO) < 0) result.carryUnitsOut = keepNegative ? fixed(units, 4) : "0.0000";
    else amount = mul(units, exact(component.fixedAmount!));
    result.working.push({
      kind: "FIXED",
      base: fixed(units, 4),
      ratePct: null,
      amount: fixed(amount, 2),
    });
  } else if (cmp(base, ZERO) <= 0) {
    result.carryForwardOut = keepNegative ? fixed(base, 4) : "0.0000";
  } else if (component.method === "FLAT") {
    result.ratePct = component.flatRatePct!;
    amount = percent(base, result.ratePct);
    result.working.push({
      kind: "FLAT",
      base: fixed(base, 4),
      ratePct: result.ratePct,
      amount: fixed(amount, 2),
    });
  } else {
    const bands = component.bands;
    const reached = bands.findIndex(
      (band) => band.upperLimit === null || cmp(base, exact(band.upperLimit)) <= 0,
    );
    result.bandIndex = reached;
    const bandRate = (index: number) => bands[index].stageRates?.[stage] ?? bands[index].ratePct;
    result.ratePct = bandRate(reached);
    const upper = bands[reached].upperLimit;
    if (upper !== null) {
      result.nextThreshold = fixed(exact(upper), 4);
      // Threshold is exclusive. Four-decimal bases advance by 0.0001, not a cent.
      result.gapToNext = fixed(add(add(exact(upper), neg(base)), exact("0.0001")), 4);
    }
    let lastWhole = -1;
    for (let i = 0; i <= reached; i++) {
      const whole =
        component.method === "TIER_WHOLE" ||
        (component.method === "TIER_MIXED" && bands[i].applyMode === "WHOLE");
      if (whole) lastWhole = i;
    }
    const append = (kind: "WHOLE" | "SLICE", covered: Exact, index: number) => {
      const part = percent(covered, bandRate(index));
      amount = add(amount, part);
      result.working.push({
        kind,
        base: fixed(covered, 4),
        ratePct: bandRate(index),
        amount: fixed(part, 2),
      });
    };
    if (lastWhole >= 0)
      append(
        "WHOLE",
        lastWhole === reached ? base : exact(bands[lastWhole].upperLimit!),
        lastWhole,
      );
    for (let i = lastWhole + 1; i <= reached; i++) {
      const lower = i === 0 ? ZERO : exact(bands[i - 1].upperLimit!);
      const hi = bands[i].upperLimit === null ? base : min(base, exact(bands[i].upperLimit!));
      append("SLICE", add(hi, neg(lower)), i);
    }
  }
  if (
    component.monthlyCap !== undefined &&
    component.monthlyCap !== null &&
    cmp(amount, exact(component.monthlyCap)) > 0
  ) {
    amount = exact(component.monthlyCap);
    result.capped = true;
    result.working.push({ kind: "CAP", base: "0.0000", ratePct: null, amount: fixed(amount, 2) });
  }
  result.amount = fixed(amount, 2);
  return result;
}

export function comparePayrollMethods(
  component: PayrollComponent,
  base: string,
  options: PayrollComponentOptions = {},
) {
  if (!component.method.startsWith("TIER_")) return [];
  return (["TIER_WHOLE", "TIER_SLICE", "TIER_MIXED"] as const).map((method) => ({
    method,
    result: calculatePayrollComponent({ ...component, method }, base, options),
  }));
}

/** Exact-string chart data; callers may convert to pixels, never back into payroll. */
export function payrollCommissionCurve(
  component: PayrollComponent,
  maximum: string,
  steps = 100,
  options: PayrollComponentOptions = {},
) {
  if (!Number.isInteger(steps) || steps < 1 || steps > 1000)
    throw new Error("Invalid chart step count.");
  const max = exact(maximum);
  if (cmp(max, ZERO) < 0) throw new Error("Chart maximum must be nonnegative.");
  return Array.from({ length: steps + 1 }, (_, index) => {
    const base = fixed(div(mul(max, exact(String(index))), exact(String(steps))), 4);
    return { base, methods: comparePayrollMethods(component, base, options) };
  });
}
