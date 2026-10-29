import { z } from "zod";
import {
  resolvePayrollCarrySettlements,
  type PayrollCarrySettlement,
} from "./payroll-close-settlements.js";
import type { PayrollNoCashSaleVoid, PayrollReturnedCashSaleVoid } from "./payroll-close-voids.js";
import type { PayrollSaleRefund } from "./payroll-close-sale-refunds.js";
import type { PayrollNoCashReversal } from "./payroll-close-reversals.js";
import type { PayrollRefundPayout } from "./payroll-close-refunds.js";
import { resolvePayrollCloseGroupMetrics } from "./payroll-close-group-metrics.js";
import { resolvePayrollCloseCash, type PayrollCashAttribution } from "./payroll-close-cash.js";
import {
  resolvePayrollCloseInventory,
  type PayrollCloseInventoryRecords,
} from "./payroll-close-inventory.js";
import {
  assemblePayrollStatement,
  payrollDecimalSchema,
  type PayrollGroupMetric,
} from "@glampro_suite/shared";
import { resolvePayrollCloseCarry, type PayrollCloseCarryRecords } from "./payroll-close-carry.js";
import {
  resolvePayrollCloseConfiguration,
  type PayrollCloseConfigurationRecords,
} from "./payroll-close-configuration.js";
import {
  resolvePayrollCloseLegacyExclusion,
  type PayrollCloseLegacyRecords,
} from "./payroll-close-legacy.js";
import {
  resolvePayrollCloseCollections,
  type PayrollCloseCollectionRecords,
} from "./payroll-close-collections.js";
import {
  payrollInputHash,
  type PayrollCloseInputs,
  type PayrollCloseState,
} from "./payroll-close-state.js";

const id = z.string().trim().min(1).max(128);
const metricSchema = z.object({
  tenantId: id,
  periodKey: id,
  staffId: id,
  collection: payrollDecimalSchema,
  groupMetrics: z.array(
    z.object({
      ruleKey: id,
      periodKey: id,
      scope: z.enum(["SALON", "OUTLET"]),
      outletId: id.nullable(),
      metric: z.enum(["SALON_CASH", "SUM_INDIVIDUAL"]),
      amount: payrollDecimalSchema,
    }),
  ),
  /** Source/revision evidence must be explicit JSON and is frozen with inputs.
   * Authenticity and allocation reconciliation remain the authoritative loader's job. */
  evidence: z.unknown().refine((value) => value !== undefined && value !== null),
});
export interface PayrollCloseInputRecords {
  carrySettlements?: PayrollCarrySettlement[];
  returnedCashSaleVoids?: PayrollReturnedCashSaleVoid[];
  noCashSaleVoids?: PayrollNoCashSaleVoid[];
  saleRefunds?: PayrollSaleRefund[];
  noCashReversals?: PayrollNoCashReversal[];
  refundPayouts?: PayrollRefundPayout[];
  cashAttributions: PayrollCashAttribution[];
  inventoryOperations: PayrollCloseInventoryRecords["operations"];
  state: PayrollCloseState;
  configuration: PayrollCloseConfigurationRecords;
  sources: PayrollCloseLegacyRecords & PayrollCloseCollectionRecords;
  carry: PayrollCloseCarryRecords;
  metrics: z.input<typeof metricSchema>[];
}

/** Composes validated supplied records, not a DB loader or permission boundary.
 * No zero carry/metrics defaults. Required staff are derived from activity, debt
 * and audited adjustments before historical configuration selection. */
