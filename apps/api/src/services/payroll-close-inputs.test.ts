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

test("explicit opening debt composes the first close and revisions reject stale approval", () => {
  const input = fixture();
  input.carry.previous = null;
  input.carry.opening = {
    id: "opening",
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    effectiveAt: "2026-08-31T16:00:00.000Z",
    revision: 1,
    firstClose: true,
    completeInventory: true,
    approval: { actorId: "owner", at: "2026-08-31T15:00:00.000Z", reason: "Reviewed opening debt" },
    evidence: { inventoryRevision: 1 },
    staff: [{ staffId: "departed", carryForward: [], fallbackCarryCommission: "-10.0000000000" }],
  };
  const result = resolve(input);
  assert.equal(result.status, "INPUT_EVIDENCE_READY", JSON.stringify(result.blockers));
  assert.deepEqual(result.evidence.requiredStaffIds, ["departed"]);
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const at = "2026-10-01T00:00:00.000Z";
  const draft = calculatePayrollClose(input.state, 0, result.inputs!, actor, at);
  assert.equal(draft.calculation!.statements[0].result.fallbackCarryCommission, "-10.0000000000");
  input.carry.opening.revision++;
  assert.throws(
    () => approvePayrollClose(draft, 1, resolve(input).inputs!, actor, at, "Reviewed"),
    /inputs changed/,
  );
  input.carry.opening.timeZone = "Asia/Kuala_Lumpur";
  assert.throws(() => resolve(input), /inconsistent timezone/);
  input.carry.opening.timeZone = "Asia/Singapore";
  input.carry.opening.staff[0].carryForward = [
    { componentKey: "removed-component", base: "-1", units: "0" },
  ];
  assert.equal(resolve(input).inputs, null);
  const balance = input.carry.opening.staff[0];
  input.carrySettlements = [
    {
      id: "settlement",
      tenantId: "salon",
      periodKey: "2026-09",
      staffId: "departed",
      revision: 1,
      balanceHash: payrollInputHash(balance),
      approval: { actorId: "owner", at, reason: "Reviewed component write-off" },
      evidence: { revision: 1 },
      components: [
        { fromKey: "removed-component", toKey: null, reason: "Reviewed component write-off" },
      ],
      fallbackWriteOff: null,
    },
  ];
  const settled = resolve(input);
  assert.equal(settled.status, "INPUT_EVIDENCE_READY", JSON.stringify(settled.blockers));
  const settledDraft = calculatePayrollClose(input.state, 0, settled.inputs!, actor, at);
  assert.equal(settledDraft.calculation!.statements[0].result.carryWriteOffs.length, 1);
  input.carrySettlements[0].fallbackWriteOff = { amount: balance.fallbackCarryCommission };
  const writtenOff = resolve(input);
  assert.equal(writtenOff.status, "INPUT_EVIDENCE_READY", JSON.stringify(writtenOff.blockers));
  assert.equal(
    calculatePayrollClose(input.state, 0, writtenOff.inputs!, actor, at).calculation!.statements[0]
      .result.fallbackCarryCommission,
    "0.0000000000",
  );
  input.carrySettlements[0].fallbackWriteOff = null;
  input.carrySettlements[0].revision++;
  assert.throws(
    () => approvePayrollClose(settledDraft, 1, resolve(input).inputs!, actor, at, "Reviewed"),
    /inputs changed/,
  );
  delete input.carrySettlements;
  delete input.carry.opening;
  assert.equal(resolve(input).inputs, null);
});

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

