/**
 * Month-end: calculate, statements, adjustments, approve & lock, export (FR-CAL, FR-PAY, FR-RPT).
 */
import {
  BaseLine, D, StaffPeriodResult, ZERO, calculateFlatFallback, calculateStaffPeriod, money2,
} from '@glampro/commission-shared';
import type { Adjustment, CommissionPeriod, CommissionRepo } from '../repo/types.js';
import { PlanService } from './planService.js';
import { Actor, badRequest, conflict, forbidden, newId, nowIso, periodRange, prevPeriodKey } from './util.js';

/** Commission types that represent cash collected (used for "collection" and the group metric). */
export const CASH_TYPES = ['SVC', 'PKG_SALE', 'PRD', 'VP_SALE'] as const;

export class PeriodService {
  private plans: PlanService;
  constructor(private repo: CommissionRepo) {
    this.plans = new PlanService(repo);
  }

  async getOrCreate(salonId: string, periodKey: string): Promise<CommissionPeriod> {
    if (!/^\d{4}-\d{2}$/.test(periodKey)) throw badRequest('Period must be YYYY-MM');
    return (await this.repo.getPeriod(salonId, periodKey)) ?? this.repo.savePeriod({ id: newId('per'), salonId, periodKey, status: 'OPEN', calculatedAt: null, approvedBy: null, approvedAt: null });
  }

  /** Salon total cash collected in the period (group metric, FR-INC-04). */
  async groupMetric(salonId: string, periodKey: string): Promise<string> {
    const { from, to } = periodRange(periodKey);
    const lines = await this.repo.listLines({ salonId, from, to, types: [...CASH_TYPES] });
    return money2(lines.reduce((s, l) => s.plus(D(l.baseAmount)), ZERO));
  }

  /** Calculate one staff member for any period (also used for month-to-date estimates). */
  async calculateStaff(salonId: string, staffId: string, periodKey: string, linesOverride?: BaseLine[], group?: string): Promise<StaffPeriodResult> {
    const staff = await this.repo.getStaff(staffId);
    const { from, to } = periodRange(periodKey);
    const lines = linesOverride ?? (await this.repo.listLines({ salonId, staffId, from, to }));
    const settings = await this.repo.getSettings(salonId);
    const a = await this.plans.assignmentAt(staffId, to); // D-5: assignment on last day of the month
    if (!a) return calculateFlatFallback(staffId, periodKey, lines, settings.fallbackRates);
    const v = this.plans.effectiveVersion(await this.repo.listVersions(a.planId), to);
    if (!v) return calculateFlatFallback(staffId, periodKey, lines, settings.fallbackRates);
    const prev = settings.negativeBase === 'CARRY_FORWARD' ? (await this.repo.listResults(salonId, prevPeriodKey(periodKey))).find((r) => r.staffId === staffId) : undefined;
    const carry: Record<string, string> = {};
    prev?.components.forEach((c) => { if (!D(c.carryForwardOut).isZero()) carry[c.componentKey] = c.carryForwardOut; });
    return calculateStaffPeriod({
      staffId, periodKey, joinDate: staff?.joinDate ?? null, planId: a.planId, planVersionId: v.id, definition: v.definition,
      stageEndOverride: staff?.stageEndOverride, lines, carryForward: carry, groupMetric: group ?? (await this.groupMetric(salonId, periodKey)),
      tenureOptions: { joinAfterDayCountsNextMonth: settings.joinAfterDayCountsNextMonth },
    });
  }

