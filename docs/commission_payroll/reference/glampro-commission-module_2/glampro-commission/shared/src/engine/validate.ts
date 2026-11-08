/**
 * Plan validation before publish (FR-PLN-07, FR-SET-05) and "jump" warnings (FR-SET-09).
 */
import { PlanDefinition } from '../types.js';
import { D, fmt } from '../money.js';
import { bandRate } from './tier.js';

export interface ValidationResult { errors: string[]; warnings: string[] }

export function validatePlan(def: PlanDefinition): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!def.components.length) errors.push('A plan needs at least one component.');
  const keys = new Set<string>();
  for (const c of def.components) {
    const p = `Component “${c.name}”`;
    if (keys.has(c.key)) errors.push(`${p}: duplicate key ${c.key}.`);
    keys.add(c.key);
    if (!c.commissionTypes.length) warnings.push(`${p}: no sales types selected – it will always be 0.`);
    const bp = D(c.basePct || '100');
    if (bp.lt(0) || bp.gt(100)) errors.push(`${p}: base % must be 0–100.`);
    if (c.method === 'FLAT') {
      const r = D(c.flatRatePct ?? '0');
      if (r.lt(0) || r.gt(100)) errors.push(`${p}: rate must be 0–100%.`);
    }
    if (c.method === 'FIXED_PER_UNIT' && D(c.fixedAmount ?? '0').lt(0)) errors.push(`${p}: fixed amount cannot be negative.`);
    if (c.method.startsWith('TIER_')) {
      if (!c.bands.length) errors.push(`${p}: add at least one band.`);
      let last = D(0);
      c.bands.forEach((b, i) => {
        const isLast = i === c.bands.length - 1;
        if ((b.upperLimit === null || b.upperLimit === '') && !isLast) errors.push(`${p}: only the last band may have no upper limit.`);
        if (b.upperLimit !== null && b.upperLimit !== '') {
          if (D(b.upperLimit).lte(last)) errors.push(`${p}: band limits must increase (band ${i + 1}).`);
          last = D(b.upperLimit);
        }
        const rates = [b.ratePct, ...Object.values(b.stageRates ?? {}).filter((x): x is string => !!x)];
        if (rates.some((r) => D(r).lt(0) || D(r).gt(100))) errors.push(`${p}: band ${i + 1} rate must be 0–100%.`);
      });
      if (c.method === 'TIER_WHOLE') {
        const jumps: string[] = [];
        for (let i = 1; i < c.bands.length; i++) {
          const lim = c.bands[i - 1].upperLimit;
          if (!lim) continue;
          const jump = D(lim).mul(bandRate(c.bands[i], 'std').minus(bandRate(c.bands[i - 1], 'std'))).div(100);
          if (jump.gte(100)) jumps.push(`+S$${fmt(jump)} at S$${fmt(lim)}`);
        }
        if (jumps.length) warnings.push(`${p}: whole-amount tiers make commission jump when sales pass a band limit (${jumps.join(', ')}). Use “Mixed” or “By slice” if this is not intended.`);
      }
    }
  }
  const sk = new Set<string>();
  for (const s of def.stages) {
    if (sk.has(s.key)) errors.push(`Duplicate stage key ${s.key}.`);
    sk.add(s.key);
    if (s.fromMonth < 1) errors.push(`Stage “${s.name}” must start at month 1 or later.`);
    if (s.toMonth !== null && s.toMonth < s.fromMonth) errors.push(`Stage “${s.name}”: end month before start month.`);
  }
  for (const r of def.incentives) {
    if (r.type === 'GROUP_AND_INDIVIDUAL' && r.rows.some((x) => !x.groupTarget)) errors.push(`Incentive “${r.name}”: every row needs a group target.`);
  }
  return { errors, warnings };
}
