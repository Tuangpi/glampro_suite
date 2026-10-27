/**
 * API client used by every screen. Two implementations with the SAME interface:
 *   - HttpApi : calls the Node backend REST API (set VITE_API_URL)
 *   - DemoApi : runs the real backend services in the browser on an in-memory repo (no server needed)
 * Screens only depend on the `CommissionApi` interface below.
 */
import type { PlanDefinition, StaffSplit } from '@glampro/commission-shared';
import type { PlanService } from '@backend/services/planService';
import type { StaffService } from '@backend/services/staffService';
import type { PeriodService } from '@backend/services/periodService';
import type { LedgerService, PurchasePackageInput } from '@backend/services/ledgerService';
import type { Adjustment, PayrollProfile } from '@backend/repo/types';

export type Role = 'SUPER_ADMIN' | 'MANAGER' | 'STAFF' | 'CASHIER';
export interface Actor { salonId: string; userId: string; role: Role }

type R<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;
export type Overview = R<StaffService['overview']>;
export type PlanListItem = R<PlanService['list']>[number];
export type PlanDetail = R<PlanService['get']>;
export type StaffProfile = R<StaffService['commissionProfile']>;
export type ImpactResult = R<PlanService['impact']>;
export type PeriodSummary = R<PeriodService['summary']>;
export type Statement = R<PeriodService['statement']>;
export type HoldingDetail = R<LedgerService['holdingDetail']>;
export type SaveDraftResult = R<PlanService['saveDraft']>;

export interface CommissionApi {
  readonly mode: 'demo' | 'http';
  overview(periodKey?: string): Promise<Overview>;
  plans(): Promise<PlanListItem[]>;
  plan(planId: string): Promise<PlanDetail>;
  saveDraft(planId: string, definition: PlanDefinition): Promise<SaveDraftResult>;
  publish(versionId: string, effectiveFrom: string, reason: string): Promise<unknown>;
  impact(planId: string, definition: PlanDefinition, periodKey: string): Promise<ImpactResult>;
  staffProfile(staffId: string): Promise<StaffProfile>;
  assignPlan(staffId: string, input: { planId: string; fromDate: string; reason: string; joinDate?: string }): Promise<unknown>;
  setStageOverride(staffId: string, endMonth: number | null, reason: string): Promise<unknown>;
  savePayrollProfile(staffId: string, p: Omit<PayrollProfile, 'staffId'>): Promise<unknown>;
  purchasePackage(input: PurchasePackageInput): Promise<unknown>;
  holding(holdingId: string): Promise<HoldingDetail>;
  collectPayment(holdingId: string, input: { amount: string; paymentId: string; businessDate: string }): Promise<unknown>;
  redeem(holdingId: string, input: { performers: StaffSplit[]; businessDate: string; override?: { managerId: string; reason: string } | null }): Promise<unknown>;
  refund(holdingId: string, input: { refundId: string; businessDate: string; reason: string; adminFee?: string }): Promise<unknown>;
  voidSession(sessionUsageId: string, input: { reason: string; businessDate: string }): Promise<unknown>;
  correctStaff(lineId: string, input: { newStaffId: string; reason: string; businessDate: string }): Promise<unknown>;
  calculate(periodKey: string): Promise<unknown>;
  periodSummary(periodKey: string): Promise<PeriodSummary>;
  statement(periodKey: string, staffId: string): Promise<Statement>;
  addAdjustment(periodKey: string, a: Pick<Adjustment, 'staffId' | 'kind' | 'amount' | 'reason'>): Promise<unknown>;
  approve(periodKey: string): Promise<unknown>;
  exportCsv(periodKey: string): Promise<string>;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

// ---------------------------------------------------------------- HTTP
export class HttpApi implements CommissionApi {
  readonly mode = 'http' as const;
  constructor(private baseUrl: string, private actor: () => Actor) {}

  private async req<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
    const a = this.actor();
    // TODO(Glampro): replace demo headers with the real auth token / cookie.
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-salon-id': a.salonId, 'x-user-id': a.userId, 'x-role': a.role },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new ApiError(res.status, j.code ?? 'ERROR', j.message ?? res.statusText, j.details);
    }
    return (raw ? res.text() : res.json()) as Promise<T>;
  }
  overview = (p?: string) => this.req<Overview>('GET', `/overview${p ? `?period=${p}` : ''}`);
  plans = () => this.req<PlanListItem[]>('GET', '/plans');
  plan = (id: string) => this.req<PlanDetail>('GET', `/plans/${id}`);
  saveDraft = (id: string, definition: PlanDefinition) => this.req<SaveDraftResult>('PUT', `/plans/${id}/draft`, { definition });
  publish = (vid: string, effectiveFrom: string, reason: string) => this.req('POST', `/versions/${vid}/publish`, { effectiveFrom, reason });
  impact = (id: string, definition: PlanDefinition, periodKey: string) => this.req<ImpactResult>('POST', `/plans/${id}/impact`, { definition, periodKey });
  staffProfile = (sid: string) => this.req<StaffProfile>('GET', `/staff/${sid}`);
  assignPlan = (sid: string, i: { planId: string; fromDate: string; reason: string; joinDate?: string }) => this.req('POST', `/staff/${sid}/assignments`, i);
  setStageOverride = (sid: string, endMonth: number | null, reason: string) => this.req('PUT', `/staff/${sid}/stage-override`, { endMonth, reason });
  savePayrollProfile = (sid: string, p: Omit<PayrollProfile, 'staffId'>) => this.req('PUT', `/staff/${sid}/payroll-profile`, p);
  purchasePackage = (i: PurchasePackageInput) => this.req('POST', '/holdings', i);
  holding = (hid: string) => this.req<HoldingDetail>('GET', `/holdings/${hid}`);
  collectPayment = (hid: string, i: { amount: string; paymentId: string; businessDate: string }) => this.req('POST', `/holdings/${hid}/payments`, i);
  redeem = (hid: string, i: { performers: StaffSplit[]; businessDate: string; override?: { managerId: string; reason: string } | null }) => this.req('POST', `/holdings/${hid}/redeem`, i);
  refund = (hid: string, i: { refundId: string; businessDate: string; reason: string; adminFee?: string }) => this.req('POST', `/holdings/${hid}/refund`, i);
  voidSession = (sid: string, i: { reason: string; businessDate: string }) => this.req('POST', `/sessions/${sid}/void`, i);
  correctStaff = (lid: string, i: { newStaffId: string; reason: string; businessDate: string }) => this.req('POST', `/lines/${lid}/correct-staff`, i);
  calculate = (p: string) => this.req('POST', `/periods/${p}/calculate`);
  periodSummary = (p: string) => this.req<PeriodSummary>('GET', `/periods/${p}`);
  statement = (p: string, sid: string) => this.req<Statement>('GET', `/periods/${p}/staff/${sid}`);
  addAdjustment = (p: string, a: Pick<Adjustment, 'staffId' | 'kind' | 'amount' | 'reason'>) => this.req('POST', `/periods/${p}/adjustments`, a);
  approve = (p: string) => this.req('POST', `/periods/${p}/approve`);
  exportCsv = (p: string) => this.req<string>('GET', `/periods/${p}/export.csv`, undefined, true);
}