  /** FR-CAL-01: run / re-run for an OPEN or CALCULATED period. Manual adjustments are kept. */
  async calculate(actor: Actor, periodKey: string) {
    if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'MANAGER') throw forbidden();
    const p = await this.getOrCreate(actor.salonId, periodKey);
    if (p.status === 'APPROVED') throw conflict('Period is approved and locked');
    const group = await this.groupMetric(actor.salonId, periodKey);
    const staff = (await this.repo.listStaff(actor.salonId)).filter((s) => s.active);
    const results: StaffPeriodResult[] = [];
    for (const s of staff) results.push(await this.calculateStaff(actor.salonId, s.id, periodKey, undefined, group));
    await this.repo.saveResults(actor.salonId, periodKey, results);
    const saved = await this.repo.savePeriod({ ...p, status: 'CALCULATED', calculatedAt: nowIso() });
    await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'PERIOD_CALCULATE', entity: 'period', entityId: periodKey });
    return { period: saved, groupMetric: group, results };
  }

  async addAdjustment(actor: Actor, a: Omit<Adjustment, 'id' | 'salonId' | 'createdBy' | 'createdAt'>) {
    if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'MANAGER') throw forbidden();
    if (!a.reason?.trim()) throw badRequest('Reason is required');
    const p = await this.getOrCreate(actor.salonId, a.periodKey);
    if (p.status === 'APPROVED') throw conflict('Period is locked – add the adjustment to the next open month');
    return this.repo.saveAdjustment({ ...a, amount: money2(a.amount), id: newId('adj'), salonId: actor.salonId, createdBy: actor.userId, createdAt: nowIso() });
  }

  /** Statement lines for one staff member (FR-PAY-03/04). */
  async statement(salonId: string, periodKey: string, staffId: string) {
    const results = await this.repo.listResults(salonId, periodKey);
    const r = results.find((x) => x.staffId === staffId) ?? (await this.calculateStaff(salonId, staffId, periodKey));
    const staff = await this.repo.getStaff(staffId);
    const { from, to } = periodRange(periodKey);
    const profile = await this.repo.getPayrollProfile(staffId, to);
    const adj = (await this.repo.listAdjustments(salonId, periodKey)).filter((a) => a.staffId === staffId);
    const sumKind = (k: Adjustment['kind']) => adj.filter((a) => a.kind === k).reduce((s, a) => s.plus(D(a.amount)), ZERO);
    const lines = await this.repo.listLines({ salonId, staffId, from, to });
    const collection = lines.filter((l) => (CASH_TYPES as readonly string[]).includes(l.commissionType)).reduce((s, l) => s.plus(D(l.baseAmount)), ZERO);
    const basic = D(profile?.basicSalary ?? '0');
    const fixedOt = D(profile?.fixedOt ?? '0');
    const commission = D(r.commissionTotal).plus(sumKind('COMMISSION_ADJ'));
    const takeHome = basic.plus(fixedOt).minus(sumKind('UNPAID_LEAVE')).plus(commission).plus(D(r.incentiveTotal)).plus(sumKind('OVERTIME')).plus(sumKind('ADDITION')).minus(sumKind('DEDUCTION'));
    const fwl = D(profile?.fwlLevy ?? '0');
    const ratio = collection.gt(0) ? takeHome.plus(fwl).div(collection).mul(100) : null;
    return {
      staff, periodKey, result: r, adjustments: adj,
      payroll: {
        basicSalary: money2(basic), fixedOt: money2(fixedOt), unpaidLeave: money2(sumKind('UNPAID_LEAVE')), commission: money2(commission),
        incentive: r.incentiveTotal, overtime: money2(sumKind('OVERTIME')), additions: money2(sumKind('ADDITION')), deductions: money2(sumKind('DEDUCTION')),
        takeHome: money2(takeHome), fwlLevy: money2(fwl), collection: money2(collection),
        payrollSalesPct: ratio ? ratio.toDecimalPlaces(1).toFixed(1) : null,
        alert: ratio !== null && profile ? ratio.gt(D(profile.payrollSalesAlertPct)) : false,
      },
    };
  }

  async summary(salonId: string, periodKey: string) {
    const p = await this.getOrCreate(salonId, periodKey);
    const staff = await this.repo.listStaff(salonId);
    const rows = [];
    for (const s of staff.filter((x) => x.active)) rows.push(await this.statement(salonId, periodKey, s.id));
    return { period: p, groupMetric: await this.groupMetric(salonId, periodKey), rows };
  }

  /** FR-PAY-01: Super admin approves; lines become PAID and the period is read-only. */
  async approve(actor: Actor, periodKey: string) {
    if (actor.role !== 'SUPER_ADMIN') throw forbidden('Only Super admin can approve');
    const p = await this.getOrCreate(actor.salonId, periodKey);
    if (p.status !== 'CALCULATED') throw conflict('Calculate the period before approving');
    const { from, to } = periodRange(periodKey);
    for (const l of await this.repo.listLines({ salonId: actor.salonId, from, to })) if (l.status === 'EARNED') await this.repo.updateLineStatus(l.id, 'PAID');
    const saved = await this.repo.savePeriod({ ...p, status: 'APPROVED', approvedBy: actor.userId, approvedAt: nowIso() });
    await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'PERIOD_APPROVE', entity: 'period', entityId: periodKey });
    return saved;
  }

  /** FR-PAY-05: CSV export (opens in Excel). One row per staff × component + payroll lines. */
  async exportCsv(salonId: string, periodKey: string): Promise<string> {
    const s = await this.summary(salonId, periodKey);
    const out: string[][] = [['Period', 'Staff', 'Plan stage', 'Line', 'Base', 'Band', 'Rate %', 'Amount']];
    for (const row of s.rows) {
      const name = row.staff?.name ?? row.result.staffId;
      for (const c of row.result.components) out.push([periodKey, name, row.result.stageName, c.componentName, c.pooledBase, c.bandLabel, c.ratePct ?? '', c.amount]);
      for (const i of row.result.incentives) out.push([periodKey, name, row.result.stageName, `Incentive: ${i.name}`, i.individualMetric, '', '', i.amount]);
      const p = row.payroll;
      for (const [k, v] of Object.entries({ 'Basic salary': p.basicSalary, 'Fixed OT': p.fixedOt, 'Unpaid leave (-)': p.unpaidLeave, Overtime: p.overtime, Additions: p.additions, 'Deductions (-)': p.deductions, 'TOTAL TAKE-HOME': p.takeHome, 'FWL levy (company)': p.fwlLevy, Collection: p.collection, 'Payroll/Sales %': p.payrollSalesPct ?? '' })) out.push([periodKey, name, '', k, '', '', '', v]);
    }
    return out.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  }
}
