/**
 * Impact preview (FR-SET-10): re-run a closed month with published rules vs a draft.
 */
import { BaseLine, PlanDefinition } from '../types.js';
import { D, ZERO, money2 } from '../money.js';
import { calculateStaffPeriod } from './period.js';

export interface ImpactStaffInput {
  staffId: string;
  staffName: string;
  joinDate: string | null;
  stageEndOverride?: number | null;
  lines: BaseLine[];
  carryForward?: Record<string, string>;
}

export function impactPreview(periodKey: string, published: PlanDefinition, draft: PlanDefinition, staff: ImpactStaffInput[], groupMetric: string | null) {
  const rows = staff.map((s) => {
    const base = { staffId: s.staffId, periodKey, joinDate: s.joinDate, planId: null, planVersionId: null, stageEndOverride: s.stageEndOverride, lines: s.lines, carryForward: s.carryForward, groupMetric };
    const a = calculateStaffPeriod({ ...base, definition: published });
    const b = calculateStaffPeriod({ ...base, definition: draft });
    const pub = D(a.commissionTotal).plus(D(a.incentiveTotal));
    const drf = D(b.commissionTotal).plus(D(b.incentiveTotal));
    return { staffId: s.staffId, staffName: s.staffName, stage: b.stageName, published: money2(pub), draft: money2(drf), change: money2(drf.minus(pub)) };
  });
  const tp = rows.reduce((s, r) => s.plus(D(r.published)), ZERO);
  const td = rows.reduce((s, r) => s.plus(D(r.draft)), ZERO);
  return { periodKey, rows, totalPublished: money2(tp), totalDraft: money2(td), totalChange: money2(td.minus(tp)) };
}
