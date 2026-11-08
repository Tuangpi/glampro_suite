/**
 * Engine tests – mirror the acceptance cases in SRS v1.2 §9 (TC-xx) and the September 2026
 * reconciliation (E1, E2). Run: npm test -w shared
 */
import { describe, expect, it } from 'vitest';
import {
  BaseLine, HAIR_2022, TP_MANI_PEDI_2019, PlanComponent, PlanDefinition, allocateBySplit, calcComponent, calculateStaffPeriod,
  canRedeem, compareMethods, impactPreview, paidSessions, refundAmount, resolveStage, sessionValue, stageSchedule, tenureMonth,
  validatePlan, valuePackageSpendBase,
} from '../src/index.js';

const comp = (def: PlanDefinition, key: string) => def.components.find((c) => c.key === key)!;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
let n = 0;
const line = (staffId: string, t: BaseLine['commissionType'], amt: string, extra: Partial<BaseLine> = {}): BaseLine => ({
  id: `l${++n}`, salonId: 's1', staffId, commissionType: t, baseAmount: amt, splitPct: '100', units: 1, businessDate: '2026-09-15',
  sourceType: 'SALE_LINE', sourceId: 'x', status: 'EARNED', createdBy: 'test', createdAt: '2026-09-15T00:00:00Z', ...extra,
});

describe('Tier methods (FR-CAL-04)', () => {
  const cashPkg = comp(HAIR_2022, 'cash_pkg');
  const onCourse = comp(HAIR_2022, 'on_course');

  it('TC-01 Hair component 1, 6,830 → 546.40 (8% whole)', () => {
    const r = calcComponent(cashPkg, '6830');
    expect(r.amount).toBe('546.40');
    expect(r.ratePct).toBe('8');
    expect(r.gapToNext).toBe('3170.01');
  });
  it('TC-02 on course whole amount 8,985.50 → 628.99', () => {
    expect(calcComponent(onCourse, '8985.50').amount).toBe('628.99');
  });
  it('TC-03 on course by slice → 488.99', () => {
    expect(calcComponent(onCourse, '8985.50', { methodOverride: 'TIER_SLICE' }).amount).toBe('488.99');
  });
  it('TC-04 band boundaries 4,000 / 4,000.01 / 6,000 / 6,000.01', () => {
    expect(['4000', '4000.01', '6000', '6000.01'].map((b) => calcComponent(cashPkg, b).amount)).toEqual(['0.00', '160.00', '240.00', '480.00']);
  });
  it('E3 / TC-21 12,000 whole 1,200 · slice 600 · mixed 1,000', () => {
    expect(compareMethods(cashPkg, '12000')).toEqual([
      { method: 'TIER_WHOLE', amount: '1200.00' },
      { method: 'TIER_SLICE', amount: '600.00' },
      { method: 'TIER_MIXED', amount: '1000.00' },
    ]);
  });
  it('TC-22 monthly cap', () => {
    const c: PlanComponent = { ...onCourse, monthlyCap: '500' };
    const r = calcComponent(c, '8985.50');
    expect(r.amount).toBe('500.00');
    expect(r.capped).toBe(true);
  });
  it('FOC base 50% → 492 × 50% × 5% = 12.30', () => {
    expect(calcComponent(comp(HAIR_2022, 'foc'), '492').amount).toBe('12.30');
  });
  it('FIXED_PER_UNIT', () => {
    const c: PlanComponent = { key: 'f', name: 'f', commissionTypes: ['FOC'], basePct: '100', method: 'FIXED_PER_UNIT', fixedAmount: '5', bands: [], sort: 1 };
    expect(calcComponent(c, '0', { units: 3 }).amount).toBe('15.00');
  });
  it('TC-13 negative base → 0 and carried forward', () => {
    const r = calcComponent(cashPkg, '-500');
    expect(r.amount).toBe('0.00');
    expect(r.carryForwardOut).toBe('-500.0000');
    expect(calcComponent(cashPkg, '6000', { carryForwardIn: '-500' }).amount).toBe('220.00');
  });
});

describe('Stages (FR-STG)', () => {
  it('TC-05/06 joined 10 Sep: Oct = month 2 New staff; Dec = month 4 Standard', () => {
    expect(tenureMonth('2026-09-10', '2026-10')).toBe(2);
    expect(resolveStage(HAIR_2022.stages, 2).key).toBe('new');
    expect(resolveStage(HAIR_2022.stages, 4).key).toBe('std');
    const c = comp(HAIR_2022, 'cash_pkg');
    expect(calcComponent(c, '3600', { stageKey: 'new' }).amount).toBe('144.00');
    expect(calcComponent(c, '3600', { stageKey: 'std' }).amount).toBe('0.00');
  });
  it('join after day N rule and override', () => {
    expect(tenureMonth('2026-09-20', '2026-10', { joinAfterDayCountsNextMonth: 15 })).toBe(1);
    expect(resolveStage(HAIR_2022.stages, 4, 5).key).toBe('new');
    expect(stageSchedule(HAIR_2022.stages, '2026-09-10')).toEqual([
      { stage: HAIR_2022.stages[0], from: '2026-09', to: '2026-11' },
      { stage: HAIR_2022.stages[1], from: '2026-12', to: null },
    ]);
  });
});

