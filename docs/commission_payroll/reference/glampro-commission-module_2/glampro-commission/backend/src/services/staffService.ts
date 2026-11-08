/**
 * Staff plan assignment, payroll profile, stage schedule and the settings dashboard overview (FR-ASN, FR-SET-01, FR-RPT-04).
 */
import { D, money2, resolveStage, stageSchedule, tenureMonth } from '@glampro/commission-shared';
import type { CommissionRepo, PayrollProfile, StaffInfo } from '../repo/types.js';
import { PlanService } from './planService.js';
import { PeriodService } from './periodService.js';
import { Actor, badRequest, forbidden, newId, notFound, nowIso, periodKeyOf, todayInTz } from './util.js';

export class StaffService {
  private plans: PlanService;
  private periods: PeriodService;
  constructor(private repo: CommissionRepo) {
    this.plans = new PlanService(repo);
    this.periods = new PeriodService(repo);
  }

  /** Commission section of the Edit staff screen (C6). */
  async commissionProfile(salonId: string, staffId: string) {
    const s = await this.repo.getStaff(staffId);
    if (!s || s.salonId !== salonId) throw notFound('Staff');
    const today = todayInTz();
    const history = await this.repo.listAssignments(staffId);
    const current = await this.plans.assignmentAt(staffId, today);
    const plan = current ? await this.repo.getPlan(current.planId) : null;
    const version = current ? this.plans.effectiveVersion(await this.repo.listVersions(current.planId), today) : null;
    const settings = await this.repo.getSettings(salonId);
    const opts = { joinAfterDayCountsNextMonth: settings.joinAfterDayCountsNextMonth };
    const month = s.joinDate ? tenureMonth(s.joinDate, periodKeyOf(today), opts) : null;
    const stage = version ? resolveStage(version.definition.stages, month, s.stageEndOverride) : null;
    const schedule = version && s.joinDate ? stageSchedule(version.definition.stages, s.joinDate, opts) : [];
    return { staff: s, current, plan, version, tenureMonth: month, stage, schedule, history, payroll: await this.repo.getPayrollProfile(staffId, today) };
  }

  /** FR-ASN-01/02: assign a plan from a date; closes the previous open assignment. */
  async assignPlan(actor: Actor, staffId: string, input: { planId: string; fromDate: string; reason: string; joinDate?: string }) {
    if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'MANAGER') throw forbidden();
    if (!input.reason?.trim()) throw badRequest('Reason is required');
    const s = await this.repo.getStaff(staffId);
    if (!s) throw notFound('Staff');
    if (!(await this.repo.getPlan(input.planId))) throw notFound('Plan');
    if (input.joinDate) await this.repo.saveStaff({ ...s, joinDate: input.joinDate });
    else if (!s.joinDate) throw badRequest('Join date is required');
    const list = await this.repo.listAssignments(staffId);
    for (const a of list) {
      if (a.toDate === null && a.fromDate < input.fromDate) {
        const d = new Date(input.fromDate + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        await this.repo.saveAssignment({ ...a, toDate: d.toISOString().slice(0, 10) });
      } else if (a.fromDate >= input.fromDate) {
        throw badRequest('An assignment already starts on or after this date – change that one instead');
      }
    }
    const a = await this.repo.saveAssignment({ id: newId('asg'), staffId, planId: input.planId, fromDate: input.fromDate, toDate: null, reason: input.reason, createdBy: actor.userId, createdAt: nowIso() });
    await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'PLAN_ASSIGN', entity: 'staff', entityId: staffId, after: a, reason: input.reason });
    return a;
  }

  async setStageOverride(actor: Actor, staffId: string, endMonth: number | null, reason: string) {
    if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'MANAGER') throw forbidden();
    if (!reason?.trim()) throw badRequest('Reason is required');
    const s = await this.repo.getStaff(staffId);
    if (!s) throw notFound('Staff');
    const next: StaffInfo = { ...s, stageEndOverride: endMonth };
    await this.repo.saveStaff(next);
    await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'STAGE_OVERRIDE', entity: 'staff', entityId: staffId, before: s.stageEndOverride, after: endMonth, reason });
    return next;
  }

  async savePayrollProfile(actor: Actor, p: PayrollProfile) {
    if (actor.role !== 'SUPER_ADMIN') throw forbidden('Only Super admin can change salary data');
    return this.repo.savePayrollProfile({ ...p, basicSalary: money2(p.basicSalary), fixedOt: money2(p.fixedOt), fwlLevy: money2(p.fwlLevy) });
  }

  /** Dashboard header cards + month-to-date per staff (FR-SET-01, FR-RPT-04, C2). */
  async overview(salonId: string, periodKey = periodKeyOf(todayInTz())) {
    const plans = await this.plans.list(salonId);
    const staff = (await this.repo.listStaff(salonId)).filter((s) => s.active);
    const group = await this.periods.groupMetric(salonId, periodKey);
    const rows = [];
    let withoutPlan = 0;
    for (const s of staff) {
      const r = await this.periods.calculateStaff(salonId, s.id, periodKey, undefined, group);
      if (!r.planId) withoutPlan++;
      const tier = r.components.find((c) => c.bandIndex !== null && D(c.pooledBase).gt(0)) ?? r.components.find((c) => c.method.startsWith('TIER_'));
      const plan = plans.find((p) => p.id === r.planId);
      rows.push({
        staffId: s.id, name: s.name, joinDate: s.joinDate, planName: plan?.name ?? 'Flat fallback', stage: r.stageName, tenureMonth: r.tenureMonth,
        mainComponent: tier?.componentName ?? null, mainBase: tier?.pooledBase ?? '0', currentRate: tier?.ratePct ?? null, gapToNext: tier?.gapToNext ?? null,
        estimate: money2(D(r.commissionTotal).plus(D(r.incentiveTotal))),
      });
    }
    return {
      periodKey,
      cards: { activePlans: plans.filter((p) => p.status === 'ACTIVE').length, staffOnPlan: staff.length - withoutPlan, staffWithoutPlan: withoutPlan, drafts: plans.filter((p) => p.draftVersion).length },
      groupMetric: group,
      rows,
    };
  }
}
