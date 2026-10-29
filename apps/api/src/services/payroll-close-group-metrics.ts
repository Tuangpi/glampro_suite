import { z } from "zod";
import { payrollIncentiveSchema, type PayrollGroupMetric } from "@glampro_suite/shared";
import {
  resolvePayrollCloseSources,
  type PayrollCloseSourceRecords,
} from "./payroll-close-sources.js";

const id = z.string().trim().min(1).max(128);
const requestSchema = z.object({
  staffId: id,
  planId: id,
  versionId: id,
  outletIds: z.array(id),
  rule: payrollIncentiveSchema,
});
export type PayrollGroupMetricRequest = z.input<typeof requestSchema>;

const ticks = (value: string) => {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return BigInt(whole + fraction.padEnd(4, "0")) * (negative ? -1n : 1n);
};
const decimal = (value: bigint) => {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 10000n}.${(absolute % 10000n).toString().padStart(4, "0")}`;
};

/** Non-DB SUM_INDIVIDUAL resolver. Population is every credited staff member in
 * the validated salon/month source inventory, not just active accounts, recipients
 * of this plan or supplied assertion rows. The recipient rule's metric types and
 * assignment outlets define eligible activity. Fixed/excluded modes still count;
 * negative earned corrections subtract; REVERSED lines fail source validation.
 * This is a base metric, never external cash. Inventory completeness and selected
 * plan authenticity remain the authoritative loader's responsibility. */
export function resolvePayrollCloseGroupMetrics(
  raw: PayrollCloseSourceRecords & {
    requests: PayrollGroupMetricRequest[];
  },
) {
  const sources = resolvePayrollCloseSources(raw);
  const requests = z
    .array(requestSchema)
    .parse(raw.requests)
    .sort((a, b) => a.staffId.localeCompare(b.staffId) || a.rule.key.localeCompare(b.rule.key));
  const keys = requests.map((row) => JSON.stringify([row.staffId, row.rule.key]));
  if (new Set(keys).size !== keys.length)
    throw new Error("Duplicate payroll group metric requests.");
  for (const request of requests) {
    if (new Set(request.outletIds).size !== request.outletIds.length)
      throw new Error("Duplicate payroll group metric assignment outlets.");
    request.outletIds.sort();
    request.rule.individualMetricTypes.sort();
  }
  const blockers: { code: string; staffId: string | null; ruleKey: string | null }[] = [];
  if (!sources.sources)
    blockers.push({ code: "GROUP_SOURCE_EVIDENCE_UNAVAILABLE", staffId: null, ruleKey: null });
  const metrics: {
    staffId: string;
    metric: PayrollGroupMetric;
    population: { staffId: string; amount: string; lineIds: string[] }[];
  }[] = [];
  for (const request of requests) {
    const rule = request.rule;
    if (rule.type !== "GROUP_AND_INDIVIDUAL" || rule.groupMetric !== "SUM_INDIVIDUAL") {
      blockers.push({
        code: "GROUP_REQUEST_NOT_SUM_INDIVIDUAL",
        staffId: request.staffId,
        ruleKey: rule.key,
      });
      continue;
    }
    const lines = sources.sources?.lines ?? [];
    const eligible = lines.filter((line) =>
      rule.individualMetricTypes.includes(line.commissionType),
    );
    if (
      (request.outletIds.length || rule.scope === "OUTLET") &&
      eligible.some((line) => line.outletId === null)
    ) {
      blockers.push({
        code: "GROUP_OUTLET_EVIDENCE_UNAVAILABLE",
        staffId: request.staffId,
        ruleKey: rule.key,
      });
      continue;
    }
    const scoped = eligible.filter(
      (line) => !request.outletIds.length || request.outletIds.includes(line.outletId!),
    );
    // Match the engine: salon rules produce one metric even without recipient
    // activity; outlet rules produce metrics only for outlets where it has activity.
    const outlets: (string | null)[] =
      rule.scope === "SALON"
        ? [null]
        : [
            ...new Set(
              scoped
                .filter((line) => line.staffId === request.staffId)
                .map((line) => line.outletId),
            ),
          ].sort();
    for (const outletId of outlets) {
      const selected = scoped.filter(
        (line) => rule.scope === "SALON" || line.outletId === outletId,
      );
      const staffIds = [...new Set(selected.map((line) => line.staffId))].sort();
      const population = staffIds.map((staffId) => {
        const own = selected.filter((line) => line.staffId === staffId);
        return {
          staffId,
          amount: decimal(own.reduce((sum, line) => sum + ticks(line.baseAmount), 0n)),
          lineIds: own.map((line) => line.id).sort(),
        };
      });
      metrics.push({
        staffId: request.staffId,
        metric: {
          ruleKey: rule.key,
          periodKey: raw.periodKey,
          scope: rule.scope,
          outletId,
          metric: "SUM_INDIVIDUAL",
          amount: decimal(selected.reduce((sum, line) => sum + ticks(line.baseAmount), 0n)),
        },
        population,
      });
    }
  }
  return structuredClone({
    status: blockers.length ? ("UNAVAILABLE" as const) : ("GROUP_METRIC_EVIDENCE_READY" as const),
    earningsActive: false as const,
    blockers,
    groups: blockers.length ? null : { requests, metrics },
  });
}
