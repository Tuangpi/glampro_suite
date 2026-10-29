import assert from "node:assert/strict";
import { test } from "node:test";
import type { PayrollBaseLine } from "@glampro_suite/shared";
import {
  resolvePayrollCloseGroupMetrics as resolve,
  type PayrollGroupMetricRequest,
} from "./payroll-close-group-metrics.js";
import type { PayrollCloseSourceRecords } from "./payroll-close-sources.js";
import { payrollInputHash } from "./payroll-close-state.js";

function line(
  id: string,
  staffId: string,
  baseAmount: string,
  extra: Partial<PayrollBaseLine> = {},
): PayrollBaseLine {
  return {
    id,
    staffId,
    baseAmount,
    units: "1",
    businessDate: "2026-09-15",
    outletId: "branch",
    commissionType: "SVC",
    mode: "FOLLOW_PLAN",
    status: "EARNED",
    fallbackRatePct: "10",
    ...extra,
  };
}
function fixture(): PayrollCloseSourceRecords & { requests: PayrollGroupMetricRequest[] } {
  const lines = [line("own", "recipient", "100"), line("other", "departed", "200")];
  return {
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    lineageEvents: [],
    events: lines.map((row) => ({
      id: `event-${row.id}`,
      tenantId: "salon",
      sourceKey: `source-${row.id}`,
      sourceType: "SALE_LINE",
      sourceId: row.id,
      saleId: "sale",
      outletId: row.outletId,
      occurredAt: new Date("2026-09-15T00:00:00Z"),
      createdAt: new Date("2026-09-15T00:00:00Z"),
      evidence: {
        version: 1,
        status: "CAPTURED",
        postingStatus: "PENDING_RELEASE",
        currency: "SGD",
        lines: [row],
      },
    })),
    requests: [
      {
        staffId: "recipient",
        planId: "plan",
        versionId: "version",
        outletIds: [],
        rule: {
          key: "group",
          name: "Group",
          type: "GROUP_AND_INDIVIDUAL",
          groupMetric: "SUM_INDIVIDUAL",
          scope: "SALON",
          individualMetricTypes: ["SVC"],
          rows: [{ individualTarget: "100", groupTarget: "300", amount: "50" }],
        },
      },
    ],
  };
}
function changeLine(
  input: ReturnType<typeof fixture>,
  index: number,
  change: Partial<PayrollBaseLine>,
) {
  Object.assign((input.events[index].evidence as { lines: PayrollBaseLine[] }).lines[0], change);
}

test("sum-individual includes all source staff, including departed and different-plan populations", () => {
  const result = resolve(fixture());
  assert.equal(result.status, "GROUP_METRIC_EVIDENCE_READY");
  assert.equal(result.earningsActive, false);
  assert.equal(result.groups!.metrics[0].metric.amount, "300.0000");
  assert.deepEqual(
    result.groups!.metrics[0].population.map((row) => row.staffId),
    ["departed", "recipient"],
  );
});

test("configured metric types filter activity without using component exclusions or fixed earnings", () => {
  const input = fixture();
  changeLine(input, 1, { mode: "EXCLUDE" });
  assert.equal(resolve(input).groups!.metrics[0].metric.amount, "300.0000");
  changeLine(input, 1, { mode: "FIXED", fixedCommission: "999" });
  assert.equal(resolve(input).groups!.metrics[0].metric.amount, "300.0000");
  changeLine(input, 1, { mode: "FIXED", commissionType: "PRD" });
  assert.equal(resolve(input).groups!.metrics[0].metric.amount, "100.0000");
});

test("negative earned activity subtracts exactly with signed four-decimal totals", () => {
  const input = fixture();
  changeLine(input, 0, { baseAmount: "0.0001" });
  changeLine(input, 1, { baseAmount: "-0.0002" });
  assert.equal(resolve(input).groups!.metrics[0].metric.amount, "-0.0001");
});

test("assignment outlets constrain salon totals and outlet rules use recipient activity outlets", () => {
  const input = fixture();
  input.events[1].outletId = "other";
  changeLine(input, 1, { outletId: "other" });
  input.requests[0].outletIds = ["branch"];
  assert.equal(resolve(input).groups!.metrics[0].metric.amount, "100.0000");
  input.requests[0].outletIds = [];
  input.requests[0].rule.scope = "OUTLET";
  const result = resolve(input);
  assert.equal(result.groups!.metrics.length, 1);
  assert.equal(result.groups!.metrics[0].metric.outletId, "branch");
  assert.equal(result.groups!.metrics[0].metric.amount, "100.0000");
});

test("missing outlet attribution blocks scoped populations rather than silently dropping staff", () => {
  const input = fixture();
  input.events[1].outletId = null;
  changeLine(input, 1, { outletId: null });
  input.requests[0].rule.scope = "OUTLET";
  assert.equal(resolve(input).groups, null);
});

test("invalid, foreign and duplicate source evidence cannot form group totals", () => {
  const input = fixture();
  input.events[1].evidence = {};
  assert.equal(resolve(input).groups, null);
  const foreign = fixture();
  foreign.events[0].tenantId = "foreign";
  assert.throws(() => resolve(foreign), /another salon/);
  const duplicate = fixture();
  duplicate.events.push(structuredClone(duplicate.events[0]));
  assert.throws(() => resolve(duplicate), /Duplicate/);
});

test("duplicate requests/outlets and non-sum rules are rejected or unavailable", () => {
  const input = fixture();
  input.requests.push(structuredClone(input.requests[0]));
  assert.throws(() => resolve(input), /Duplicate/);
  const outlets = fixture();
  outlets.requests[0].outletIds = ["branch", "branch"];
  assert.throws(() => resolve(outlets), /Duplicate/);
  const cash = fixture();
  cash.requests[0].rule.groupMetric = "SALON_CASH";
  assert.equal(resolve(cash).groups, null);
});

test("salon zero and absent recipient outlet activity match engine metric cardinality", () => {
  const input = fixture();
  input.events = [];
  assert.equal(resolve(input).groups!.metrics[0].metric.amount, "0.0000");
  input.requests[0].rule.scope = "OUTLET";
  assert.deepEqual(resolve(input).groups!.metrics, []);
});

test("split line totals conserve residuals and do not multiply by population size", () => {
  const input = fixture();
  changeLine(input, 0, { baseAmount: "33.3333" });
  changeLine(input, 1, { baseAmount: "66.6667" });
  assert.equal(resolve(input).groups!.metrics[0].metric.amount, "100.0000");
  input.requests.push({ ...structuredClone(input.requests[0]), staffId: "departed" });
  assert.deepEqual(
    resolve(input).groups!.metrics.map((row) => row.metric.amount),
    ["100.0000", "100.0000"],
  );
});

test("population evidence is deterministic, detached and sensitive to rule/source changes", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = resolve(input);
  assert.deepEqual(input, before);
  input.events.reverse();
  assert.equal(payrollInputHash(resolve(input)), payrollInputHash(result));
  result.groups!.metrics[0].population[0].lineIds.push("changed");
  assert.deepEqual(input, { ...before, events: [...before.events].reverse() });
  const old = payrollInputHash(resolve(input));
  changeLine(input, 0, { baseAmount: "201" });
  assert.notEqual(payrollInputHash(resolve(input)), old);
});
