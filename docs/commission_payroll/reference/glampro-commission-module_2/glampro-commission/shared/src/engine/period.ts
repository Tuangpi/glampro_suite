/**
 * Month-end calculation for ONE staff member (FR-CAL-01..09). Pure: the caller loads data.
 * Backend service `periodService.ts` loads lines/plan/assignment from the DB and calls this.
 */
import { BaseLine, PlanComponent, PlanDefinition, StaffPeriodResult } from '../types.js';
import { D, ZERO, money2 } from '../money.js';
import { calcComponent } from './tier.js';
import { evaluateIncentive } from './incentive.js';
import { resolveStage, tenureMonth, TenureOptions } from './stage.js';

export interface StaffPeriodInput {
  staffId: string;
  periodKey: string; // "2026-09"
  joinDate: string | null;
  planId: string | null;
  planVersionId: string | null;
  definition: PlanDefinition | null;
  stageEndOverride?: number | null;
  /** All EARNED/PAID base lines of this staff member with businessDate inside the period. */
  lines: BaseLine[];
  /** Negative bases carried from last month, keyed by component key. */
  carryForward?: Record<string, string>;
  /** Group metric for GROUP_AND_INDIVIDUAL incentives (e.g. salon total cash collected). */
  groupMetric?: string | null;
  tenureOptions?: TenureOptions;
}

export function lineMatches(comp: PlanComponent, l: BaseLine): boolean {
  if (l.fixedCommission !== undefined && l.fixedCommission !== null) return false; // paid separately (FR-CAL-08)
  if (!comp.commissionTypes.includes(l.commissionType)) return false;
  const cat = l.productCategory ?? '';
  if (comp.categoryInclude?.length && !comp.categoryInclude.includes(cat)) return false;
  if (comp.categoryExclude?.length && comp.categoryExclude.includes(cat)) return false;
  return true;
}

export function sumLines(lines: BaseLine[], pred: (l: BaseLine) => boolean) {
  let base = ZERO;
  let units = 0;
  for (const l of lines) {
    if (l.status === 'REVERSED') continue;
    if (!pred(l)) continue;
    base = base.plus(D(l.baseAmount));
    units += l.units ?? 0;
  }
  return { base, units };
}

export function calculateStaffPeriod(input: StaffPeriodInput): StaffPeriodResult {
  const def = input.definition;
  const month = input.joinDate ? tenureMonth(input.joinDate, input.periodKey, input.tenureOptions) : null;
  const stage = resolveStage(def?.stages ?? [], month, input.stageEndOverride);
  const components = (def?.components ?? [])
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((comp) => {
      const { base, units } = sumLines(input.lines, (l) => lineMatches(comp, l));
      return calcComponent(comp, base, { stageKey: stage.key, units, carryForwardIn: input.carryForward?.[comp.key] });
    });

  // Package-level fixed commissions bypass the plan (FR-CAL-08)
  let fixed = ZERO;
  let fixedUnits = 0;
  for (const l of input.lines) {
    if (l.status === 'REVERSED' || l.fixedCommission === undefined || l.fixedCommission === null) continue;
    fixed = fixed.plus(D(l.fixedCommission));
    fixedUnits += l.units ?? 0;
  }
  if (!fixed.isZero()) {
    components.push({
      componentKey: 'pkg_fixed', componentName: 'Package fixed commission', method: 'FIXED_PER_UNIT', rawBase: '0.0000', pooledBase: '0.0000',
      units: fixedUnits, bandIndex: null, bandLabel: 'fixed', ratePct: null, amount: money2(fixed), capped: false, nextThreshold: null,
      gapToNext: null, carryForwardOut: '0.0000', working: [{ from: '', to: '', amount: String(fixedUnits), ratePct: '', commission: money2(fixed), kind: 'FIXED', text: `${fixedUnits} item(s) with package fixed commission = ${money2(fixed)}` }],
    });
  }

  const incentives = (def?.incentives ?? []).map((rule) => {
    const { base } = sumLines(input.lines, (l) => rule.individualMetricTypes.includes(l.commissionType));
    return evaluateIncentive(rule, base.toString(), input.groupMetric ?? null);
  });

  const commissionTotal = components.reduce((s, c) => s.plus(D(c.amount)), ZERO);
  const incentiveTotal = incentives.reduce((s, c) => s.plus(D(c.amount)), ZERO);
  return {
    staffId: input.staffId,
    periodKey: input.periodKey,
    planId: input.planId,
    planVersionId: input.planVersionId,
    tenureMonth: month,
    stageKey: stage.key,
    stageName: stage.name,
    components,
    incentives,
    commissionTotal: money2(commissionTotal),
    incentiveTotal: money2(incentiveTotal),
  };
}

/** Flat-rule fallback for staff with no plan (FR-ASN-05 / FR-CAL-09). rates: type -> pct */
export function calculateFlatFallback(staffId: string, periodKey: string, lines: BaseLine[], rates: Partial<Record<string, string>>): StaffPeriodResult {
  const comp: PlanComponent = { key: 'flat_rules', name: 'Flat rules', commissionTypes: [], basePct: '100', method: 'FLAT', bands: [], sort: 0 };
  let amt = ZERO;
  let base = ZERO;
  for (const l of lines) {
    if (l.status === 'REVERSED') continue;
    const r = rates[l.commissionType];
    if (!r) continue;
    base = base.plus(D(l.baseAmount));
    amt = amt.plus(D(l.baseAmount).mul(D(r)).div(100));
  }
  return {
    staffId, periodKey, planId: null, planVersionId: null, tenureMonth: null, stageKey: 'std', stageName: 'Standard',
    components: [{ componentKey: comp.key, componentName: comp.name, method: 'FLAT', rawBase: base.toFixed(4), pooledBase: base.toFixed(4), units: 0, bandIndex: null, bandLabel: 'flat rules', ratePct: null, amount: money2(amt.isNeg() ? 0 : amt), capped: false, nextThreshold: null, gapToNext: null, carryForwardOut: '0.0000', working: [] }],
    incentives: [], commissionTotal: money2(amt.isNeg() ? 0 : amt), incentiveTotal: '0.00',
  };
}
