/**
 * Commission plans, versions, publish, simulate and impact preview (FR-PLN, FR-SET).
 */
import {
  CommissionPlan, D, PlanComponent, PlanDefinition, PlanVersion, ZERO, calcComponent, money2, compareMethods, impactPreview, validatePlan,
} from '@glampro/commission-shared';
import type { CommissionRepo } from '../repo/types.js';
import { Actor, badRequest, conflict, forbidden, newId, notFound, nowIso, periodKeyOf, periodRange } from './util.js';

export class PlanService {
  constructor(private repo: CommissionRepo) {}

  async list(salonId: string) {
    const plans = await this.repo.listPlans(salonId);
    const staff = await this.repo.listStaff(salonId);
    const today = new Date().toISOString().slice(0, 10);
    const counts: Record<string, number> = {};
    for (const s of staff.filter((x) => x.active)) {
      const a = await this.assignmentAt(s.id, today);
      if (a) counts[a.planId] = (counts[a.planId] ?? 0) + 1;
    }
    return Promise.all(plans.map(async (p) => {
      const versions = await this.repo.listVersions(p.id);
      const current = this.effectiveVersion(versions, today);
      const draft = versions.find((v) => v.status === 'DRAFT') ?? null;
      return { ...p, staffCount: counts[p.id] ?? 0, currentVersion: current, draftVersion: draft, versionCount: versions.length };
    }));
  }

  async get(planId: string) {
    const plan = await this.repo.getPlan(planId);
    if (!plan) throw notFound('Plan');
    const versions = await this.repo.listVersions(planId);
    return { plan, versions };
  }

  async create(actor: Actor, input: { name: string; description?: string; positions: string[]; definition: PlanDefinition; copyFromPlanId?: string }) {
    this.requireAdmin(actor);
    const plan: CommissionPlan = { id: newId('plan'), salonId: actor.salonId, name: input.name, description: input.description, positions: input.positions, status: 'ACTIVE' };
    await this.repo.savePlan(plan);
    let def = input.definition;
    if (input.copyFromPlanId) {
      const src = await this.repo.listVersions(input.copyFromPlanId);
      const cur = this.effectiveVersion(src, new Date().toISOString().slice(0, 10)) ?? src[src.length - 1];
      if (cur) def = cur.definition;
    }
    const v: PlanVersion = { id: newId('pv'), planId: plan.id, versionNo: 1, effectiveFrom: new Date().toISOString().slice(0, 10), reason: 'Created', status: 'DRAFT', definition: def };
    await this.repo.saveVersion(v);
    await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'PLAN_CREATE', entity: 'plan', entityId: plan.id, after: plan });
    return { plan, draft: v };
  }

  async update(actor: Actor, planId: string, patch: Partial<Pick<CommissionPlan, 'name' | 'description' | 'positions' | 'status'>>) {
    this.requireAdmin(actor);
    const plan = await this.repo.getPlan(planId);
    if (!plan) throw notFound('Plan');
    const next = { ...plan, ...patch };
    await this.repo.savePlan(next);
    await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'PLAN_UPDATE', entity: 'plan', entityId: planId, before: plan, after: next });
    return next;
  }

  /** Create or replace the single DRAFT version of a plan. */
  async saveDraft(actor: Actor, planId: string, definition: PlanDefinition) {
    this.requireAdmin(actor);
    const versions = await this.repo.listVersions(planId);
    if (!versions.length && !(await this.repo.getPlan(planId))) throw notFound('Plan');
    const existing = versions.find((v) => v.status === 'DRAFT');
    const v: PlanVersion = existing
      ? { ...existing, definition }
      : { id: newId('pv'), planId, versionNo: Math.max(0, ...versions.map((x) => x.versionNo)) + 1, effectiveFrom: new Date().toISOString().slice(0, 10), reason: '', status: 'DRAFT', definition };
    await this.repo.saveVersion(v);
    return { version: v, validation: validatePlan(definition) };
  }

  /** FR-SET-11 / FR-PLN-07 */
  async publish(actor: Actor, versionId: string, effectiveFrom: string, reason: string) {
    if (actor.role !== 'SUPER_ADMIN') throw forbidden('Only Super admin can publish commission plans');
    if (!reason?.trim()) throw badRequest('Change reason is required');
    const v = await this.repo.getVersion(versionId);
    if (!v) throw notFound('Version');
    if (v.status !== 'DRAFT') throw conflict('Only a draft can be published');
    const val = validatePlan(v.definition);
    if (val.errors.length) throw badRequest('Plan has errors', val.errors);
    const period = await this.repo.getPeriod(actor.salonId, periodKeyOf(effectiveFrom));
    if (period?.status === 'APPROVED') throw conflict(`Effective date is inside approved period ${period.periodKey}`);
    const others = (await this.repo.listVersions(v.planId)).filter((x) => x.status === 'PUBLISHED' && x.effectiveFrom === effectiveFrom);
    if (others.length) throw conflict('Another published version already starts on this date');
    const pub: PlanVersion = { ...v, status: 'PUBLISHED', effectiveFrom, reason, publishedBy: actor.userId, publishedAt: nowIso() };
    await this.repo.saveVersion(pub);
    await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'PLAN_PUBLISH', entity: 'plan_version', entityId: v.id, after: { effectiveFrom, versionNo: v.versionNo }, reason });
    return { version: pub, warnings: val.warnings };
  }

  /** Published version effective on a date (one published version per date – FR-PLN-02). */
  effectiveVersion(versions: PlanVersion[], onDate: string): PlanVersion | null {
    return versions.filter((v) => v.status === 'PUBLISHED' && v.effectiveFrom <= onDate).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
  }

  async assignmentAt(staffId: string, onDate: string) {
    const list = await this.repo.listAssignments(staffId);
    return list.filter((a) => a.fromDate <= onDate && (a.toDate === null || a.toDate >= onDate)).sort((a, b) => b.fromDate.localeCompare(a.fromDate))[0] ?? null;
  }

  /** Test calculator + method comparison (FR-SET-07/08). */
  simulate(component: PlanComponent, base: string, stageKey = 'std', units = 0) {
    return { result: calcComponent(component, base, { stageKey, units }), compare: compareMethods(component, base, stageKey) };
  }

  /** Impact preview: last closed month, published vs draft for staff on this plan (FR-SET-10). */
  async impact(actor: Actor, planId: string, draft: PlanDefinition, periodKey: string) {
    const versions = await this.repo.listVersions(planId);
    const { from, to } = periodRange(periodKey);
    const published = this.effectiveVersion(versions, to);
    if (!published) throw badRequest('Plan has no published version for that month');
    const staff = await this.repo.listStaff(actor.salonId);
    const onPlan = [];
    for (const s of staff) {
      const a = await this.assignmentAt(s.id, to);
      if (a?.planId === planId) onPlan.push({ staffId: s.id, staffName: s.name, joinDate: s.joinDate, stageEndOverride: s.stageEndOverride, lines: await this.repo.listLines({ salonId: actor.salonId, staffId: s.id, from, to }) });
    }
    const all = await this.repo.listLines({ salonId: actor.salonId, from, to, types: ['SVC', 'PKG_SALE', 'PRD', 'VP_SALE'] });
    const group = money2(all.reduce((s, l) => s.plus(D(l.baseAmount)), ZERO));
    return impactPreview(periodKey, published.definition, draft, onPlan, group);
  }

  /** Permissions table SRS §4.11: only Super admin creates / edits / publishes plans. */
  private requireAdmin(actor: Actor) {
    if (actor.role !== 'SUPER_ADMIN') throw forbidden('Only Super admin can change commission plans');
  }
}
