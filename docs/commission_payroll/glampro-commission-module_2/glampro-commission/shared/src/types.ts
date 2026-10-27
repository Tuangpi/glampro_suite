/**
 * Glampro Commission – shared domain types.
 *
 * RULES (read before changing anything – see AI_HANDOFF.md):
 *  - Money is ALWAYS a decimal string in the API / DB layer ("1234.50"), never a JS float.
 *    Inside the engine we use Decimal (decimal.js). See money.ts.
 *  - Rates are percentages as decimal strings: "7" means 7%, "2.5" means 2.5%.
 *  - Dates are ISO strings: "YYYY-MM-DD" for business dates, full ISO for timestamps.
 *  - These types are shared by backend (Node) and frontend (React). Keep them framework-free.
 *
 * Requirement IDs (FR-xxx) refer to "Glampro SRS – Staff Commission Plans v1.2".
 */

/** Kind of commissionable event written to the base ledger (SRS §1.3, FR-BAS). */
export type CommissionType =
  | 'SVC' //       cash service (service paid normally, not from a package)
  | 'PRD' //       product sale
  | 'PKG_SALE' //  package sale – CASH COLLECTED (deposit / instalment / full), negative on refund
  | 'PKG_RED' //   package redemption ("on course") – session value
  | 'FOC' //       complimentary service – service list price (component applies base %)
  | 'VP_SALE' //   value (stored-credit) package sale – cash paid
  | 'VP_SPEND' //  service paid with stored credit – credit × paid/credit ratio
  | 'GC_SALE'; //  gift card sale (excluded from seed plans)

export const COMMISSION_TYPE_LABELS: Record<CommissionType, string> = {
  SVC: 'Cash service',
  PRD: 'Product',
  PKG_SALE: 'Package sale (cash collected)',
  PKG_RED: 'On course (redemption)',
  FOC: 'FOC service',
  VP_SALE: 'Value package sale',
  VP_SPEND: 'Value package spend',
  GC_SALE: 'Gift card sale',
};

/**
 * How a component turns its pooled monthly base into commission (FR-PLN-03, FR-CAL-04).
 *  FLAT            base × flatRatePct
 *  TIER_WHOLE      rate of the band reached × whole base ("retroactive")
 *  TIER_SLICE      each band's rate on its own slice ("progressive", like income tax)
 *  TIER_MIXED      per band: applyMode WHOLE (from $1 up to its limit) or SLICE
 *  FIXED_PER_UNIT  fixedAmount × number of units (e.g. S$5 per FOC service)
 */
export type CalcMethod = 'FLAT' | 'TIER_WHOLE' | 'TIER_SLICE' | 'TIER_MIXED' | 'FIXED_PER_UNIT';

export const CALC_METHOD_LABELS: Record<CalcMethod, { title: string; help: string }> = {
  FLAT: { title: 'Flat %', help: 'One rate on everything' },
  TIER_WHOLE: { title: 'Tier – whole amount', help: 'Band reached × whole base (retroactive)' },
  TIER_SLICE: { title: 'Tier – by slice', help: 'Each band only on its own slice (progressive)' },
  TIER_MIXED: { title: 'Tier – mixed', help: 'Choose per band: from $1 or slice only' },
  FIXED_PER_UNIT: { title: 'Fixed $ per unit', help: 'Fixed amount × number of items' },
};

export type ApplyMode = 'WHOLE' | 'SLICE';

/** One row of a tier table (FR-PLN-04). Band i covers base > upperLimit(i-1) and <= upperLimit(i). */
export interface TierBand {
  /** null = no upper limit (only allowed on the last band). */
  upperLimit: string | null;
  /** Rate for the Standard stage, e.g. "8". */
  ratePct: string;
  /** Optional rate per stage key, e.g. { new: "4" }. Missing / null = same as ratePct. */
  stageRates?: Record<string, string | null>;
  /** Only used when method = TIER_MIXED. Default WHOLE. */
  applyMode?: ApplyMode;
}

/** Tenure stage, e.g. New staff months 1–3 (FR-STG-01). */
export interface PlanStage {
  key: string; // stable key used in stageRates, e.g. "new", "std"
  name: string;
  fromMonth: number; // 1-based tenure month
  toMonth: number | null; // null = open-ended
}

