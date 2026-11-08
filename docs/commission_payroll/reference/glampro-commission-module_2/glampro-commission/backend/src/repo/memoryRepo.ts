/**
 * In-memory repository – for tests and the demo server. Data is lost on restart.
 */
import type { BaseLine, CommissionPlan, PlanVersion, StaffPeriodResult } from '@glampro/commission-shared';
import type {
  Adjustment, AuditEntry, CommissionPeriod, CommissionRepo, HoldingCommission, LineFilter, PayrollProfile, PlanAssignment,
  SalonCommissionSettings, SessionUsage, StaffInfo,
} from './types.js';

const clone = <T>(x: T): T => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));

export const DEFAULT_SETTINGS = (salonId: string): SalonCommissionSettings => ({
  salonId,
  requireStaffOnLines: true,
  refundAdminFee: '100',
  defaultMinDepositPct: '30',
  joinAfterDayCountsNextMonth: null,
  negativeBase: 'CARRY_FORWARD',
  fallbackRates: {},
});

export class MemoryRepo implements CommissionRepo {
  plans = new Map<string, CommissionPlan>();
  versions = new Map<string, PlanVersion>();
  staff = new Map<string, StaffInfo>();
  assignments = new Map<string, PlanAssignment>();
  holdings = new Map<string, HoldingCommission>();
  sessions = new Map<string, SessionUsage>();
  lines = new Map<string, BaseLine>();
  periods = new Map<string, CommissionPeriod>();
  results = new Map<string, StaffPeriodResult[]>();
  adjustments = new Map<string, Adjustment>();
  payroll: PayrollProfile[] = [];
  settings = new Map<string, SalonCommissionSettings>();
  auditLog: (AuditEntry & { at: string })[] = [];

  async listPlans(salonId: string) { return [...this.plans.values()].filter((p) => p.salonId === salonId).map(clone); }
  async getPlan(id: string) { return clone(this.plans.get(id) ?? null); }
  async savePlan(p: CommissionPlan) { this.plans.set(p.id, clone(p)); return clone(p); }
  async listVersions(planId: string) { return [...this.versions.values()].filter((v) => v.planId === planId).sort((a, b) => a.versionNo - b.versionNo).map(clone); }
  async getVersion(id: string) { return clone(this.versions.get(id) ?? null); }
  async saveVersion(v: PlanVersion) { this.versions.set(v.id, clone(v)); return clone(v); }

  async listStaff(salonId: string) { return [...this.staff.values()].filter((s) => s.salonId === salonId).map(clone); }
  async getStaff(id: string) { return clone(this.staff.get(id) ?? null); }
  async saveStaff(s: StaffInfo) { this.staff.set(s.id, clone(s)); return clone(s); }
  async listAssignments(staffId: string) { return [...this.assignments.values()].filter((a) => a.staffId === staffId).sort((a, b) => a.fromDate.localeCompare(b.fromDate)).map(clone); }
  async saveAssignment(a: PlanAssignment) { this.assignments.set(a.id, clone(a)); return clone(a); }

  async getHolding(id: string) { return clone(this.holdings.get(id) ?? null); }
  async saveHolding(h: HoldingCommission) { this.holdings.set(h.id, clone(h)); return clone(h); }
  async listSessionUsage(holdingId: string) { return [...this.sessions.values()].filter((s) => s.holdingId === holdingId).sort((a, b) => a.usedAt.localeCompare(b.usedAt)).map(clone); }
  async getSessionUsage(id: string) { return clone(this.sessions.get(id) ?? null); }
  async saveSessionUsage(s: SessionUsage) { this.sessions.set(s.id, clone(s)); return clone(s); }

  async insertLines(lines: BaseLine[]) { for (const l of lines) { if (this.lines.has(l.id)) throw new Error(`Duplicate line ${l.id}`); this.lines.set(l.id, clone(l)); } }
  async listLines(f: LineFilter) {
    return [...this.lines.values()]
      .filter((l) => l.salonId === f.salonId)
      .filter((l) => !f.staffId || l.staffId === f.staffId)
      .filter((l) => !f.from || l.businessDate >= f.from)
      .filter((l) => !f.to || l.businessDate <= f.to)
      .filter((l) => !f.types || f.types.includes(l.commissionType))
      .filter((l) => !f.sourceId || l.sourceId === f.sourceId)
      .filter((l) => !f.holdingId || l.holdingId === f.holdingId)
      .filter((l) => f.includeReversed || l.status !== 'REVERSED')
      .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }
  async getLine(id: string) { return clone(this.lines.get(id) ?? null); }
  async updateLineStatus(id: string, status: BaseLine['status'], reversedById?: string | null) {
    const l = this.lines.get(id);
    if (!l) throw new Error('Line not found');
    l.status = status;
    if (reversedById !== undefined) l.reversedById = reversedById;
  }

  async getPeriod(salonId: string, periodKey: string) { return clone(this.periods.get(`${salonId}:${periodKey}`) ?? null); }
  async savePeriod(p: CommissionPeriod) { this.periods.set(`${p.salonId}:${p.periodKey}`, clone(p)); return clone(p); }
  async saveResults(salonId: string, periodKey: string, results: StaffPeriodResult[]) { this.results.set(`${salonId}:${periodKey}`, clone(results)); }
  async listResults(salonId: string, periodKey: string) { return clone(this.results.get(`${salonId}:${periodKey}`) ?? []); }

  async listAdjustments(salonId: string, periodKey: string) { return [...this.adjustments.values()].filter((a) => a.salonId === salonId && a.periodKey === periodKey).map(clone); }
  async saveAdjustment(a: Adjustment) { this.adjustments.set(a.id, clone(a)); return clone(a); }
  async getPayrollProfile(staffId: string, onDate: string) {
    const hits = this.payroll.filter((p) => p.staffId === staffId && p.effectiveFrom <= onDate).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return clone(hits[0] ?? null);
  }
  async savePayrollProfile(p: PayrollProfile) {
    this.payroll = this.payroll.filter((x) => !(x.staffId === p.staffId && x.effectiveFrom === p.effectiveFrom));
    this.payroll.push(clone(p));
    return clone(p);
  }

  async getSettings(salonId: string) { return clone(this.settings.get(salonId) ?? DEFAULT_SETTINGS(salonId)); }
  async saveSettings(s: SalonCommissionSettings) { this.settings.set(s.salonId, clone(s)); return clone(s); }
  async audit(e: AuditEntry) { this.auditLog.push({ ...clone(e), at: new Date().toISOString() }); }
}
