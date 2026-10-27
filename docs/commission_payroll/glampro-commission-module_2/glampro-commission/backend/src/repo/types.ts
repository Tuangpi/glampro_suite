/**
 * Repository interface – the ONLY place the commission module touches storage.
 * Two implementations:
 *   - memoryRepo.ts  : in-memory, used for tests and the demo server (no database needed)
 *   - prismaRepo.ts  : PostgreSQL via Prisma (prisma/schema.prisma)
 * To use Glampro's existing tables (e.g. Staff), change prismaRepo.ts only.
 */
import type { BaseLine, CommissionPlan, CommissionType, PlanVersion, StaffPeriodResult, StaffSplit } from '@glampro/commission-shared';

export interface StaffInfo {
  id: string;
  salonId: string;
  name: string;
  position: string | null;
  joinDate: string | null; // YYYY-MM-DD
  active: boolean;
  /** Admin override of the end month of the first (new-staff) stage (FR-STG-04). */
  stageEndOverride: number | null;
}

export interface PlanAssignment {
  id: string;
  staffId: string;
  planId: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string | null;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export type CommissionMode = 'FOLLOW_PLAN' | 'EXCLUDE' | 'FIXED';

/** Commission view of a customer's package holding (side table keyed by Glampro's holding id). */
export interface HoldingCommission {
  id: string; // = Glampro holding id
  salonId: string;
  customerId: string;
  packageId: string;
  packageName: string;
  netPrice: string; // after discount, excl. GST
  sessionsTotal: number;
  sessionsUsed: number;
  sessionValue: string; // snapshot, 4 dp
  cashCollected: string; // net of refunds
  sellers: StaffSplit[];
  saleCommMode: CommissionMode;
  saleFixedAmount: string | null; // per sale (paid once, on first payment)
  redCommMode: CommissionMode;
  redFixedAmount: string | null; // per session
  status: 'ACTIVE' | 'COMPLETED' | 'REFUNDED' | 'EXPIRED';
  createdAt: string;
}

export interface SessionUsage {
  id: string;
  holdingId: string;
  usedAt: string;
  businessDate: string;
  serviceId: string | null;
  appointmentId: string | null;
  sessionValue: string;
  performers: StaffSplit[];
  overrideBy: string | null;
  overrideReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface CommissionPeriod {
  id: string;
  salonId: string;
  periodKey: string; // "2026-09"
  status: 'OPEN' | 'CALCULATED' | 'APPROVED';
  calculatedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface Adjustment {
  id: string;
  salonId: string;
  periodKey: string;
  staffId: string;
  kind: 'UNPAID_LEAVE' | 'OVERTIME' | 'ADDITION' | 'DEDUCTION' | 'COMMISSION_ADJ';
  amount: string; // positive number; sign comes from kind (UNPAID_LEAVE/DEDUCTION subtract)
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface PayrollProfile {
  staffId: string;
  effectiveFrom: string;
  basicSalary: string;
  fixedOt: string;
  fwlLevy: string;
  payrollSalesAlertPct: string;
}

export interface SalonCommissionSettings {
  salonId: string;
  requireStaffOnLines: boolean;
  refundAdminFee: string;
  defaultMinDepositPct: string;
  joinAfterDayCountsNextMonth: number | null;
  negativeBase: 'CARRY_FORWARD' | 'WRITE_OFF';
  /** Flat fallback rates for staff with no plan (FR-ASN-05), e.g. { SVC: "5", PRD: "10" } */
  fallbackRates: Partial<Record<CommissionType, string>>;
}

export interface AuditEntry {
  salonId: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export interface LineFilter {
  salonId: string;
  staffId?: string;
  from?: string; // inclusive YYYY-MM-DD
  to?: string; // inclusive
  types?: CommissionType[];
  sourceId?: string;
  holdingId?: string;
  includeReversed?: boolean;
}

export interface CommissionRepo {
  // plans
  listPlans(salonId: string): Promise<CommissionPlan[]>;
  getPlan(id: string): Promise<CommissionPlan | null>;
  savePlan(p: CommissionPlan): Promise<CommissionPlan>;
  listVersions(planId: string): Promise<PlanVersion[]>;
  getVersion(id: string): Promise<PlanVersion | null>;
  saveVersion(v: PlanVersion): Promise<PlanVersion>;

  // staff & assignment
  listStaff(salonId: string): Promise<StaffInfo[]>;
  getStaff(id: string): Promise<StaffInfo | null>;
  saveStaff(s: StaffInfo): Promise<StaffInfo>;
  listAssignments(staffId: string): Promise<PlanAssignment[]>;
  saveAssignment(a: PlanAssignment): Promise<PlanAssignment>;

  // holdings & sessions
  getHolding(id: string): Promise<HoldingCommission | null>;
  saveHolding(h: HoldingCommission): Promise<HoldingCommission>;
  listSessionUsage(holdingId: string): Promise<SessionUsage[]>;
  getSessionUsage(id: string): Promise<SessionUsage | null>;
  saveSessionUsage(s: SessionUsage): Promise<SessionUsage>;

  // ledger (append-only; only status / reversedById may be updated)
  insertLines(lines: BaseLine[]): Promise<void>;
  listLines(f: LineFilter): Promise<BaseLine[]>;
  getLine(id: string): Promise<BaseLine | null>;
  updateLineStatus(id: string, status: BaseLine['status'], reversedById?: string | null): Promise<void>;

  // periods & results
  getPeriod(salonId: string, periodKey: string): Promise<CommissionPeriod | null>;
  savePeriod(p: CommissionPeriod): Promise<CommissionPeriod>;
  saveResults(salonId: string, periodKey: string, results: StaffPeriodResult[]): Promise<void>;
  listResults(salonId: string, periodKey: string): Promise<StaffPeriodResult[]>;

  // payroll
  listAdjustments(salonId: string, periodKey: string): Promise<Adjustment[]>;
  saveAdjustment(a: Adjustment): Promise<Adjustment>;
  getPayrollProfile(staffId: string, onDate: string): Promise<PayrollProfile | null>;
  savePayrollProfile(p: PayrollProfile): Promise<PayrollProfile>;

  // settings & audit
  getSettings(salonId: string): Promise<SalonCommissionSettings>;
  saveSettings(s: SalonCommissionSettings): Promise<SalonCommissionSettings>;
  audit(e: AuditEntry): Promise<void>;
}