export interface PlanComponent {
  key: string; // stable key, e.g. "cash_pkg"
  name: string;
  commissionTypes: CommissionType[];
  /** If set, only base lines whose productCategory is in this list count. */
  categoryInclude?: string[];
  /** If set, base lines whose productCategory is in this list are excluded. */
  categoryExclude?: string[];
  /** Share of the base that counts, e.g. "50" for FOC at 50% of price. Default "100". */
  basePct: string;
  method: CalcMethod;
  flatRatePct?: string;
  fixedAmount?: string;
  /** Optional maximum commission per month for this component. */
  monthlyCap?: string | null;
  bands: TierBand[];
  sort: number;
}

export interface IncentiveRow {
  /** Required for GROUP_AND_INDIVIDUAL, ignored for INDIVIDUAL_TARGET. */
  groupTarget?: string | null;
  individualTarget: string;
  amount: string;
}

export interface IncentiveRule {
  key: string;
  name: string;
  type: 'INDIVIDUAL_TARGET' | 'GROUP_AND_INDIVIDUAL';
  /** Commission types summed for the staff member's individual metric (FR-INC-03). */
  individualMetricTypes: CommissionType[];
  /** How the group metric is measured (FR-INC-04). */
  groupMetric: 'SALON_CASH' | 'SUM_INDIVIDUAL';
  rows: IncentiveRow[];
}

/** The rules of one plan version (stored as JSON in plan_version.definition). */
export interface PlanDefinition {
  stages: PlanStage[];
  components: PlanComponent[];
  incentives: IncentiveRule[];
}

export interface PlanVersion {
  id: string;
  planId: string;
  versionNo: number;
  effectiveFrom: string; // YYYY-MM-DD
  reason: string;
  status: 'DRAFT' | 'PUBLISHED';
  definition: PlanDefinition;
  publishedBy?: string | null;
  publishedAt?: string | null;
}

export interface CommissionPlan {
  id: string;
  salonId: string;
  name: string;
  description?: string;
  positions: string[];
  status: 'ACTIVE' | 'ARCHIVED';
}

/** One row of the append-only Commission Base Ledger (FR-BAS-01). */
export interface BaseLine {
  id: string;
  salonId: string;
  staffId: string;
  commissionType: CommissionType;
  productCategory?: string | null;
  /** Amount credited to THIS staff member (already multiplied by split). Can be negative (refund). */
  baseAmount: string;
  splitPct: string;
  /** Units for FIXED_PER_UNIT components (usually 1, -1 on reversal). */
  units: number;
  /**
   * Package-level "Fixed $" commission (FR-CAL-08). When set, this line is NOT pooled into plan
   * components; the fixed amount is paid as its own result line ("Package fixed commission").
   */
  fixedCommission?: string | null;
  businessDate: string; // YYYY-MM-DD in salon time zone
  sourceType: 'SALE_LINE' | 'PAYMENT' | 'SESSION_USAGE' | 'REFUND' | 'CORRECTION';
  sourceId: string;
  /** Package holding this line belongs to (package sale / redemption / refund), else null. */
  holdingId?: string | null;
  status: 'EARNED' | 'REVERSED' | 'PAID';
  reversedById?: string | null;
  reason?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface StaffSplit {
  staffId: string;
  splitPct: string; // "50"
}

/** One working line shown to the admin, e.g. "$1 – 8,985.50 × 7% = 628.99". */
export interface WorkingLine {
  from: string;
  to: string;
  amount: string; // base covered
  ratePct: string;
  commission: string;
  kind: 'WHOLE' | 'SLICE' | 'FLAT' | 'FIXED' | 'CAP' | 'INFO';
  text: string;
}

export interface ComponentResult {
  componentKey: string;
  componentName: string;
  method: CalcMethod;
  rawBase: string; // before base %
  pooledBase: string; // after base %
  units: number;
  bandIndex: number | null;
  bandLabel: string;
  ratePct: string | null; // rate of band reached (or flat rate)
  amount: string; // rounded 2dp
  capped: boolean;
  /** Base needed above which the next band starts (null if top band / flat). */
  nextThreshold: string | null;
  gapToNext: string | null;
  carryForwardOut: string; // negative base carried to next month (0 if none)
  working: WorkingLine[];
}

export interface IncentiveResult {
  ruleKey: string;
  name: string;
  individualMetric: string;
  groupMetric: string | null;
  rowIndex: number | null;
  amount: string;
}

export interface StaffPeriodResult {
  staffId: string;
  periodKey: string; // "2026-09"
  planId: string | null;
  planVersionId: string | null;
  tenureMonth: number | null;
  stageKey: string;
  stageName: string;
  components: ComponentResult[];
  incentives: IncentiveResult[];
  commissionTotal: string;
  incentiveTotal: string;
}