describe('September 2026 reconciliation', () => {
  it('E1 Alvin – Hair plan (FOC at 50% rule) = 1,187.69', () => {
    const r = calculateStaffPeriod({
      staffId: 'alvin', periodKey: '2026-09', joinDate: '2020-01-01', planId: 'p', planVersionId: 'v', definition: HAIR_2022,
      lines: [line('alvin', 'SVC', '159'), line('alvin', 'PKG_SALE', '6671'), line('alvin', 'PKG_RED', '8985.50'), line('alvin', 'FOC', '492')],
      groupMetric: '46210',
    });
    expect(r.components.map((c) => c.amount)).toEqual(['546.40', '0.00', '628.99', '12.30']);
    expect(r.commissionTotal).toBe('1187.69');
    expect(r.incentiveTotal).toBe('0.00');
  });
  it('E2 Stella – TP plan = 1,971.62 + S$50 personal target', () => {
    const r = calculateStaffPeriod({
      staffId: 'stella', periodKey: '2026-09', joinDate: '2019-01-01', planId: 'p', planVersionId: 'v', definition: TP_MANI_PEDI_2019,
      lines: [line('stella', 'SVC', '1087'), line('stella', 'PKG_RED', '12071.84'), line('stella', 'PRD', '78'), line('stella', 'PKG_SALE', '9256.31')],
    });
    expect(r.commissionTotal).toBe('1971.62');
    expect(r.incentiveTotal).toBe('50.00');
  });
  it('E2 on cash-collected basis: package 8,688 → 608.16 and no incentive', () => {
    const r = calculateStaffPeriod({
      staffId: 'stella', periodKey: '2026-09', joinDate: '2019-01-01', planId: 'p', planVersionId: 'v', definition: TP_MANI_PEDI_2019,
      lines: [line('stella', 'SVC', '1087'), line('stella', 'PKG_RED', '12071.84'), line('stella', 'PRD', '78'), line('stella', 'PKG_SALE', '8688')],
    });
    expect(r.components.find((c) => c.componentKey === 'package')!.amount).toBe('608.16');
    expect(r.incentiveTotal).toBe('0.00');
  });
  it('E7 group + individual incentive pays highest row met', () => {
    const r = calculateStaffPeriod({
      staffId: 'a', periodKey: '2026-09', joinDate: '2020-01-01', planId: 'p', planVersionId: 'v', definition: HAIR_2022,
      lines: [line('a', 'SVC', '15500')], groupMetric: '46210',
    });
    expect(r.incentiveTotal).toBe('200.00');
  });
  it('TP beauty products use their own 5% component', () => {
    const r = calculateStaffPeriod({
      staffId: 'j', periodKey: '2026-09', joinDate: '2020-01-01', planId: 'p', planVersionId: 'v', definition: TP_MANI_PEDI_2019,
      lines: [line('j', 'PRD', '100', { productCategory: 'Beauty' }), line('j', 'PRD', '100', { productCategory: 'Hair care' })],
    });
    expect(r.components.find((c) => c.componentKey === 'product')!.amount).toBe('10.00');
    expect(r.components.find((c) => c.componentKey === 'beauty')!.amount).toBe('5.00');
  });
});

describe('Packages, splits, refunds (D-7, D-8)', () => {
  it('session value and paid sessions', () => {
    const sv = sessionValue('5000', 5);
    expect(sv).toBe('1000.0000');
    expect(paidSessions('2000', sv, 5)).toBe(2);
    expect(canRedeem({ cashCollected: '2000', sessionValue: sv, sessionsTotal: 5, sessionsUsed: 2 }).ok).toBe(false); // TC-10
    expect(canRedeem({ cashCollected: '5000', sessionValue: sv, sessionsTotal: 5, sessionsUsed: 2 }).ok).toBe(true);
    expect(paidSessions('1000', sessionValue('3000', 9), 9)).toBe(3); // 333.3333 session value
  });
  it('split allocation adds up exactly', () => {
    const parts = allocateBySplit('1000.01', [{ splitPct: '33.33' }, { splitPct: '33.33' }, { splitPct: '33.34' }]);
    const sum = parts.reduce((s, p) => s + Number(p.amount) * 10000, 0) / 10000;
    expect(sum).toBe(1000.01);
    expect(() => allocateBySplit('10', [{ splitPct: '60' }])).toThrow();
  });
  it('E6 refund = 5,000 − 2 × 1,000 − 100 = 2,900', () => {
    expect(refundAmount('5000', 2, '1000', '100')).toBe('2900.00');
    expect(refundAmount('1000', 2, '1000', '100')).toBe('0.00');
  });
  it('TC-17 value package spend base 100 × 500/600 = 83.33', () => {
    expect(valuePackageSpendBase('100', '500', '600')).toBe('83.3333');
  });
});

describe('Validation and impact (FR-PLN-07, FR-SET-09/10)', () => {
  it('TC-24 decreasing band limits are blocked', () => {
    const d = clone(HAIR_2022);
    d.components[0].bands[1].upperLimit = '3000';
    expect(validatePlan(d).errors.length).toBeGreaterThan(0);
  });
  it('jump warning for whole-amount tiers', () => {
    expect(validatePlan(HAIR_2022).warnings.some((w) => w.includes('7,000.00'))).toBe(true);
  });
  it('TC-23/25 impact preview: switching On course to by slice costs Alvin −140.00', () => {
    const draft = clone(HAIR_2022);
    draft.components.find((c) => c.key === 'on_course')!.method = 'TIER_SLICE';
    const res = impactPreview('2026-09', HAIR_2022, draft, [
      { staffId: 'alvin', staffName: 'Alvin', joinDate: '2020-01-01', lines: [line('alvin', 'PKG_RED', '8985.50')] },
    ], '46210');
    expect(res.rows[0].change).toBe('-140.00');
    expect(res.totalChange).toBe('-140.00');
  });
});
