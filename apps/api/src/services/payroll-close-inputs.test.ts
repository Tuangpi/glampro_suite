import assert from "node:assert/strict";
import { test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS, hairPayrollExample } from "@glampro_suite/shared";
import {
  resolvePayrollCloseInputs as resolve,
  type PayrollCloseInputRecords,
} from "./payroll-close-inputs.js";
import {
  approvePayrollClose,
  calculatePayrollClose,
  openPayrollClose,
  payrollInputHash,
} from "./payroll-close-state.js";

function fixture(): PayrollCloseInputRecords {
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const previousInputs = {
    periodKey: "2026-08",
    timeZone: "Asia/Singapore",
    startsAt: "2026-07-31T16:00:00.000Z",
    endsAt: "2026-08-31T16:00:00.000Z",
    currency: "SGD" as const,
    evidence: {},
    staff: [],
  };
  const at = "2026-09-01T00:00:00.000Z";
  const draft = calculatePayrollClose(openPayrollClose("2026-08"), 0, previousInputs, actor, at);
  const previous = approvePayrollClose(
    draft,
    1,
    previousInputs,
    actor,
    at,
    "Verified previous close",
  );
  const common = { tenantId: "salon", periodKey: "2026-09", timeZone: "Asia/Singapore" };
  const event = (kind: "SETTINGS" | "STAFF" | "PROFILE", targetId: string, payload: unknown) => ({
    id: `${kind}-${targetId}`,
    tenantId: "salon",
    kind,
    targetId,
    payload,
    revision: 1,
    createdAt: new Date("2026-08-01T00:00:00Z"),
  });
  return {
    cashAttributions: [],
    inventoryOperations: [],
    state: openPayrollClose("2026-09"),
    configuration: {
      ...common,
      requiredStaffIds: [],
      versions: [],
      staff: [{ id: "departed", tenantId: "salon", name: "Departed", disabled: true }],
      events: [
        event("SETTINGS", "company", PAYROLL_DEFAULT_SETTINGS),
        event("STAFF", "departed", {
          joinDate: "2020-01-01",
          stageEndOverride: null,
          commissionRole: "NON_COMMISSION",
        }),
        event("PROFILE", "departed", {
          basicSalary: "0",
          fixedOvertime: "0",
          levy: "0",
          salesAlertPct: "50",
        }),
      ],
    },
    sources: {
      ...common,
      events: [],
      lineageEvents: [],
      operations: [],
      collections: [],
      legacyCommissions: [],
    },
    carry: {
      tenantId: "salon",
      periodKey: "2026-09",
      previous: { id: "previous", tenantId: "salon", state: previous },
    },
    metrics: [
      {
        tenantId: "salon",
        periodKey: "2026-09",
        staffId: "departed",
        collection: "0",
        groupMetrics: [],
        evidence: { revision: 1 },
      },
    ],
  };
}
function withOwedStaff() {
  const input = fixture();
  input.state.adjustments = [
    {
      id: "owed",
      staffId: "departed",
      kind: "ADDITION",
      amount: "20.00",
      reason: "Amount owed",
      actorId: "owner",
    },
  ];
  return input;
}

function withCollectedMoney() {
  const input = fixture();
  const operation = {
    tenantId: "salon",
    sourceType: "SALE_PAYMENT" as const,
    sourceId: "payment",
    saleId: "sale",
    currency: "SGD" as const,
    grossCents: "10900",
    occurredAt: new Date("2026-09-15T00:00:00Z"),
  };
  input.sources.operations = [operation];
  input.sources.collections = [
    {
      ...operation,
      id: "collection",
      allocations: [
        {
          id: "allocation",
          tenantId: "salon",
          collectionId: "collection",
          saleLineId: "service-line",
          itemType: "SERVICE",
          grossCents: "10900",
          netCents: "10000",
          taxCents: "900",
        },
      ],
    },
  ];
  input.cashAttributions = [
    {
      tenantId: "salon",
      allocationId: "allocation",
      saleLineId: "service-line",
      outletId: "branch",
      shares: [{ staffId: "departed", share: 10000 }],
      evidence: { revision: 1 },
    },
  ];
  input.metrics[0].collection = "100";
  return input;
}

