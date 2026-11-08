/**
 * Demo mode: the REAL backend services run in the browser on the in-memory repository,
 * seeded with Eurosense sample data. Used when VITE_API_URL is empty – handy for review and for
 * building screens before the backend is deployed. Data resets on page reload.
 */
import type { PlanDefinition, StaffSplit } from '@glampro/commission-shared';
import { MemoryRepo } from '@backend/repo/memoryRepo';
import { seedDemo } from '@backend/seed/demo';
import { LedgerService, PurchasePackageInput } from '@backend/services/ledgerService';
import { PeriodService } from '@backend/services/periodService';
import { PlanService } from '@backend/services/planService';
import { StaffService } from '@backend/services/staffService';
import { AppError } from '@backend/services/util';
import type { Adjustment, PayrollProfile } from '@backend/repo/types';
import { Actor, ApiError, CommissionApi } from './client';

export class DemoApi implements CommissionApi {
  readonly mode = 'demo' as const;
  private repo = new MemoryRepo();
  private ready: Promise<void>;
  private plans_ = new PlanService(this.repo);
  private staff_ = new StaffService(this.repo);
  private periods_ = new PeriodService(this.repo);
  private ledger_ = new LedgerService(this.repo);

  constructor(private actor: () => Actor) {
    this.ready = seedDemo(this.repo);
  }

  /** Wrap a call: wait for seed, convert AppError -> ApiError, deep-copy result like JSON would. */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    try {
      const v = await fn();
      return v === undefined ? v : JSON.parse(JSON.stringify(v));
    } catch (e) {
      if (e instanceof AppError) throw new ApiError(e.status, e.code, e.message, e.details);
      throw e;
    }
  }
  private get a() { return this.actor(); }

  overview = (p?: string) => this.run(() => this.staff_.overview(this.a.salonId, p));
  plans = () => this.run(() => this.plans_.list(this.a.salonId));
  plan = (id: string) => this.run(() => this.plans_.get(id));
  saveDraft = (id: string, d: PlanDefinition) => this.run(() => this.plans_.saveDraft(this.a, id, d));
  publish = (vid: string, eff: string, reason: string) => this.run(() => this.plans_.publish(this.a, vid, eff, reason));
  impact = (id: string, d: PlanDefinition, p: string) => this.run(() => this.plans_.impact(this.a, id, d, p));
  staffProfile = (sid: string) => this.run(() => this.staff_.commissionProfile(this.a.salonId, sid));
  assignPlan = (sid: string, i: { planId: string; fromDate: string; reason: string; joinDate?: string }) => this.run(() => this.staff_.assignPlan(this.a, sid, i));
  setStageOverride = (sid: string, endMonth: number | null, reason: string) => this.run(() => this.staff_.setStageOverride(this.a, sid, endMonth, reason));
  savePayrollProfile = (sid: string, p: Omit<PayrollProfile, 'staffId'>) => this.run(() => this.staff_.savePayrollProfile(this.a, { ...p, staffId: sid }));
  purchasePackage = (i: PurchasePackageInput) => this.run(() => this.ledger_.purchasePackage(this.a, i));
  holding = (hid: string) => this.run(() => this.ledger_.holdingDetail(this.a.salonId, hid));
  collectPayment = (hid: string, i: { amount: string; paymentId: string; businessDate: string }) => this.run(() => this.ledger_.collectPayment(this.a, { ...i, holdingId: hid }));
  redeem = (hid: string, i: { performers: StaffSplit[]; businessDate: string; override?: { managerId: string; reason: string } | null }) => this.run(() => this.ledger_.redeemSession(this.a, { ...i, holdingId: hid }));
  refund = (hid: string, i: { refundId: string; businessDate: string; reason: string; adminFee?: string }) => this.run(() => this.ledger_.refundPackage(this.a, { ...i, holdingId: hid }));
  voidSession = (sid: string, i: { reason: string; businessDate: string }) => this.run(() => this.ledger_.voidSession(this.a, { ...i, sessionUsageId: sid }));
  correctStaff = (lid: string, i: { newStaffId: string; reason: string; businessDate: string }) => this.run(() => this.ledger_.correctStaff(this.a, { ...i, lineId: lid }));
  calculate = (p: string) => this.run(() => this.periods_.calculate(this.a, p));
  periodSummary = (p: string) => this.run(() => this.periods_.summary(this.a.salonId, p));
  statement = (p: string, sid: string) => this.run(() => this.periods_.statement(this.a.salonId, p, sid));
  addAdjustment = (p: string, adj: Pick<Adjustment, 'staffId' | 'kind' | 'amount' | 'reason'>) => this.run(() => this.periods_.addAdjustment(this.a, { ...adj, periodKey: p }));
  approve = (p: string) => this.run(() => this.periods_.approve(this.a, p));
  exportCsv = (p: string) => this.run(() => this.periods_.exportCsv(this.a.salonId, p));
}
