/** Request validation (zod). Money and rates are strings like "1234.50" / "7". */
import { z } from 'zod';

const money = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Use a number like 1234.50');
const rate = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Use a rate like 7 or 2.5');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const periodKey = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');

export const commissionType = z.enum(['SVC', 'PRD', 'PKG_SALE', 'PKG_RED', 'FOC', 'VP_SALE', 'VP_SPEND', 'GC_SALE']);
export const calcMethod = z.enum(['FLAT', 'TIER_WHOLE', 'TIER_SLICE', 'TIER_MIXED', 'FIXED_PER_UNIT']);

export const tierBand = z.object({
  upperLimit: money.nullable(),
  ratePct: rate,
  stageRates: z.record(rate.nullable()).optional(),
  applyMode: z.enum(['WHOLE', 'SLICE']).optional(),
});
export const planComponent = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  commissionTypes: z.array(commissionType),
  categoryInclude: z.array(z.string()).optional(),
  categoryExclude: z.array(z.string()).optional(),
  basePct: rate,
  method: calcMethod,
  flatRatePct: rate.optional(),
  fixedAmount: money.optional(),
  monthlyCap: money.nullable().optional(),
  bands: z.array(tierBand),
  sort: z.number().int(),
});
export const planDefinition = z.object({
  stages: z.array(z.object({ key: z.string().min(1), name: z.string().min(1), fromMonth: z.number().int().min(1), toMonth: z.number().int().nullable() })),
  components: z.array(planComponent),
  incentives: z.array(z.object({
    key: z.string(), name: z.string(), type: z.enum(['INDIVIDUAL_TARGET', 'GROUP_AND_INDIVIDUAL']),
    individualMetricTypes: z.array(commissionType), groupMetric: z.enum(['SALON_CASH', 'SUM_INDIVIDUAL']),
    rows: z.array(z.object({ groupTarget: money.nullable().optional(), individualTarget: money, amount: money })),
  })),
});

const split = z.object({ staffId: z.string().min(1), splitPct: rate });
const commMode = z.enum(['FOLLOW_PLAN', 'EXCLUDE', 'FIXED']);

export const schemas = {
  createPlan: z.object({ name: z.string().min(1), description: z.string().optional(), positions: z.array(z.string()).default([]), definition: planDefinition, copyFromPlanId: z.string().optional() }),
  updatePlan: z.object({ name: z.string().optional(), description: z.string().optional(), positions: z.array(z.string()).optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }),
  saveDraft: z.object({ definition: planDefinition }),
  publish: z.object({ effectiveFrom: date, reason: z.string().min(1) }),
  simulate: z.object({ component: planComponent, base: money, stageKey: z.string().default('std'), units: z.number().int().default(0) }),
  impact: z.object({ definition: planDefinition, periodKey }),
  assign: z.object({ planId: z.string(), fromDate: date, reason: z.string().min(1), joinDate: date.optional() }),
  stageOverride: z.object({ endMonth: z.number().int().min(1).nullable(), reason: z.string().min(1) }),
  payrollProfile: z.object({ effectiveFrom: date, basicSalary: money, fixedOt: money, fwlLevy: money, payrollSalesAlertPct: rate }),
  purchasePackage: z.object({
    holdingId: z.string(), customerId: z.string(), packageId: z.string(), packageName: z.string(), netPrice: money, sessions: z.number().int().min(1),
    sellers: z.array(split).min(1).max(4), payNow: money, paymentId: z.string(), businessDate: date, minDepositPct: rate.optional(),
    saleCommMode: commMode.optional(), saleFixedAmount: money.nullable().optional(), redCommMode: commMode.optional(), redFixedAmount: money.nullable().optional(),
  }),
  collectPayment: z.object({ amount: money, paymentId: z.string(), businessDate: date }),
  redeem: z.object({
    performers: z.array(split).min(1).max(4), businessDate: date, serviceId: z.string().nullable().optional(), appointmentId: z.string().nullable().optional(),
    override: z.object({ managerId: z.string(), reason: z.string().min(1) }).nullable().optional(),
  }),
  refund: z.object({ refundId: z.string(), businessDate: date, reason: z.string().min(1), adminFee: money.optional() }),
  voidSession: z.object({ reason: z.string().min(1), businessDate: date }),
  correctStaff: z.object({ newStaffId: z.string(), reason: z.string().min(1), businessDate: date }),
  service: z.object({ saleLineId: z.string(), performers: z.array(split).min(1).max(4), netAmount: money, businessDate: date, foc: z.boolean().optional() }),
  product: z.object({ saleLineId: z.string(), sellers: z.array(split).min(1).max(4), netAmount: money, businessDate: date, productCategory: z.string().nullable().optional(), quantity: z.number().int().optional() }),
  valuePackage: z.object({ kind: z.enum(['SALE', 'SPEND']), sourceId: z.string(), staff: z.array(split).min(1).max(4), businessDate: date, paid: money, credit: money, creditSpent: money.optional() }),
  adjustment: z.object({ staffId: z.string(), kind: z.enum(['UNPAID_LEAVE', 'OVERTIME', 'ADDITION', 'DEDUCTION', 'COMMISSION_ADJ']), amount: money, reason: z.string().min(1) }),
  settings: z.object({
    requireStaffOnLines: z.boolean(), refundAdminFee: money, defaultMinDepositPct: rate, joinAfterDayCountsNextMonth: z.number().int().min(1).max(31).nullable(),
    negativeBase: z.enum(['CARRY_FORWARD', 'WRITE_OFF']), fallbackRates: z.record(rate),
  }),
};
