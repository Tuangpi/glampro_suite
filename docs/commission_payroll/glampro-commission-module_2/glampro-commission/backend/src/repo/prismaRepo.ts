/**
 * PostgreSQL implementation via Prisma (schema: backend/prisma/schema.prisma).
 * Decimal columns are converted to strings at this boundary – the rest of the code never sees Prisma types.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { BaseLine, CommissionPlan, PlanDefinition, PlanVersion, StaffPeriodResult, StaffSplit } from '@glampro/commission-shared';
import { DEFAULT_SETTINGS } from './memoryRepo.js';
import type {
  Adjustment, AuditEntry, CommissionPeriod, CommissionRepo, HoldingCommission, LineFilter, PayrollProfile, PlanAssignment,
  SalonCommissionSettings, SessionUsage, StaffInfo,
} from './types.js';

const s = (v: { toString(): string } | null | undefined): string | null => (v === null || v === undefined ? null : v.toString());
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const json = (v: unknown) => v as Prisma.InputJsonValue;

export class PrismaRepo implements CommissionRepo {
  constructor(private db: PrismaClient) {}

  // ---------- plans ----------
  async listPlans(salonId: string): Promise<CommissionPlan[]> {
    const rows = await this.db.commPlan.findMany({ where: { salonId }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, salonId: r.salonId, name: r.name, description: r.description ?? undefined, positions: r.positions, status: r.status as CommissionPlan['status'] }));
  }
  async getPlan(id: string) {
    const r = await this.db.commPlan.findUnique({ where: { id } });
    return r ? { id: r.id, salonId: r.salonId, name: r.name, description: r.description ?? undefined, positions: r.positions, status: r.status as CommissionPlan['status'] } : null;
  }
  async savePlan(p: CommissionPlan) {
    const data = { salonId: p.salonId, name: p.name, description: p.description ?? null, positions: p.positions, status: p.status };
    await this.db.commPlan.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
    return p;
  }
  private toVersion(r: { id: string; planId: string; versionNo: number; effectiveFrom: string; reason: string; status: string; definition: unknown; publishedBy: string | null; publishedAt: Date | null }): PlanVersion {
    return { id: r.id, planId: r.planId, versionNo: r.versionNo, effectiveFrom: r.effectiveFrom, reason: r.reason, status: r.status as PlanVersion['status'], definition: r.definition as PlanDefinition, publishedBy: r.publishedBy, publishedAt: iso(r.publishedAt) };
  }
  async listVersions(planId: string) {
    return (await this.db.commPlanVersion.findMany({ where: { planId }, orderBy: { versionNo: 'asc' } })).map((r) => this.toVersion(r));
  }
  async getVersion(id: string) {
    const r = await this.db.commPlanVersion.findUnique({ where: { id } });
    return r ? this.toVersion(r) : null;
  }
  async saveVersion(v: PlanVersion) {
    const data = { planId: v.planId, versionNo: v.versionNo, effectiveFrom: v.effectiveFrom, reason: v.reason, status: v.status, definition: json(v.definition), publishedBy: v.publishedBy ?? null, publishedAt: v.publishedAt ? new Date(v.publishedAt) : null };
    await this.db.commPlanVersion.upsert({ where: { id: v.id }, create: { id: v.id, ...data }, update: data });
    return v;
  }

  // ---------- staff ----------
  async listStaff(salonId: string): Promise<StaffInfo[]> {
    return (await this.db.commStaff.findMany({ where: { salonId }, orderBy: { name: 'asc' } })).map((r) => ({ ...r }));
  }
  async getStaff(id: string) {
    const r = await this.db.commStaff.findUnique({ where: { id } });
    return r ? { ...r } : null;
  }
  async saveStaff(st: StaffInfo) {
    const { id, ...data } = st;
    await this.db.commStaff.upsert({ where: { id }, create: st, update: data });
    return st;
  }
  async listAssignments(staffId: string): Promise<PlanAssignment[]> {
    return (await this.db.commStaffPlanAssignment.findMany({ where: { staffId }, orderBy: { fromDate: 'asc' } })).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
  async saveAssignment(a: PlanAssignment) {
    const data = { staffId: a.staffId, planId: a.planId, fromDate: a.fromDate, toDate: a.toDate, reason: a.reason, createdBy: a.createdBy, createdAt: new Date(a.createdAt) };
    await this.db.commStaffPlanAssignment.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data });
    return a;
  }

  // ---------- holdings & sessions ----------
  async getHolding(id: string): Promise<HoldingCommission | null> {
    const r = await this.db.commHolding.findUnique({ where: { id } });
    if (!r) return null;
    return {
      id: r.id, salonId: r.salonId, customerId: r.customerId, packageId: r.packageId, packageName: r.packageName, netPrice: s(r.netPrice)!, sessionsTotal: r.sessionsTotal,
      sessionsUsed: r.sessionsUsed, sessionValue: s(r.sessionValue)!, cashCollected: s(r.cashCollected)!, sellers: r.sellers as unknown as StaffSplit[],
      saleCommMode: r.saleCommMode as HoldingCommission['saleCommMode'], saleFixedAmount: s(r.saleFixedAmount), redCommMode: r.redCommMode as HoldingCommission['redCommMode'],
      redFixedAmount: s(r.redFixedAmount), status: r.status as HoldingCommission['status'], createdAt: r.createdAt.toISOString(),
    };
  }
  async saveHolding(h: HoldingCommission) {
    const data = {
      salonId: h.salonId, customerId: h.customerId, packageId: h.packageId, packageName: h.packageName, netPrice: h.netPrice, sessionsTotal: h.sessionsTotal, sessionsUsed: h.sessionsUsed,
      sessionValue: h.sessionValue, cashCollected: h.cashCollected, sellers: json(h.sellers), saleCommMode: h.saleCommMode, saleFixedAmount: h.saleFixedAmount,
      redCommMode: h.redCommMode, redFixedAmount: h.redFixedAmount, status: h.status,
    };
    await this.db.commHolding.upsert({ where: { id: h.id }, create: { id: h.id, ...data, createdAt: new Date(h.createdAt) }, update: data });
    return h;
  }
  private toUsage(r: Awaited<ReturnType<PrismaClient['commSessionUsage']['findFirst']>>): SessionUsage {
    const x = r!;
    return { id: x.id, holdingId: x.holdingId, usedAt: x.usedAt.toISOString(), businessDate: x.businessDate, serviceId: x.serviceId, appointmentId: x.appointmentId, sessionValue: s(x.sessionValue)!, performers: x.performers as unknown as StaffSplit[], overrideBy: x.overrideBy, overrideReason: x.overrideReason, voidedAt: iso(x.voidedAt), voidReason: x.voidReason };
  }
  async listSessionUsage(holdingId: string) {
    return (await this.db.commSessionUsage.findMany({ where: { holdingId }, orderBy: { usedAt: 'asc' } })).map((r) => this.toUsage(r));
  }
  async getSessionUsage(id: string) {
    const r = await this.db.commSessionUsage.findUnique({ where: { id } });
    return r ? this.toUsage(r) : null;
  }
  async saveSessionUsage(u: SessionUsage) {
    const data = { holdingId: u.holdingId, usedAt: new Date(u.usedAt), businessDate: u.businessDate, serviceId: u.serviceId, appointmentId: u.appointmentId, sessionValue: u.sessionValue, performers: json(u.performers), overrideBy: u.overrideBy, overrideReason: u.overrideReason, voidedAt: u.voidedAt ? new Date(u.voidedAt) : null, voidReason: u.voidReason };
    await this.db.commSessionUsage.upsert({ where: { id: u.id }, create: { id: u.id, ...data }, update: data });
    return u;
  }

  // ---------- ledger ----------
  async insertLines(lines: BaseLine[]) {
    if (!lines.length) return;
    await this.db.commBaseLine.createMany({
      data: lines.map((l) => ({
        id: l.id, salonId: l.salonId, staffId: l.staffId, commissionType: l.commissionType, productCategory: l.productCategory ?? null, baseAmount: l.baseAmount,
        splitPct: l.splitPct, units: l.units, fixedCommission: l.fixedCommission ?? null, businessDate: l.businessDate, sourceType: l.sourceType, sourceId: l.sourceId,
        holdingId: l.holdingId ?? null, status: l.status, reversedById: l.reversedById ?? null, reason: l.reason ?? null, createdBy: l.createdBy, createdAt: new Date(l.createdAt),
      })),
    });
  }
  async listLines(f: LineFilter): Promise<BaseLine[]> {
    const rows = await this.db.commBaseLine.findMany({
      where: {
        salonId: f.salonId, staffId: f.staffId, sourceId: f.sourceId, holdingId: f.holdingId,
        businessDate: { gte: f.from, lte: f.to },
        commissionType: f.types ? { in: f.types } : undefined,
        status: f.includeReversed ? undefined : { not: 'REVERSED' },
      },
      orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toLine(r));
  }
  private toLine(r: NonNullable<Awaited<ReturnType<PrismaClient['commBaseLine']['findFirst']>>>): BaseLine {
    return {
      id: r.id, salonId: r.salonId, staffId: r.staffId, commissionType: r.commissionType as BaseLine['commissionType'], productCategory: r.productCategory,
      baseAmount: s(r.baseAmount)!, splitPct: s(r.splitPct)!, units: r.units, fixedCommission: s(r.fixedCommission), businessDate: r.businessDate,
      sourceType: r.sourceType as BaseLine['sourceType'], sourceId: r.sourceId, holdingId: r.holdingId, status: r.status as BaseLine['status'],
      reversedById: r.reversedById, reason: r.reason, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
    };
  }
  async getLine(id: string) {
    const r = await this.db.commBaseLine.findUnique({ where: { id } });
    return r ? this.toLine(r) : null;
  }
  async updateLineStatus(id: string, status: BaseLine['status'], reversedById?: string | null) {
    await this.db.commBaseLine.update({ where: { id }, data: { status, ...(reversedById !== undefined ? { reversedById } : {}) } });
  }

  // ---------- periods ----------
  async getPeriod(salonId: string, periodKey: string): Promise<CommissionPeriod | null> {
    const r = await this.db.commPeriod.findUnique({ where: { salonId_periodKey: { salonId, periodKey } } });
    return r ? { ...r, status: r.status as CommissionPeriod['status'], calculatedAt: iso(r.calculatedAt), approvedAt: iso(r.approvedAt) } : null;
  }
  async savePeriod(p: CommissionPeriod) {
    const data = { status: p.status, calculatedAt: p.calculatedAt ? new Date(p.calculatedAt) : null, approvedBy: p.approvedBy, approvedAt: p.approvedAt ? new Date(p.approvedAt) : null };
    await this.db.commPeriod.upsert({ where: { salonId_periodKey: { salonId: p.salonId, periodKey: p.periodKey } }, create: { id: p.id, salonId: p.salonId, periodKey: p.periodKey, ...data }, update: data });
    return p;
  }
  async saveResults(salonId: string, periodKey: string, results: StaffPeriodResult[]) {
    await this.db.$transaction([
      this.db.commPeriodResult.deleteMany({ where: { salonId, periodKey } }),
      this.db.commPeriodResult.createMany({ data: results.map((r) => ({ salonId, periodKey, staffId: r.staffId, result: json(r) })) }),
    ]);
  }
  async listResults(salonId: string, periodKey: string) {
    return (await this.db.commPeriodResult.findMany({ where: { salonId, periodKey } })).map((r) => r.result as unknown as StaffPeriodResult);
  }

  // ---------- payroll ----------
  async listAdjustments(salonId: string, periodKey: string): Promise<Adjustment[]> {
    return (await this.db.commAdjustment.findMany({ where: { salonId, periodKey }, orderBy: { createdAt: 'asc' } })).map((r) => ({ ...r, kind: r.kind as Adjustment['kind'], amount: s(r.amount)!, createdAt: r.createdAt.toISOString() }));
  }
  async saveAdjustment(a: Adjustment) {
    await this.db.commAdjustment.create({ data: { ...a, createdAt: new Date(a.createdAt) } });
    return a;
  }
  async getPayrollProfile(staffId: string, onDate: string): Promise<PayrollProfile | null> {
    const r = await this.db.commPayrollProfile.findFirst({ where: { staffId, effectiveFrom: { lte: onDate } }, orderBy: { effectiveFrom: 'desc' } });
    return r ? { staffId: r.staffId, effectiveFrom: r.effectiveFrom, basicSalary: s(r.basicSalary)!, fixedOt: s(r.fixedOt)!, fwlLevy: s(r.fwlLevy)!, payrollSalesAlertPct: s(r.payrollSalesAlertPct)! } : null;
  }
  async savePayrollProfile(p: PayrollProfile) {
    const data = { basicSalary: p.basicSalary, fixedOt: p.fixedOt, fwlLevy: p.fwlLevy, payrollSalesAlertPct: p.payrollSalesAlertPct };
    await this.db.commPayrollProfile.upsert({ where: { staffId_effectiveFrom: { staffId: p.staffId, effectiveFrom: p.effectiveFrom } }, create: { staffId: p.staffId, effectiveFrom: p.effectiveFrom, ...data }, update: data });
    return p;
  }

  // ---------- settings & audit ----------
  async getSettings(salonId: string): Promise<SalonCommissionSettings> {
    const r = await this.db.commSettings.findUnique({ where: { salonId } });
    if (!r) return DEFAULT_SETTINGS(salonId);
    return { salonId, requireStaffOnLines: r.requireStaffOnLines, refundAdminFee: s(r.refundAdminFee)!, defaultMinDepositPct: s(r.defaultMinDepositPct)!, joinAfterDayCountsNextMonth: r.joinAfterDayCountsNextMonth, negativeBase: r.negativeBase as SalonCommissionSettings['negativeBase'], fallbackRates: r.fallbackRates as SalonCommissionSettings['fallbackRates'] };
  }
  async saveSettings(st: SalonCommissionSettings) {
    const data = { requireStaffOnLines: st.requireStaffOnLines, refundAdminFee: st.refundAdminFee, defaultMinDepositPct: st.defaultMinDepositPct, joinAfterDayCountsNextMonth: st.joinAfterDayCountsNextMonth, negativeBase: st.negativeBase, fallbackRates: json(st.fallbackRates) };
    await this.db.commSettings.upsert({ where: { salonId: st.salonId }, create: { salonId: st.salonId, ...data }, update: data });
    return st;
  }
  async audit(e: AuditEntry) {
    await this.db.commAuditLog.create({ data: { salonId: e.salonId, userId: e.userId, action: e.action, entity: e.entity, entityId: e.entityId, before: e.before === undefined ? undefined : json(e.before), after: e.after === undefined ? undefined : json(e.after), reason: e.reason ?? null } });
  }
}