export function resolvePayrollCloseInputs(raw: PayrollCloseInputRecords) {
  const scope = raw.configuration;
  for (const records of [raw.sources, raw.carry]) {
    if (records.tenantId !== scope.tenantId || records.periodKey !== scope.periodKey)
      throw new Error("Payroll input evidence has inconsistent salon or month scope.");
  }
  if (raw.state.periodKey !== scope.periodKey || raw.sources.timeZone !== scope.timeZone)
    throw new Error("Payroll input evidence has inconsistent period or timezone.");
  const sources = resolvePayrollCloseLegacyExclusion(raw.sources);
  const inventory = resolvePayrollCloseInventory({
    ...raw.sources,
    operations: raw.inventoryOperations,
  });
  const collections = resolvePayrollCloseCollections(raw.sources);
  const cash = resolvePayrollCloseCash({
    ...raw.sources,
    cashAttributions: raw.cashAttributions,
    refundPayouts: raw.refundPayouts,
    noCashReversals: raw.noCashReversals,
    saleRefunds: raw.saleRefunds,
    noCashSaleVoids: raw.noCashSaleVoids,
    returnedCashSaleVoids: raw.returnedCashSaleVoids,
  });
  const carry = resolvePayrollCloseCarry(raw.carry);
  if (carry.carry?.opening && carry.carry.opening.timeZone !== scope.timeZone)
    throw new Error("Payroll opening carry has inconsistent timezone.");
  const settlements = resolvePayrollCarrySettlements(
    raw.carrySettlements ?? [],
    scope.tenantId,
    scope.periodKey,
    carry.carry?.staff ?? [],
  );
  const requiredStaffIds = [
    ...new Set([
      ...scope.requiredStaffIds,
      ...(sources.sources?.requiredStaffIds ?? []),
      ...(carry.carry?.requiredStaffIds ?? []),
      ...(cash.cash?.staff.map((row) => row.staffId) ?? []),
      ...raw.state.adjustments.map((row) => row.staffId),
    ]),
  ].sort();
  const configuration = resolvePayrollCloseConfiguration({ ...scope, requiredStaffIds });
  const groups = resolvePayrollCloseGroupMetrics({
    ...raw.sources,
    requests: (configuration.configuration?.staff ?? []).flatMap((row) =>
      (row.version?.definition.incentives ?? [])
        .filter(
          (rule) => rule.type === "GROUP_AND_INDIVIDUAL" && rule.groupMetric === "SUM_INDIVIDUAL",
        )
        .map((rule) => ({
          staffId: row.staff.id,
          planId: row.version!.planId,
          versionId: row.version!.id,
          outletIds: row.assignment!.outletIds ?? [],
          rule,
        })),
    ),
  });
  const metrics = z
    .array(metricSchema)
    .parse(raw.metrics)
    .sort((a, b) => a.staffId.localeCompare(b.staffId));
  if (metrics.some((row) => row.tenantId !== scope.tenantId || row.periodKey !== scope.periodKey))
    throw new Error("Payroll metrics contain another salon or month.");
  if (new Set(metrics.map((row) => row.staffId)).size !== metrics.length)
    throw new Error("Duplicate payroll staff metric evidence.");
  payrollInputHash(metrics);
  const blockers: { code: string; staffId: string | null }[] = [];
  for (const [name, result] of Object.entries({
    sources,
    inventory,
    collections,
    cash,
    carry,
    configuration,
    groups,
  })) {
    if (result.status === "UNAVAILABLE")
      blockers.push({ code: `${name.toUpperCase()}_UNAVAILABLE`, staffId: null });
  }
  const staff = configuration.configuration?.staff ?? [];
  const staffIds = new Set(staff.map((row) => row.staff.id));
  for (const metric of metrics) {
    if (!staffIds.has(metric.staffId))
      blockers.push({ code: "METRIC_STAFF_NOT_INCLUDED", staffId: metric.staffId });
  }
  for (const row of staff) {
    if (!metrics.some((metric) => metric.staffId === row.staff.id))
      blockers.push({ code: "STAFF_METRICS_UNAVAILABLE", staffId: row.staff.id });
  }
  // Caller totals are assertions only. Reconcile them to independently allocated
  // external collections, including group scope, before they reach statements.
  const decimalTicks = (value: string) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    return BigInt(whole + fraction.padEnd(4, "0")) * (negative ? -1n : 1n);
  };
  if (cash.cash)
    for (const metric of metrics) {
      const collection =
        cash.cash.staff.find((row) => row.staffId === metric.staffId)?.collection ?? "0.0000";
      if (decimalTicks(metric.collection) !== decimalTicks(collection))
        blockers.push({ code: "STAFF_COLLECTION_MISMATCH", staffId: metric.staffId });
      for (const group of metric.groupMetrics) {
        if (group.metric !== "SALON_CASH") {
          const derived = groups.groups?.metrics.find(
            (row) =>
              row.staffId === metric.staffId &&
              row.metric.ruleKey === group.ruleKey &&
              row.metric.scope === group.scope &&
              row.metric.outletId === group.outletId,
          )?.metric;
          if (
            !derived ||
            group.periodKey !== scope.periodKey ||
            decimalTicks(group.amount) !== decimalTicks(derived.amount)
          )
            blockers.push({ code: "SUM_INDIVIDUAL_MISMATCH", staffId: metric.staffId });
          continue;
        }
        const validScope = (group.scope === "OUTLET") === (group.outletId !== null);
        const total =
          group.scope === "SALON"
            ? cash.cash.salonCash
            : cash.cash.outlets.find((row) => row.outletId === group.outletId)?.collection;
        if (
          !validScope ||
          group.periodKey !== scope.periodKey ||
          total === undefined ||
          decimalTicks(group.amount) !== decimalTicks(total)
        )
          blockers.push({ code: "GROUP_COLLECTION_MISMATCH", staffId: metric.staffId });
      }
    }
  const evidence = {
    sources,
    inventory,
    collections,
    cash,
    carry,
    settlements,
    configuration,
    groups,
    metrics,
    requiredStaffIds,
  };
  let inputs: PayrollCloseInputs | null = null;
  if (!blockers.length) {
    const settings = configuration.configuration!.settings!;
    inputs = {
      periodKey: scope.periodKey,
      timeZone: scope.timeZone,
      startsAt: configuration.startsAt,
      endsAt: configuration.endsAt,
      currency: "SGD",
      evidence,
      staff: staff.map((row) => {
        const metric = metrics.find((entry) => entry.staffId === row.staff.id)!;
        const previous = carry.carry!.staff.find((entry) => entry.staffId === row.staff.id);
        const settlement = settlements.find((entry) => entry.staffId === row.staff.id);
        return {
          staff: row.staff,
          profile: row.profile!,
          profileRevision: row.profileRevision!,
          adjustments: [],
          collection:
            cash.cash!.staff.find((entry) => entry.staffId === row.staff.id)?.collection ??
            "0.0000",
          calculation: {
            staffId: row.staff.id,
            periodKey: scope.periodKey,
            joinDate: row.settings!.joinDate,
            stageEndOverride: row.settings!.stageEndOverride,
            negativeBase: settings.negativeBase,
            joinAfterDay: settings.joinAfterDay,
            plan: row.version
              ? {
                  planId: row.version.planId,
                  versionId: row.version.id,
                  definition: row.version.definition,
                  outletIds: row.assignment!.outletIds,
                }
              : null,
            lines: sources.sources!.lines.filter((line) => line.staffId === row.staff.id),
            carryForward: previous?.carryForward ?? [],
            carryResolutions: settlement?.components ?? [],
            fallbackCarryCommission: settlement?.fallbackWriteOff
              ? "0.0000000000"
              : (previous?.fallbackCarryCommission ?? "0.0000000000"),
            groupMetrics: metric.groupMetrics.map((group) =>
              group.metric === "SUM_INDIVIDUAL"
                ? groups.groups!.metrics.find(
                    (entry) =>
                      entry.staffId === row.staff.id &&
                      entry.metric.ruleKey === group.ruleKey &&
                      entry.metric.scope === group.scope &&
                      entry.metric.outletId === group.outletId,
                  )!.metric
                : group,
            ) as PayrollGroupMetric[],
          },
        };
      }),
    };
    // Validate the whole assembly before exposing any usable inputs; unmapped debt,
    // missing group metrics and outlet conflicts must not become partial payroll.
    for (const row of inputs.staff) {
      try {
        assemblePayrollStatement(row);
      } catch {
        blockers.push({ code: "STAFF_CALCULATION_UNRESOLVED", staffId: row.staff.id });
      }
    }
    if (blockers.length) inputs = null;
  }
  return structuredClone({
    status: inputs ? ("INPUT_EVIDENCE_READY" as const) : ("UNAVAILABLE" as const),
    earningsActive: false as const,
    blockers,
    inputs,
    evidence,
  });
}