function withSumIndividualPlan() {
  const input = withCollectedMoney();
  const definition = hairPayrollExample();
  definition.incentives = [
    {
      key: "group",
      name: "Group",
      type: "GROUP_AND_INDIVIDUAL",
      groupMetric: "SUM_INDIVIDUAL",
      scope: "SALON",
      individualMetricTypes: ["SVC"],
      rows: [{ individualTarget: "100", groupTarget: "100", amount: "50" }],
    },
  ];
  input.configuration.versions = [
    {
      tenantId: "salon",
      id: "version",
      planId: "plan",
      versionNo: 1,
      status: "PUBLISHED",
      effectiveFrom: "2026-09-01",
      definition,
    },
  ];
  input.configuration.events.find((row) => row.kind === "STAFF")!.payload = {
    joinDate: "2020-01-01",
    stageEndOverride: null,
    commissionRole: "COMMISSION_EARNING",
  };
  input.configuration.events.push({
    id: "assignment",
    tenantId: "salon",
    kind: "ASSIGNMENT",
    targetId: "company",
    revision: 1,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    payload: [
      {
        id: "assigned",
        staffId: "departed",
        planId: "plan",
        fromDate: "2026-09-01",
        toDate: null,
        outletIds: [],
      },
    ],
  });
  const operation = {
    tenantId: "salon",
    sourceType: "SALE_LINE" as const,
    sourceId: "service-line",
    saleId: "sale",
    outletId: "branch",
    occurredAt: input.sources.operations[0].occurredAt,
    evidence: { revision: 1 },
  };
  input.inventoryOperations = [operation];
  input.sources.events = [
    {
      ...operation,
      id: "service",
      sourceKey: "service",
      createdAt: operation.occurredAt,
      evidence: {
        version: 1,
        status: "CAPTURED",
        postingStatus: "PENDING_RELEASE",
        currency: "SGD",
        lines: [
          {
            id: "base",
            staffId: "departed",
            outletId: "branch",
            commissionType: "SVC",
            baseAmount: "100",
            units: "1",
            businessDate: "2026-09-15",
            status: "EARNED",
            mode: "FOLLOW_PLAN",
            fallbackRatePct: "10",
          },
        ],
      },
    },
  ];
  input.metrics[0].groupMetrics = [
    {
      ruleKey: "group",
      periodKey: "2026-09",
      scope: "SALON",
      outletId: null,
      metric: "SUM_INDIVIDUAL",
      amount: "100",
    },
  ];
  return input;
}

