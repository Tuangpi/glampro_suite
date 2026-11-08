/**
 * Component calculator – turns ONE component's pooled monthly base into commission.
 * Pure function: no database, no dates. Used by the month-end engine, the settings
 * test calculator, the impact preview and the POS month-to-date estimate (FR-CAL-04, FR-SET-07).
 *
 * Band semantics: band i covers base > upper(i-1) and <= upper(i). upper = null => no cap.
 *
 *  TIER_WHOLE : amount = rate(k) × base                               (k = band containing base)
 *  TIER_SLICE : amount = Σ_{i<=k} slice(i) × rate(i)
 *  TIER_MIXED : j = highest band <= k with applyMode WHOLE
 *               amount = rate(j) × min(base, upper(j)) + Σ_{i=j+1..k} slice(i) × rate(i)
 *               (no WHOLE band reached => same as TIER_SLICE)
 *  Stage rates replace band rates. Monthly cap is applied last. Result rounded 2 dp half-up.
 */
import { CalcMethod, ComponentResult, PlanComponent, TierBand, WorkingLine } from '../types.js';
import { D, Decimal, ZERO, fmt, fmtPct, money2, money4, pct } from '../money.js';

export interface CalcOptions {
  /** Stage key, e.g. "std" or "new". Default "std". */
  stageKey?: string;
  /** Override the component's method (used by "compare methods"). */
  methodOverride?: CalcMethod;
  /** Units for FIXED_PER_UNIT. */
  units?: number;
  /** Negative base carried in from the previous month for this component. */
  carryForwardIn?: string;
  /** If true the raw base is already multiplied by basePct (default false). */
  baseAlreadyAdjusted?: boolean;
}

export function bandRate(band: TierBand, stageKey: string): Decimal {
  const s = band.stageRates?.[stageKey];
  return D(s !== undefined && s !== null && s !== '' ? s : band.ratePct);
}

/** Index of the band that contains `base` (base must be > 0). */
export function findBandIndex(bands: TierBand[], base: Decimal): number {
  for (let i = 0; i < bands.length; i++) {
    const up = bands[i].upperLimit;
    if (up === null || up === '' || base.lte(D(up))) return i;
  }
  return bands.length - 1;
}

function lowerOf(bands: TierBand[], i: number): Decimal {
  return i === 0 ? ZERO : D(bands[i - 1].upperLimit);
}

function bandLabel(bands: TierBand[], i: number): string {
  const lo = lowerOf(bands, i);
  const up = bands[i].upperLimit;
  const from = i === 0 ? '0' : fmt(lo.plus('0.01'));
  return up === null || up === '' ? `above ${fmt(lo)}` : `${from} – ${fmt(up)}`;
}

