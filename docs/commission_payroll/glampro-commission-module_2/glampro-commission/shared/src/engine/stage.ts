/**
 * Tenure stages (FR-STG). Tenure month for period P = (yearP - yearJoin) * 12 + monthP - monthJoin + 1.
 * The join month is month 1. Optional rule: joined after day N => month 1 starts next month.
 */
import { PlanStage } from '../types.js';

export interface TenureOptions {
  /** If set, staff who join AFTER this day of month start counting from the following month (FR-STG-05). */
  joinAfterDayCountsNextMonth?: number | null;
}

/** periodKey "2026-09"; joinDate "2026-09-10" */
export function tenureMonth(joinDate: string, periodKey: string, opts: TenureOptions = {}): number {
  const [jy, jm, jd] = joinDate.split('-').map(Number);
  const [py, pm] = periodKey.split('-').map(Number);
  let m = (py - jy) * 12 + (pm - jm) + 1;
  if (opts.joinAfterDayCountsNextMonth && jd > opts.joinAfterDayCountsNextMonth) m -= 1;
  return m;
}

export const STANDARD_STAGE: PlanStage = { key: 'std', name: 'Standard', fromMonth: 1, toMonth: null };

/**
 * Stage whose month range contains the tenure month. `stageEndOverride` lets an admin extend /
 * shorten the FIRST stage for one staff member (FR-STG-04): the first stage then ends at that month.
 */
export function resolveStage(stages: PlanStage[], month: number | null, stageEndOverride?: number | null): PlanStage {
  if (!stages.length || month === null) return STANDARD_STAGE;
  const sorted = [...stages].sort((a, b) => a.fromMonth - b.fromMonth);
  if (stageEndOverride && sorted.length > 1) {
    if (month <= stageEndOverride) return sorted[0];
    return sorted.find((s, i) => i > 0 && (s.toMonth === null || month <= s.toMonth)) ?? sorted[sorted.length - 1];
  }
  const hit = sorted.find((s) => month >= s.fromMonth && (s.toMonth === null || month <= s.toMonth));
  if (hit) return hit;
  return month < sorted[0].fromMonth ? sorted[0] : sorted[sorted.length - 1];
}

/** Human schedule for the staff screen, e.g. [{stage, from:"2026-09", to:"2026-11"}, ...] */
export function stageSchedule(stages: PlanStage[], joinDate: string, opts: TenureOptions = {}) {
  const [jy, jm, jd] = joinDate.split('-').map(Number);
  let startIdx = jy * 12 + (jm - 1);
  if (opts.joinAfterDayCountsNextMonth && jd > opts.joinAfterDayCountsNextMonth) startIdx += 1;
  const key = (idx: number) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  return [...stages]
    .sort((a, b) => a.fromMonth - b.fromMonth)
    .map((s) => ({ stage: s, from: key(startIdx + s.fromMonth - 1), to: s.toMonth === null ? null : key(startIdx + s.toMonth - 1) }));
}