test("selected-plan sum-individual is derived, frozen and reaches the incentive engine", () => {
  const input = withSumIndividualPlan();
  const result = resolve(input);
  assert.equal(result.status, "INPUT_EVIDENCE_READY");
  assert.equal(result.inputs!.staff[0].calculation.groupMetrics![0].amount, "100.0000");
  assert.deepEqual(result.evidence.groups.groups!.metrics[0].population[0].lineIds, ["base"]);
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const close = calculatePayrollClose(
    input.state,
    0,
    result.inputs!,
    actor,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(close.calculation!.statements[0].result.incentiveTotal, "50.00");
});

test("sum-individual assertions cannot alter amount, month, scope or rule identity", () => {
  for (const change of [
    { amount: "999" },
    { periodKey: "2026-08" },
    { scope: "OUTLET", outletId: "branch" },
    { ruleKey: "unselected" },
  ]) {
    const input = withSumIndividualPlan();
    Object.assign(input.metrics[0].groupMetrics[0], change);
    assert.equal(resolve(input).inputs, null);
    assert.ok(resolve(input).blockers.some((row) => row.code === "SUM_INDIVIDUAL_MISMATCH"));
  }
  const missing = withSumIndividualPlan();
  missing.metrics[0].groupMetrics = [];
  assert.equal(resolve(missing).inputs, null);
});

test("changed group population invalidates a previously calculated approval", () => {
  const input = withSumIndividualPlan();
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const at = "2026-10-01T00:00:00.000Z";
  const draft = calculatePayrollClose(input.state, 0, resolve(input).inputs!, actor, at);
  (input.sources.events[0].evidence as { lines: { baseAmount: string }[] }).lines[0].baseAmount =
    "101";
  input.metrics[0].groupMetrics[0].amount = "101";
  const changed = resolve(input);
  assert.equal(changed.status, "INPUT_EVIDENCE_READY");
  assert.throws(
    () => approvePayrollClose(draft, 1, changed.inputs!, actor, at, "Reviewed population"),
    /inputs changed/,
  );
});

test("collection-only activity retains departed staff and verifies salary denominator", () => {
  const input = withCollectedMoney();
  const result = resolve(input);
  assert.equal(result.status, "INPUT_EVIDENCE_READY");
  assert.deepEqual(result.evidence.requiredStaffIds, ["departed"]);
  assert.equal(result.inputs!.staff[0].collection, "100.0000");
  input.metrics[0].collection = "109";
  assert.ok(resolve(input).blockers.some((row) => row.code === "STAFF_COLLECTION_MISMATCH"));
  assert.equal(resolve(input).inputs, null);
});

test("salon/outlet group cash totals must match scope, month and reconciled money", () => {
  const input = withCollectedMoney();
  input.metrics[0].groupMetrics = [
    {
      ruleKey: "salon",
      periodKey: "2026-09",
      scope: "SALON",
      outletId: null,
      metric: "SALON_CASH",
      amount: "100",
    },
    {
      ruleKey: "branch",
      periodKey: "2026-09",
      scope: "OUTLET",
      outletId: "branch",
      metric: "SALON_CASH",
      amount: "100.0000",
    },
  ];
  assert.equal(resolve(input).status, "INPUT_EVIDENCE_READY");
  for (const change of [
    { amount: "109" },
    { periodKey: "2026-08" },
    { outletId: "unknown" },
    { outletId: null },
  ]) {
    const changed = structuredClone(input);
    Object.assign(changed.metrics[0].groupMetrics[1], change);
    assert.ok(resolve(changed).blockers.some((row) => row.code === "GROUP_COLLECTION_MISMATCH"));
  }
});

test("sum-individual and missing cash attribution fail closed rather than trusting totals", () => {
  const input = withCollectedMoney();
  input.metrics[0].groupMetrics = [
    {
      ruleKey: "group",
      periodKey: "2026-09",
      scope: "SALON",
      outletId: null,
      metric: "SUM_INDIVIDUAL",
      amount: "100",
    },
  ];
  assert.ok(resolve(input).blockers.some((row) => row.code === "SUM_INDIVIDUAL_MISMATCH"));
  input.metrics[0].groupMetrics = [];
  input.cashAttributions = [];
  assert.equal(resolve(input).inputs, null);
});

test("cash attribution revisions invalidate approval even when totals are unchanged", () => {
  const input = withCollectedMoney();
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const at = "2026-10-01T00:00:00.000Z";
  const draft = calculatePayrollClose(input.state, 0, resolve(input).inputs!, actor, at);
  input.cashAttributions[0].evidence = { revision: 2 };
  assert.throws(
    () => approvePayrollClose(draft, 1, resolve(input).inputs!, actor, at, "Reviewed cash"),
    /inputs changed/,
  );
});

test("owed disabled staff is included before configuration; adjustments remain close-owned", () => {
  const input = withOwedStaff();
  const result = resolve(input);
  assert.equal(result.status, "INPUT_EVIDENCE_READY");
  assert.equal(result.earningsActive, false);
  assert.equal(result.inputs!.staff[0].staff.disabled, true);
  assert.deepEqual(result.inputs!.staff[0].adjustments, []);
  const actor = { id: "manager", role: "MANAGER", disabled: false, twoFactorEnabled: false };
  const calculated = calculatePayrollClose(
    input.state,
    0,
    result.inputs!,
    actor,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(calculated.calculation!.statements[0].payroll.takeHome, "20.00");
});

test("missing carry and staff metrics never become assumed zero", () => {
  const input = withOwedStaff();
  input.carry.previous = null;
  assert.equal(resolve(input).inputs, null);
  const noMetrics = withOwedStaff();
  noMetrics.metrics = [];
  assert.ok(resolve(noMetrics).blockers.some((row) => row.code === "STAFF_METRICS_UNAVAILABLE"));
});

test("activity alone retains departed staff and flows into close earnings", () => {
  const input = fixture();
  const operation = {
    tenantId: "salon",
    sourceType: "SALE_LINE" as const,
    sourceId: "service-line",
    saleId: "sale",
    outletId: "branch",
    occurredAt: new Date("2026-09-15T00:00:00Z"),
    evidence: { revision: 1 },
  };
  input.inventoryOperations = [operation];
  input.sources.events = [
    {
      ...operation,
      id: "source",
      sourceKey: "service",
      createdAt: operation.occurredAt,
      evidence: {
        version: 1,
        status: "CAPTURED",
        postingStatus: "PENDING_RELEASE",
        currency: "SGD",
        lines: [
          {
            id: "base",
            staffId: "departed",
            outletId: "branch",
            commissionType: "SVC",
            baseAmount: "100",
            units: "1",
            businessDate: "2026-09-15",
            status: "EARNED",
            mode: "FOLLOW_PLAN",
            fallbackRatePct: "10",
          },
        ],
      },
    },
  ];
  const result = resolve(input);
  assert.equal(result.status, "INPUT_EVIDENCE_READY");
  assert.deepEqual(result.evidence.requiredStaffIds, ["departed"]);
  const actor = { id: "manager", role: "MANAGER", disabled: false, twoFactorEnabled: false };
  const close = calculatePayrollClose(
    input.state,
    0,
    result.inputs!,
    actor,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(close.calculation!.statements[0].payroll.commission, "10.00");
  input.inventoryOperations = [];
  assert.equal(resolve(input).inputs, null);
});

test("prior frozen commission debt retains departed staff without current activity", () => {
  const input = fixture();
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const previousInputs = structuredClone(input.carry.previous!.state.calculation!.inputs);
  previousInputs.staff = [
    {
      staff: { id: "departed", name: "Departed", disabled: true },
      profile: { basicSalary: "0", fixedOvertime: "0", levy: "0", salesAlertPct: "50" },
      profileRevision: 1,
      adjustments: [],
      collection: "0",
      calculation: {
        staffId: "departed",
        periodKey: "2026-08",
        joinDate: "2020-01-01",
        plan: null,
        lines: [
          {
            id: "refund",
            staffId: "departed",
            outletId: "branch",
            commissionType: "SVC",
            baseAmount: "-100",
            units: "-1",
            businessDate: "2026-08-15",
            status: "EARNED",
            mode: "FOLLOW_PLAN",
            fallbackRatePct: "10",
          },
        ],
      },
    },
  ];
  const at = "2026-09-01T00:00:00.000Z";
  const draft = calculatePayrollClose(openPayrollClose("2026-08"), 0, previousInputs, actor, at);
  input.carry.previous!.state = approvePayrollClose(
    draft,
    1,
    previousInputs,
    actor,
    at,
    "Debt verified",
  );
  const result = resolve(input);
  assert.equal(result.status, "INPUT_EVIDENCE_READY");
  assert.deepEqual(result.evidence.requiredStaffIds, ["departed"]);
  assert.equal(result.inputs!.staff[0].calculation.fallbackCarryCommission, "-10.0000000000");
  const close = calculatePayrollClose(
    input.state,
    0,
    result.inputs!,
    actor,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(close.calculation!.statements[0].result.fallbackCarryCommission, "-10.0000000000");
  assert.equal(close.calculation!.statements[0].payroll.takeHome, "0.00");
});

test("approval rechecks the complete composed evidence and approved outputs stay frozen", () => {
  const input = withOwedStaff();
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const at = "2026-10-01T00:00:00.000Z";
  const draft = calculatePayrollClose(input.state, 0, resolve(input).inputs!, actor, at);
  const approved = approvePayrollClose(
    draft,
    1,
    resolve(input).inputs!,
    actor,
    at,
    "Evidence reviewed",
  );
  const frozen = payrollInputHash(approved.calculation);
  input.metrics[0].evidence = { revision: 2 };
  assert.throws(
    () => approvePayrollClose(draft, 1, resolve(input).inputs!, actor, at, "Evidence reviewed"),
    /inputs changed/,
  );
  input.configuration.events.find((row) => row.kind === "PROFILE")!.payload = {
    basicSalary: "5000",
    fixedOvertime: "0",
    levy: "0",
    salesAlertPct: "50",
  };
  assert.equal(payrollInputHash(approved.calculation), frozen);
  assert.equal(approved.calculation!.statements[0].payroll.takeHome, "20.00");
});

test("unresolved owed staff identity blocks the complete assembly", () => {
  const input = withOwedStaff();
  input.configuration.staff = [];
  assert.equal(resolve(input).inputs, null);
});

test("tenant/month/timezone mismatch and foreign or duplicate metrics are rejected", () => {
  const input = withOwedStaff();
  input.sources.tenantId = "foreign";
  assert.throws(() => resolve(input), /scope/);
  const zone = withOwedStaff();
  zone.sources.timeZone = "UTC";
  assert.throws(() => resolve(zone), /timezone/);
  const metric = withOwedStaff();
  metric.metrics[0].periodKey = "2026-08";
  assert.throws(() => resolve(metric), /another salon or month/);
  const duplicate = withOwedStaff();
  duplicate.metrics.push(structuredClone(duplicate.metrics[0]));
  assert.throws(() => resolve(duplicate), /Duplicate/);
});

test("unselected metric staff and non-JSON evidence fail closed", () => {
  assert.equal(resolve(fixture()).inputs, null);
  const input = withOwedStaff();
  input.metrics[0].evidence = new Date();
  assert.throws(() => resolve(input), /JSON/);
});

test("assembled input and retained evidence are detached, hashable and revision-sensitive", () => {
  const input = withOwedStaff();
  const before = structuredClone(input);
  const result = resolve(input);
  assert.deepEqual(input, before);
  assert.doesNotThrow(() => payrollInputHash(result));
  result.inputs!.staff[0].staff.name = "Changed";
  assert.equal(input.configuration.staff[0].name, "Departed");
  const oldHash = payrollInputHash(resolve(input));
  input.metrics[0].evidence = { revision: 2 };
  assert.notEqual(payrollInputHash(resolve(input)), oldHash);
});