export function calcComponent(comp: PlanComponent, rawBaseIn: string | Decimal, opts: CalcOptions = {}): ComponentResult {
  const stageKey = opts.stageKey ?? 'std';
  const method = opts.methodOverride ?? comp.method;
  const units = opts.units ?? 0;
  const rawBase = D(rawBaseIn);
  let base = opts.baseAlreadyAdjusted ? rawBase : rawBase.mul(pct(comp.basePct || '100'));
  base = base.plus(D(opts.carryForwardIn ?? '0'));
  const working: WorkingLine[] = [];
  const result: ComponentResult = {
    componentKey: comp.key,
    componentName: comp.name,
    method,
    rawBase: money4(rawBase),
    pooledBase: money4(base),
    units,
    bandIndex: null,
    bandLabel: '—',
    ratePct: null,
    amount: '0.00',
    capped: false,
    nextThreshold: null,
    gapToNext: null,
    carryForwardOut: '0.0000',
    working,
  };

  if (D(comp.basePct || '100').lt(100) && !opts.baseAlreadyAdjusted) {
    working.push(info(`Base ${fmt(rawBase)} × ${fmtPct(comp.basePct)} = ${fmt(rawBase.mul(pct(comp.basePct)))}`));
  }
  if (opts.carryForwardIn && !D(opts.carryForwardIn).isZero()) {
    working.push(info(`Carried forward from last month: ${fmt(opts.carryForwardIn)}`));
  }

  // FIXED_PER_UNIT does not depend on base.
  if (method === 'FIXED_PER_UNIT') {
    const amt = D(comp.fixedAmount ?? '0').mul(units);
    working.push({ from: '', to: '', amount: String(units), ratePct: '', commission: money2(amt), kind: 'FIXED', text: `${units} × S$${fmt(comp.fixedAmount ?? '0')} = ${fmt(amt)}` });
    return finish(comp, result, amt);
  }

  if (base.lte(0)) {
    result.carryForwardOut = money4(base.isNeg() ? base : ZERO);
    working.push(info(base.isNeg() ? `Negative base ${fmt(base)} – no commission, carried to next month` : 'No base this month'));
    return finish(comp, result, ZERO);
  }

  if (method === 'FLAT') {
    const r = D(comp.flatRatePct ?? '0');
    const amt = base.mul(pct(r));
    result.ratePct = r.toString();
    result.bandLabel = 'flat';
    working.push({ from: '0', to: money2(base), amount: money2(base), ratePct: r.toString(), commission: money2(amt), kind: 'FLAT', text: `${fmt(base)} × ${fmtPct(r)} = ${fmt(amt)}` });
    return finish(comp, result, amt);
  }

  const bands = comp.bands;
  if (!bands.length) {
    working.push(info('No tier bands defined'));
    return finish(comp, result, ZERO);
  }
  const k = findBandIndex(bands, base);
  result.bandIndex = k;
  result.bandLabel = bandLabel(bands, k);
  result.ratePct = bandRate(bands[k], stageKey).toString();
  const up = bands[k].upperLimit;
  if (up !== null && up !== '' && k < bands.length - 1) {
    result.nextThreshold = money2(up);
    result.gapToNext = money2(D(up).minus(base).plus('0.01'));
  }

  const modeOf = (i: number): 'WHOLE' | 'SLICE' =>
    method === 'TIER_WHOLE' ? 'WHOLE' : method === 'TIER_SLICE' ? 'SLICE' : bands[i].applyMode ?? 'WHOLE';

  let j = -1;
  for (let i = 0; i <= k; i++) if (modeOf(i) === 'WHOLE') j = i;

  let amt = ZERO;
  if (j >= 0) {
    const covered = j === k ? base : D(bands[j].upperLimit);
    const r = bandRate(bands[j], stageKey);
    const c = covered.mul(pct(r));
    amt = amt.plus(c);
    working.push({ from: '1', to: money2(covered), amount: money2(covered), ratePct: r.toString(), commission: money2(c), kind: 'WHOLE', text: `$1 – ${fmt(covered)} × ${fmtPct(r)} = ${fmt(c)}` });
  }
  for (let i = j + 1; i <= k; i++) {
    const lo = lowerOf(bands, i);
    const hi = i === k ? base : D(bands[i].upperLimit);
    const slice = hi.minus(lo);
    if (slice.lte(0)) continue;
    const r = bandRate(bands[i], stageKey);
    const c = slice.mul(pct(r));
    amt = amt.plus(c);
    working.push({ from: money2(lo), to: money2(hi), amount: money2(slice), ratePct: r.toString(), commission: money2(c), kind: 'SLICE', text: `${fmt(lo)} – ${fmt(hi)} (slice ${fmt(slice)}) × ${fmtPct(r)} = ${fmt(c)}` });
  }
  return finish(comp, result, amt);
}

function finish(comp: PlanComponent, result: ComponentResult, amt: Decimal): ComponentResult {
  let a = amt;
  if (comp.monthlyCap !== undefined && comp.monthlyCap !== null && comp.monthlyCap !== '' && a.gt(D(comp.monthlyCap))) {
    a = D(comp.monthlyCap);
    result.capped = true;
    result.working.push(info(`Capped at S$${fmt(comp.monthlyCap)} per month`, 'CAP'));
  }
  result.amount = money2(a);
  return result;
}

function info(text: string, kind: WorkingLine['kind'] = 'INFO'): WorkingLine {
  return { from: '', to: '', amount: '', ratePct: '', commission: '', kind, text };
}

/** Same base under every tier method (FR-SET-08). Returns [] for non-tier components. */
export function compareMethods(comp: PlanComponent, rawBase: string, stageKey = 'std') {
  if (comp.method === 'FLAT' || comp.method === 'FIXED_PER_UNIT') return [];
  return (['TIER_WHOLE', 'TIER_SLICE', 'TIER_MIXED'] as const).map((m) => ({
    method: m,
    amount: calcComponent(comp, rawBase, { stageKey, methodOverride: m }).amount,
  }));
}

/** Points for the "commission vs monthly base" chart (FR-SET-08). Base here is pooled base. */
export function curve(comp: PlanComponent, method: CalcMethod, maxBase: number, steps = 120, stageKey = 'std') {
  const pts: { base: number; amount: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const b = (maxBase * i) / steps;
    const r = calcComponent(comp, String(b), { stageKey, methodOverride: method, baseAlreadyAdjusted: true });
    pts.push({ base: b, amount: Number(r.amount) });
  }
  return pts;
}
