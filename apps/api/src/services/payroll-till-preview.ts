import { z } from "zod";
import {
  allocatePayrollSplit,
  calculateScopedPayrollStaffPeriod,
  exact,
  fixed,
  add,
  neg,
  commissionSharesSchema,
  payrollDecimalSchema,
  type PayrollBaseLine,
} from "@glampro_suite/shared";
import type { PayrollCloseState } from "./payroll-close-state.js";

/** Hypothetical activity only. No prices, configuration or earnings are persisted. */
export const tillPreviewSchema = z.strictObject({
  commissionType: z.enum(["SVC", "PRD", "FOC", "PKG_SALE", "PKG_RED", "VP_SALE"]),
  baseAmount: payrollDecimalSchema.refine((value) => exact(value).n >= 0n),
  quantity: z.number().int().min(1).max(10000),
  shares: commissionSharesSchema,
});

export function previewTillCommission(
  state: PayrollCloseState,
  raw: unknown,
  source?: {
    outletId: string | null;
    category: string | null;
    businessDate: string;
    mode: PayrollBaseLine["mode"];
    fixedCommission?: string;
    fallbackRates: Map<string, string>;
  },
) {
  const input = tillPreviewSchema.parse(raw);
  const amounts = allocatePayrollSplit(input.baseAmount, input.shares);
  const units = allocatePayrollSplit(String(input.quantity), input.shares);
  return {
    calculatedAt: state.calculation?.calculatedAt ?? null,
    rows: input.shares.map((share) => {
      const statement = state.calculation?.statements.find((row) => row.staff.id === share.staffId);
      const calculation = statement?.inputs.calculation;
      // A cart has no source-time fallback-rate, category, funding or session evidence.
      // Refuse those cases rather than pretending a rule rate is the plan's award.
      const components = calculation?.plan?.definition.components ?? [];
      const unavailable =
        !calculation ||
        (!source &&
          (!calculation.plan ||
            components.some(
              (row) =>
                row.commissionTypes.includes(input.commissionType) &&
                ((row.categoryInclude?.length ?? 0) > 0 || (row.categoryExclude?.length ?? 0) > 0),
            ) ||
            (calculation.plan?.outletIds?.length ?? 0) > 0));
      if (unavailable || !calculation || statement?.staff.disabled)
        return { staffId: share.staffId, amount: null };
      const before = calculateScopedPayrollStaffPeriod(calculation);
      const after = calculateScopedPayrollStaffPeriod({
        ...calculation,
        lines: [
          ...calculation.lines,
          {
            id: `till-preview:${share.staffId}`,
            staffId: share.staffId,
            outletId: source?.outletId ?? null,
            commissionType: input.commissionType,
            baseAmount: amounts.find((row) => row.staffId === share.staffId)!.amount,
            units: units.find((row) => row.staffId === share.staffId)!.amount,
            businessDate: source?.businessDate ?? `${state.periodKey}-01`,
            status: "EARNED",
            mode: source?.mode ?? "FOLLOW_PLAN",
            ...(source
              ? {
                  productCategory: source.category,
                  fallbackRatePct: source.fallbackRates.get(share.staffId),
                  ...(source.fixedCommission !== undefined
                    ? {
                        fixedCommission: allocatePayrollSplit(
                          source.fixedCommission,
                          input.shares,
                        ).find((row) => row.staffId === share.staffId)!.amount,
                      }
                    : {}),
                }
              : {}),
          },
        ],
      });
      return {
        staffId: share.staffId,
        amount: fixed(add(exact(after.commissionTotal), neg(exact(before.commissionTotal))), 2),
      };
    }),
  };
}