test("input composition retains scoped plan and out-of-scope source-rate fallback in one statement", () => {
  const input = withSumIndividualPlan();
  input.configuration.versions[0].definition.incentives = [];
  const assignment = input.configuration.events.find((row) => row.kind === "ASSIGNMENT")!;
  (assignment.payload as { outletIds: string[] }[])[0].outletIds = ["branch"];
  input.metrics[0].groupMetrics = [];
  const original = input.sources.events[0];
  const outside = structuredClone(original);
  Object.assign(outside, {
    id: "outside",
    sourceKey: "outside",
    sourceId: "outside-line",
    outletId: "other",
  });
  const outsideLine = (
    outside.evidence as { lines: { id: string; outletId: string; fallbackRatePct: string }[] }
  ).lines[0];
  Object.assign(outsideLine, { id: "outside-base", outletId: "other", fallbackRatePct: "20" });
  input.sources.events.push(outside);
  input.inventoryOperations.push({
    ...input.inventoryOperations[0],
    sourceId: "outside-line",
    outletId: "other",
  });
  const result = resolve(input);
  assert.equal(result.status, "INPUT_EVIDENCE_READY", JSON.stringify(result.blockers));
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const draft = calculatePayrollClose(
    input.state,
    0,
    result.inputs!,
    actor,
    "2026-10-01T00:00:00.000Z",
  );
  const statement = draft.calculation!.statements[0];
  assert.equal(statement.result.planId, "plan");
  assert.equal(
    statement.result.components.find((row) => row.componentKey === "flat_rules")!.amount,
    "20.00",
  );
  assert.equal(statement.inputs.calculation.lines.length, 2);
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

for (const kind of ["NO_MOVEMENT", "PACKAGE", "SERVICE", "PRODUCT"] as const) {
  const returned = kind !== "NO_MOVEMENT";
  const ordinary = kind === "SERVICE" || kind === "PRODUCT";
  test(`${kind} void composition preserves departed debt and freezes disposition`, () => {
    const input = fixture();
    const at = new Date("2026-09-15T00:00:00Z");
    const before = new Date("2026-08-15T00:00:00Z");
    const capture = {
      version: 1,
      status: "CAPTURED",
      postingStatus: "PENDING_RELEASE",
      currency: "SGD",
    };
    const line = {
      id: "void-original-base",
      staffId: "departed",
      outletId: "branch",
      commissionType: ordinary ? (kind === "SERVICE" ? "SVC" : "PRD") : "PKG_SALE",
      baseAmount: "100.0000",
      units: "1.0000",
      businessDate: "2026-08-15",
      status: "EARNED",
      mode: "FOLLOW_PLAN",
      fallbackRatePct: "10",
    };
    input.sources.lineageEvents = [
      {
        id: "void-original",
        tenantId: "salon",
        sourceKey: "void-original",
        sourceType: ordinary ? "SALE_LINE" : "COLLECTION",
        sourceId: "allocation",
        saleId: "sale",
        outletId: "branch",
        occurredAt: before,
        createdAt: before,
        evidence: { ...capture, lines: [line] },
      },
    ];
    input.sources.events = [
      {
        id: "void-reverse",
        tenantId: "salon",
        sourceKey: "void-reverse",
        sourceType: "REVERSAL",
        sourceId: "void-original",
        saleId: "sale",
        outletId: "branch",
        occurredAt: at,
        createdAt: at,
        evidence: {
          ...capture,
          originalEventId: "void-original",
          lines: [
            {
              ...line,
              id: "void-reverse-base",
              baseAmount: "-100.0000",
              units: "-1.0000",
              businessDate: "2026-09-15",
            },
          ],
        },
      },
    ];
    input.inventoryOperations = [
      {
        tenantId: "salon",
        sourceType: "REVERSAL",
        sourceId: "void-original",
        saleId: "sale",
        outletId: "branch",
        occurredAt: at,
        evidence: { revision: 1 },
      },
    ];
    input.noCashSaleVoids = [
      {
        id: "void",
        tenantId: "salon",
        saleId: "sale",
        outletId: "branch",
        occurredAt: at,
        currency: "SGD",
        cashDisposition: "NO_MOVEMENT",
        netCents: "0",
        taxCents: "0",
        grossCents: "0",
        evidence: { voidRevision: 1, cashDispositionRevision: 1 },
        reversals: [
          {
            eventId: "void-reverse",
            originalEventId: "void-original",
            originalSourceId: "allocation",
            originalSourceType: ordinary ? "SALE_LINE" : "COLLECTION",
          },
        ],
      },
    ];
    if (returned) {
      input.returnedCashSaleVoids = [
        {
          ...input.noCashSaleVoids[0],
          cashDisposition: "RETURNED",
          netCents: "10000",
          taxCents: "900",
          grossCents: "10900",
          payouts: [{ id: "settled-payout", method: "CASH", grossCents: "10900" }],
          allocations: [
            {
              id: "allocation",
              originalEventId: "void-original",
              saleLineId: ordinary ? "allocation" : "package-line",
              itemType: kind,
              netCents: "10000",
              taxCents: "900",
              grossCents: "10900",
              shares: [{ staffId: "departed", share: 10000 }],
              evidence: { revision: 1 },
            },
          ],
        },
      ];
      delete input.noCashSaleVoids;
      input.metrics[0].collection = "-100";
    }
    const result = resolve(input);
    assert.equal(result.status, "INPUT_EVIDENCE_READY", JSON.stringify(result.blockers));
    assert.deepEqual(result.evidence.requiredStaffIds, ["departed"]);
    assert.equal(result.inputs!.staff[0].collection, returned ? "-100.0000" : "0.0000");
    const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
    const closeAt = "2026-10-01T00:00:00.000Z";
    const draft = calculatePayrollClose(input.state, 0, result.inputs!, actor, closeAt);
    assert.equal(draft.calculation!.statements[0].result.fallbackCarryCommission, "-10.0000000000");
    (returned ? input.returnedCashSaleVoids![0] : input.noCashSaleVoids![0]).evidence = {
      voidRevision: 1,
      cashDispositionRevision: 2,
    };
    assert.throws(
      () => approvePayrollClose(draft, 1, resolve(input).inputs!, actor, closeAt, "Reviewed"),
      /inputs changed/,
    );
    delete input.noCashSaleVoids;
    delete input.returnedCashSaleVoids;
    assert.equal(resolve(input).inputs, null);
  });
}

test("ordinary-sale refund composition reconciles cash and rejects stale settlement approval", () => {
  const input = fixture();
  const at = new Date("2026-09-15T00:00:00Z");
  const priorAt = new Date("2026-08-15T00:00:00Z");
  const capture = {
    version: 1,
    status: "CAPTURED",
    postingStatus: "PENDING_RELEASE",
    currency: "SGD",
  };
  const line = {
    id: "sale-original-base",
    staffId: "departed",
    outletId: "branch",
    commissionType: "SVC",
    baseAmount: "100.0000",
    units: "1.0000",
    businessDate: "2026-08-15",
    status: "EARNED",
    mode: "FOLLOW_PLAN",
    fallbackRatePct: "10",
  };
  input.sources.lineageEvents = [
    {
      id: "sale-original",
      tenantId: "salon",
      sourceKey: "sale-original",
      sourceType: "SALE_LINE",
      sourceId: "sale-line",
      saleId: "sale",
      outletId: "branch",
      occurredAt: priorAt,
      createdAt: priorAt,
      evidence: { ...capture, lines: [line] },
    },
  ];
  input.sources.events = [
    {
      id: "sale-reverse",
      tenantId: "salon",
      sourceKey: "sale-reverse",
      sourceType: "REVERSAL",
      sourceId: "sale-original",
      saleId: "sale",
      outletId: "branch",
      occurredAt: at,
      createdAt: at,
      evidence: {
        ...capture,
        originalEventId: "sale-original",
        lines: [
          {
            ...line,
            id: "sale-reverse-base",
            baseAmount: "-100.0000",
            units: "-1.0000",
            businessDate: "2026-09-15",
          },
        ],
      },
    },
  ];
  input.inventoryOperations = [
    {
      tenantId: "salon",
      sourceType: "REVERSAL",
      sourceId: "sale-original",
      saleId: "sale",
      outletId: "branch",
      occurredAt: at,
      evidence: { revision: 1 },
    },
  ];
  input.saleRefunds = [
    {
      id: "sale-refund",
      tenantId: "salon",
      saleId: "sale",
      outletId: "branch",
      occurredAt: at,
      currency: "SGD",
      netCents: "10000",
      taxCents: "900",
      grossCents: "10900",
      evidence: { settledRevision: 1 },
      payouts: [{ method: "CASH", grossCents: "10900" }],
      allocations: [
        {
          id: "sale-allocation",
          saleLineId: "sale-line",
          originalEventId: "sale-original",
          reversalEventId: "sale-reverse",
          itemType: "SERVICE",
          netCents: "10000",
          taxCents: "900",
          grossCents: "10900",
          shares: [{ staffId: "departed", share: 10000 }],
          evidence: { revision: 1 },
        },
      ],
    },
  ];
  input.metrics[0].collection = "-100";
  const result = resolve(input);
  assert.equal(result.status, "INPUT_EVIDENCE_READY", JSON.stringify(result.blockers));
  assert.deepEqual(result.evidence.requiredStaffIds, ["departed"]);
  assert.equal(result.inputs!.staff[0].collection, "-100.0000");
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const closeAt = "2026-10-01T00:00:00.000Z";
  const draft = calculatePayrollClose(input.state, 0, result.inputs!, actor, closeAt);
  assert.equal(draft.calculation!.statements[0].result.fallbackCarryCommission, "-10.0000000000");
  input.saleRefunds[0].evidence = { settledRevision: 2 };
  assert.throws(
    () => approvePayrollClose(draft, 1, resolve(input).inputs!, actor, closeAt, "Reviewed"),
    /inputs changed/,
  );
  input.metrics[0].collection = "0";
  assert.equal(resolve(input).inputs, null);
  input.metrics[0].collection = "-100";
  delete input.saleRefunds;
  assert.equal(resolve(input).inputs, null);
});

test("non-cash reversal composition retains departed debt and freezes operational evidence", () => {
  const input = fixture();
  const at = new Date("2026-09-15T00:00:00Z");
  const priorAt = new Date("2026-08-15T00:00:00Z");
  const capture = {
    version: 1,
    status: "CAPTURED",
    postingStatus: "PENDING_RELEASE",
    currency: "SGD",
  };
  const line = {
    id: "original-base",
    staffId: "departed",
    outletId: "branch",
    commissionType: "PKG_RED",
    baseAmount: "100.0000",
    units: "1.0000",
    businessDate: "2026-08-15",
    status: "EARNED",
    mode: "FOLLOW_PLAN",
    fallbackRatePct: "10",
  };
  input.sources.lineageEvents = [
    {
      id: "original",
      tenantId: "salon",
      sourceKey: "original",
      sourceType: "REDEMPTION",
      sourceId: "usage",
      saleId: "sale",
      outletId: "branch",
      occurredAt: priorAt,
      createdAt: priorAt,
      evidence: { ...capture, lines: [line] },
    },
  ];
  input.sources.events = [
    {
      id: "reverse",
      tenantId: "salon",
      sourceKey: "reverse",
      sourceType: "REVERSAL",
      sourceId: "original",
      saleId: "sale",
      outletId: "branch",
      occurredAt: at,
      createdAt: at,
      evidence: {
        ...capture,
        originalEventId: "original",
        lines: [
          {
            ...line,
            id: "reverse-base",
            baseAmount: "-100.0000",
            units: "-1.0000",
            businessDate: "2026-09-15",
          },
        ],
      },
    },
  ];
  input.inventoryOperations = [
    {
      tenantId: "salon",
      sourceType: "REVERSAL",
      sourceId: "original",
      saleId: "sale",
      outletId: "branch",
      occurredAt: at,
      evidence: { revision: 1 },
    },
  ];
  input.noCashReversals = [
    {
      id: "void-evidence",
      tenantId: "salon",
      eventId: "reverse",
      originalEventId: "original",
      originalSourceId: "usage",
      originalSourceType: "REDEMPTION",
      saleId: "sale",
      outletId: "branch",
      occurredAt: at,
      currency: "SGD",
      netCents: "0",
      taxCents: "0",
      grossCents: "0",
      evidence: { operationalRevision: 1 },
    },
  ];
  const result = resolve(input);
  assert.equal(result.status, "INPUT_EVIDENCE_READY", JSON.stringify(result.blockers));
  assert.deepEqual(result.evidence.requiredStaffIds, ["departed"]);
  assert.equal(result.inputs!.staff[0].collection, "0.0000");
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const closeAt = "2026-10-01T00:00:00.000Z";
  const draft = calculatePayrollClose(input.state, 0, result.inputs!, actor, closeAt);
  assert.equal(draft.calculation!.statements[0].result.fallbackCarryCommission, "-10.0000000000");
  input.noCashReversals[0].evidence = { operationalRevision: 2 };
  assert.throws(
    () => approvePayrollClose(draft, 1, resolve(input).inputs!, actor, closeAt, "Reviewed"),
    /inputs changed/,
  );
  delete input.noCashReversals;
  assert.equal(resolve(input).inputs, null);
});

test("composed refund cash includes departed sellers and payout revisions reject stale approval", () => {
  const input = fixture();
  const at = new Date("2026-09-15T00:00:00Z");
  const line = {
    id: "refund-base",
    staffId: "departed",
    outletId: "branch",
    commissionType: "PKG_SALE",
    baseAmount: "-25.0000",
    units: "0.0000",
    businessDate: "2026-09-15",
    status: "EARNED",
    mode: "EXCLUDE",
    fallbackRatePct: "10",
  };
  const capture = {
    version: 1,
    status: "CAPTURED",
    postingStatus: "PENDING_RELEASE",
    currency: "SGD",
  };
  const money = {
    netCents: "2500",
    taxCents: "225",
    grossCents: "2725",
    payoutMethod: "CASH" as const,
  };
  input.sources.events = [
    {
      id: "refund",
      tenantId: "salon",
      sourceKey: "refund",
      sourceType: "PACKAGE_REFUND",
      sourceId: "holding",
      saleId: "sale",
      outletId: "branch",
      occurredAt: at,
      createdAt: at,
      evidence: {
        ...capture,
        ...money,
        lines: [line],
        originalSourceIds: ["original"],
        purchase: {
          saleId: "sale",
          saleLineId: "package-line",
          sellers: [{ staffId: "departed", share: 10000 }],
        },
      },
    },
  ];
  input.sources.lineageEvents = [
    {
      id: "original",
      tenantId: "salon",
      sourceKey: "original",
      sourceType: "COLLECTION",
      sourceId: "allocation",
      saleId: "sale",
      outletId: "branch",
      occurredAt: new Date("2026-08-15T00:00:00Z"),
      createdAt: new Date("2026-08-15T00:00:00Z"),
      evidence: {
        ...capture,
        lines: [{ ...line, id: "original-base", baseAmount: "100", businessDate: "2026-08-15" }],
      },
    },
  ];
  input.inventoryOperations = [
    {
      tenantId: "salon",
      sourceType: "PACKAGE_REFUND",
      sourceId: "holding",
      saleId: "sale",
      outletId: "branch",
      occurredAt: at,
      evidence: { revision: 1 },
    },
  ];
  input.refundPayouts = [
    {
      ...money,
      id: "payout",
      tenantId: "salon",
      eventId: "refund",
      saleId: "sale",
      saleLineId: "package-line",
      outletId: "branch",
      currency: "SGD",
      occurredAt: at,
      originalAllocations: [
        { allocationId: "allocation", saleLineId: "package-line", netCents: "10000" },
      ],
      evidence: { settledRevision: 1 },
    },
  ];
  input.metrics[0].collection = "-25";
  const result = resolve(input);
  assert.equal(result.status, "INPUT_EVIDENCE_READY", JSON.stringify(result.blockers));
  assert.deepEqual(result.evidence.requiredStaffIds, ["departed"]);
  assert.equal(result.inputs!.staff[0].collection, "-25.0000");
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const closeAt = "2026-10-01T00:00:00.000Z";
  const draft = calculatePayrollClose(input.state, 0, result.inputs!, actor, closeAt);
  input.refundPayouts[0].evidence = { settledRevision: 2 };
  assert.throws(
    () => approvePayrollClose(draft, 1, resolve(input).inputs!, actor, closeAt, "Reviewed"),
    /inputs changed/,
  );
  input.metrics[0].collection = "0";
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
