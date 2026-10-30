import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { capturePayrollPackagePurchase, type PayrollPackageSettings } from "@glampro_suite/shared";
import { payrollSessionEvidence } from "./payroll-package-session.js";
import { redemptionCommissionEvidenceSchema } from "./redemption-commission-evidence.js";
import { Prisma } from "../../generated/prisma/client.js";
import { runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { loadPayrollPackageRedemptionHistory } from "./payroll-close-redemption-loader.js";
import { loadPayrollSalePackageCoverage } from "./payroll-close-sale-coverage.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";
import {
  verifyPayrollPackageRedemption,
  verifyPayrollPackageRedemptionInventory,
  verifyPayrollRedemptionCorrections,
  verifyPayrollRedemptionVoid,
} from "./payroll-close-package-redemption.js";

function fixture(mode: "FOLLOW_PLAN" | "EXCLUDE" | "FIXED" = "FOLLOW_PLAN") {
  const at = new Date("2026-09-15T00:00:00.000Z");
  const performers = [
    { staffId: "performer", share: 3333 },
    { staffId: "z-other", share: 6667 },
  ];
  const settings: PayrollPackageSettings = {
    sale: { mode: "FOLLOW_PLAN" },
    redemption: mode === "FIXED" ? { mode, amount: "1.23" } : { mode },
    minimumDepositPct: "30",
  };
  const purchase = capturePayrollPackagePurchase({
    saleId: "original-sale",
    saleLineId: "original-line",
    packageId: "package",
    originalCustomerId: "original-buyer",
    outletId: "original-outlet",
    purchasedAt: "2026-08-01T00:00:00.000Z",
    currency: "SGD",
    grantedSessions: 3,
    netCents: "10000",
    taxCents: "900",
    grossCents: "10900",
    sellers: [{ staffId: "seller", share: 10000 }],
    commissionSettings: settings,
  });
  const session = payrollSessionEvidence(
    "holding",
    { purchase, ordinals: [{ first: 1, last: 2 }], missingEvidence: [] },
    performers,
  );
  const evidence = {
    version: 1,
    payrollSession: session,
    coverage: [{ saleLineId: "service-line", serviceId: "service", quantity: 2, performers }],
    performers,
    attributionStatus: "CONSISTENT_LINES",
    valuation: null,
    evaluatedAt: at.toISOString(),
    rates: [],
    postingStatus: "PENDING_RELEASE",
    previousSnapshotId: null,
  };
  const input = {
    tenantId: "salon",
    timeZone: "Asia/Singapore",
    purchase,
    redemptionRules: {
      mode: "PER_UNIT",
      requirements: [{ serviceId: "service", quantity: 1 }],
    } as unknown,
    redemption: {
      id: "redemption",
      tenantId: "salon",
      saleId: "usage-sale",
      itemType: "PACKAGE",
      itemId: "package",
      holdingId: "holding",
      quantity: 2,
      usedAt: at,
      revertedAt: null as Date | null,
    },
    snapshot: {
      id: "snapshot",
      eventKey: "capture:redemption",
      actorId: "owner",
      reason: "Original capture",
      tenantId: "salon",
      redemptionId: "redemption",
      revision: 0,
      eventType: "CAPTURE",
      eventHash: "",
      evidence,
    },
    sale: {
      tenantId: "salon",
      id: "usage-sale",
      outletId: "usage-outlet",
      status: "COMPLETED",
      soldAt: at,
    },
    coverageLines: [
      {
        id: "service-line",
        tenantId: "salon",
        saleId: "usage-sale",
        itemType: "SERVICE",
        itemId: "service",
        quantity: 2,
      },
    ],
    event: {
      actorId: "owner",
      reason: "Original capture",
      id: "event",
      sourceKey: "redemption:redemption:0",
      tenantId: "salon",
      sourceType: "REDEMPTION",
      sourceId: "redemption",
      saleId: "usage-sale",
      outletId: "usage-outlet",
      occurredAt: at,
      createdAt: at,
      evidence: {
        version: 1,
        status: "CAPTURED",
        postingStatus: "PENDING_RELEASE",
        currency: "SGD",
        itemId: "package",
        lines: session.bases.map((base, index) => ({
          id: `base-${index}`,
          staffId: base.staffId,
          outletId: "usage-outlet",
          commissionType: "PKG_RED",
          baseAmount: base.amount,
          units: session.units[index].amount,
          businessDate: "2026-09-15",
          mode,
          status: "EARNED",
          fallbackRatePct: "0",
          ...(mode === "FIXED" ? { fixedCommission: index === 0 ? "0.8200" : "1.6400" } : {}),
        })),
        rateProvenance: {
          version: 1,
          rateAt: at.toISOString(),
          itemId: "package",
          category: null,
          selections: performers.map((person) => ({
            staffId: person.staffId,
            legacyServiceRate: "80",
            selection: { rate: "0", source: "NONE", ruleId: null },
          })),
        },
      },
    },
    rules: [],
  };
  const rehash = () => {
    input.snapshot.eventHash = createHash("sha256")
      .update(JSON.stringify(input.snapshot.evidence))
      .digest("hex");
  };
  rehash();
  return { input, rehash };
}

test("redemption evidence replays original session residuals and performer splits for every policy", () => {
  for (const mode of ["FOLLOW_PLAN", "EXCLUDE", "FIXED"] as const) {
    const { input } = fixture(mode);
    const verified = verifyPayrollPackageRedemption(input);
    assert.equal(verified.session.baseAmount, "66.6667");
    assert.deepEqual(
      verified.session.units.map((row) => row.amount),
      ["0.6666", "1.3334"],
    );
    assert.notEqual(verified.purchase.outletId, input.sale.outletId);
    assert.equal(verified.provenance.selections[0].selection.rate, "0");
    verified.session.bases[0].amount = "999.0000";
    assert.notEqual(verifyPayrollPackageRedemption(input).session.bases[0].amount, "999.0000");
  }
});

test("redemption evidence rejects contradictory identities, history, coverage, ordinals and captures", () => {
  type Input = ReturnType<typeof fixture>["input"];
  const mutations: ((input: Input) => void)[] = [
    (i) => {
      i.redemption.tenantId = "foreign";
    },
    (i) => {
      i.snapshot.tenantId = "foreign";
    },
    (i) => {
      i.event.tenantId = "foreign";
    },
    (i) => {
      i.redemption.holdingId = "other";
    },
    (i) => {
      i.redemption.itemId = "other";
    },
    (i) => {
      i.redemption.quantity = 1;
    },
    (i) => {
      i.redemption.revertedAt = i.redemption.usedAt;
    },
    (i) => {
      i.snapshot.revision = 1;
    },
    (i) => {
      i.snapshot.eventType = "CORRECTION";
    },
    (i) => {
      i.snapshot.redemptionId = "other";
    },
    (i) => {
      i.snapshot.evidence.payrollSession.ordinals = [
        { first: 1, last: 1 },
        { first: 1, last: 1 },
      ];
    },
    (i) => {
      i.snapshot.evidence.payrollSession.ordinals = [{ first: 3, last: 4 }];
    },
    (i) => {
      i.snapshot.evidence.payrollSession.baseAmount = "66.6600";
    },
    (i) => {
      i.snapshot.evidence.payrollSession.bases[0].amount = "66.6667";
    },
    (i) => {
      i.snapshot.evidence.coverage.push(i.snapshot.evidence.coverage[0]);
    },
    (i) => {
      i.snapshot.evidence.coverage[0].quantity = 3;
    },
    (i) => {
      i.snapshot.evidence.coverage[0].serviceId = "other";
    },
    (i) => {
      i.coverageLines[0].tenantId = "other";
    },
    (i) => {
      i.coverageLines = [];
    },
    (i) => {
      i.coverageLines[0].quantity = Number.NaN;
    },
    (i) => {
      i.coverageLines[0].quantity = 2.5;
    },
    (i) => {
      i.sale.status = "VOIDED";
    },
    (i) => {
      i.event.sourceType = "COLLECTION";
    },
    (i) => {
      i.event.evidence.lines[0].baseAmount = "999.0000";
    },
    (i) => {
      i.event.evidence.lines[0].businessDate = "2026-09-14";
    },
    (i) => {
      i.event.evidence.lines[0].status = "PAID";
    },
    (i) => {
      i.event.evidence.lines[0].fixedCommission = "1.0000";
    },
    (i) => {
      i.event.evidence.lines[0].fallbackRatePct = "80";
    },
  ];
  for (const mutate of mutations) {
    const { input, rehash } = fixture();
    mutate(input);
    rehash();
    assert.throws(
      () => verifyPayrollPackageRedemption(input),
      /EVIDENCE_UNCONFIRMED|RATE_PROVENANCE_UNCONFIRMED/,
    );
  }
  const { input } = fixture();
  input.snapshot.eventHash = "altered";
  assert.throws(() => verifyPayrollPackageRedemption(input), /EVIDENCE_UNCONFIRMED/);
});

test("explicit tender performers need not match line performers and fixed awards scale per session", () => {
  const { input, rehash } = fixture("FIXED");
  input.snapshot.evidence.attributionStatus = "EXPLICIT_TENDER";
  input.snapshot.evidence.coverage[0].performers = [{ staffId: "line-performer", share: 10000 }];
  rehash();
  const verified = verifyPayrollPackageRedemption(input);
  assert.equal(verified.session.baseAmount, "66.6667");
  assert.deepEqual(
    input.event.evidence.lines.map((row) => row.fixedCommission),
    ["0.8200", "1.6400"],
  );
  input.event.evidence.lines[0].fixedCommission = "1.2300";
  assert.throws(() => verifyPayrollPackageRedemption(input), /EVIDENCE_UNCONFIRMED/);
});

test("redemption rate replay uses package-redemption rules, not sale or legacy service rates", () => {
  const { input } = fixture();
  const rule = {
    id: "redemption-rule",
    tenantId: "salon",
    staffId: "performer",
    itemKind: "PACKAGE_REDEMPTION",
    scope: "ITEM",
    targetId: "package",
    rate: "10",
    effectiveAt: new Date("2026-09-01T00:00:00Z"),
    createdAt: new Date("2026-09-01T00:00:00Z"),
  };
  const verify = (itemKind: string) =>
    verifyPayrollPackageRedemption({ ...input, rules: [{ ...rule, itemKind }] });
  assert.doesNotThrow(() => verify("PACKAGE_SALE"));
  assert.doesNotThrow(() => verify("SERVICE"));
  assert.throws(() => verify("PACKAGE_REDEMPTION"), /RATE_PROVENANCE_UNCONFIRMED/);
});

test("redemption coverage requires original rules and exact per-unit session quantities", () => {
  for (const rules of [
    null,
    {},
    { mode: "PER_UNIT", requirements: [] },
    { mode: "PER_UNIT", requirements: [{ serviceId: "other", quantity: 1 }] },
    {
      mode: "PER_UNIT",
      requirements: [
        { serviceId: "service", quantity: 1 },
        { serviceId: "service", quantity: 1 },
      ],
    },
  ]) {
    const { input } = fixture();
    input.redemptionRules = rules;
    assert.throws(() => verifyPayrollPackageRedemption(input), /EVIDENCE_UNCONFIRMED/);
  }
  for (const quantity of [1, 3]) {
    const { input, rehash } = fixture();
    input.coverageLines[0].quantity = 3;
    input.snapshot.evidence.coverage[0].quantity = quantity;
    rehash();
    assert.throws(() => verifyPayrollPackageRedemption(input), /EVIDENCE_UNCONFIRMED/);
  }
  const { input } = fixture();
  input.event.sourceKey = "redemption:other:0";
  assert.throws(() => verifyPayrollPackageRedemption(input), /EVIDENCE_UNCONFIRMED/);
});

test("whole-set redemption coverage reconciles every required service per session", () => {
  const { input, rehash } = fixture();
  input.redemptionRules = {
    mode: "SERVICE_SET",
    requirements: [
      { serviceId: "service", quantity: 2 },
      { serviceId: "second-service", quantity: 1 },
    ],
  };
  input.coverageLines[0].quantity = 4;
  input.coverageLines.push({
    ...input.coverageLines[0],
    id: "second-line",
    itemId: "second-service",
    quantity: 2,
  });
  input.snapshot.evidence.coverage[0].quantity = 4;
  input.snapshot.evidence.coverage.push({
    ...input.snapshot.evidence.coverage[0],
    saleLineId: "second-line",
    serviceId: "second-service",
    quantity: 2,
  });
  rehash();
  assert.equal(verifyPayrollPackageRedemption(input).session.baseAmount, "66.6667");
  input.snapshot.evidence.coverage[1].quantity = 1;
  rehash();
  assert.throws(() => verifyPayrollPackageRedemption(input), /EVIDENCE_UNCONFIRMED/);
  input.snapshot.evidence.coverage[1].quantity = 2;
  input.snapshot.evidence.coverage[0].quantity = 3;
  rehash();
  assert.throws(() => verifyPayrollPackageRedemption(input), /EVIDENCE_UNCONFIRMED/);
});

function correctionFixture() {
  const original = fixture().input;
  const at = new Date("2026-10-05T00:00:00Z");
  // Keep request ordering distinct from the writer's canonical performer order.
  const request = {
    expectedRevision: 0,
    idempotencyKey: "correction-test-01",
    performers: [
      { staffId: "z-other", share: 5000 },
      { staffId: "performer", share: 5000 },
    ],
    reason: "Correct original performers",
  };
  const performers = [...request.performers].reverse();
  const evidence = {
    ...structuredClone(original.snapshot.evidence),
    attributionStatus: "CORRECTED" as const,
    correctionRequest: request,
    previousSnapshotId: original.snapshot.id,
    performers,
    payrollSession: payrollSessionEvidence(
      "holding",
      {
        purchase: original.purchase,
        ordinals: original.snapshot.evidence.payrollSession.ordinals,
        missingEvidence: [],
      },
      performers,
    ),
  };
  const snapshot = {
    ...original.snapshot,
    id: "corrected-snapshot",
    revision: 1,
    eventType: "CORRECTION",
    eventKey: `correction:${request.idempotencyKey}`,
    reason: request.reason,
    evidence,
    eventHash: createHash("sha256")
      .update(
        JSON.stringify({
          saleId: original.sale.id,
          redemptionId: original.redemption.id,
          actorId: "owner",
          ...request,
        }),
      )
      .digest("hex"),
  };
  const event = {
    ...structuredClone(original.event),
    id: "corrected-event",
    sourceType: "CORRECTION",
    sourceKey: "redemption:redemption:1",
    occurredAt: at,
    createdAt: at,
    reason: request.reason,
  };
  event.evidence.lines = evidence.payrollSession.bases.map((base, index) => ({
    ...event.evidence.lines[index],
    id: `corrected-base-${index}`,
    staffId: base.staffId,
    baseAmount: base.amount,
    units: evidence.payrollSession.units[index].amount,
    businessDate: "2026-10-05",
  }));
  const reversal = {
    ...structuredClone(original.event),
    id: "reversal",
    sourceType: "REVERSAL",
    sourceId: original.event.id,
    sourceKey: `correction:${snapshot.id}:${original.event.id}`,
    occurredAt: at,
    createdAt: at,
    reason: request.reason,
    evidence: {
      ...structuredClone(original.event.evidence),
      originalEventId: original.event.id,
      lines: original.event.evidence.lines.map((line) => ({
        ...line,
        id: `reversed-${line.id}`,
        baseAmount: `-${line.baseAmount}`,
        units: `-${line.units}`,
        businessDate: "2026-10-05",
      })),
    },
  };
  return {
    original,
    snapshots: [original.snapshot, snapshot],
    events: [original.event, event, reversal],
  };
}

function voidFixture() {
  const input = correctionFixture();
  const previous = input.snapshots[1];
  const prior = input.events[1];
  const at = new Date("2026-10-06T00:00:00Z");
  input.original.redemption.revertedAt = at;
  const evidence = redemptionCommissionEvidenceSchema.parse({
    ...previous.evidence,
    previousSnapshotId: previous.id,
  });
  const terminal = {
    ...previous,
    id: "void-snapshot",
    revision: 2,
    eventType: "VOID",
    eventKey: "void:redemption",
    reason: "Source redemption voided; original attribution retained",
    evidence,
    eventHash: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
  };
  const reversal = {
    ...prior,
    id: "void-reversal",
    sourceType: "REVERSAL",
    sourceId: prior.id,
    sourceKey: `session-void:redemption:${prior.id}`,
    occurredAt: at,
    createdAt: at,
    reason: "Manager voided source session",
    evidence: {
      ...prior.evidence,
      originalEventId: prior.id,
      lines: prior.evidence.lines.map((row) => ({
        ...row,
        id: `void-${row.id}`,
        baseAmount: `-${row.baseAmount}`,
        units: `-${row.units}`,
        businessDate: "2026-10-06",
      })),
    },
  };
  return {
    original: input.original,
    snapshots: [...input.snapshots, terminal],
    events: [...input.events, reversal],
  };
}

test("void retains correction history and reverses the latest source exactly once", () => {
  const input = voidFixture();
  const result = verifyPayrollRedemptionVoid(input);
  assert.equal(result.previousRevision, 1);
  assert.equal(result.corrections.length, 1);
  assert.equal(result.originalEventId, "corrected-event");
  assert.equal(result.session.baseAmount, "66.6667");
});

test("void rejects missing, duplicate, foreign, altered and non-exact evidence", () => {
  const mutations: ((f: ReturnType<typeof voidFixture>) => void)[] = [
    (f) => {
      f.original.redemption.revertedAt = null;
    },
    (f) => {
      f.snapshots.pop();
    },
    (f) => {
      f.events.pop();
    },
    (f) => {
      f.events.push(structuredClone(f.events.at(-1)!));
    },
    (f) => {
      f.snapshots.at(-1)!.tenantId = "foreign";
    },
    (f) => {
      f.snapshots.at(-1)!.actorId = "other";
    },
    (f) => {
      f.snapshots.at(-1)!.eventHash = "0".repeat(64);
    },
    (f) => {
      f.snapshots.at(-1)!.revision = 3;
    },
    (f) => {
      f.events.at(-1)!.sourceId = "event";
    },
    (f) => {
      f.events.at(-1)!.evidence.lines[0].baseAmount = "-1.0000";
    },
    (f) => {
      f.events.at(-1)!.occurredAt = new Date("2026-10-07T00:00:00Z");
    },
  ];
  for (const mutate of mutations) {
    const input = voidFixture();
    mutate(input);
    assert.throws(() => verifyPayrollRedemptionVoid(input), /EVIDENCE_UNCONFIRMED/);
  }
});

test("correction chain verifies original economics, request-order hash, new attribution and exact prior reversal", () => {
  const input = correctionFixture();
  const result = verifyPayrollRedemptionCorrections(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].session.baseAmount, "66.6667");
  assert.deepEqual(
    result[0].session.bases.map((row) => row.amount),
    ["33.3334", "33.3333"],
  );
  assert.deepEqual(result[0].coverage, input.original.snapshot.evidence.coverage);
  result[0].session.baseAmount = "0.0000";
  assert.equal(verifyPayrollRedemptionCorrections(input)[0].session.baseAmount, "66.6667");
});

test("correction chain refuses incomplete, unbound, tampered and non-exact histories", () => {
  const mutations: ((i: ReturnType<typeof correctionFixture>) => void)[] = [
    (i) => {
      i.events.pop();
    },
    (i) => {
      i.snapshots.pop();
    },
    (i) => {
      i.events.push(structuredClone(i.events[2]));
    },
    (i) => {
      i.snapshots[1].revision = 2;
    },
    (i) => {
      i.snapshots[1].tenantId = "foreign";
    },
    (i) => {
      i.snapshots[1].eventHash = "tampered";
    },
    (i) => {
      Reflect.deleteProperty(i.snapshots[1].evidence, "correctionRequest");
    },
    (i) => {
      i.snapshots[1].evidence.previousSnapshotId = "other";
    },
    (i) => {
      i.snapshots[1].evidence.coverage[0].quantity = 1;
    },
    (i) => {
      i.snapshots[1].evidence.payrollSession.ordinals = [{ first: 2, last: 3 }];
    },
    (i) => {
      i.events[1].actorId = "foreign";
    },
    (i) => {
      i.events[1].reason = "Other reason";
    },
    (i) => {
      i.events[1].evidence.lines[0].baseAmount = "99.0000";
    },
    (i) => {
      i.events[1].evidence.rateProvenance.rateAt = i.events[1].occurredAt.toISOString();
    },
    (i) => {
      i.events[2].sourceId = "other";
    },
    (i) => {
      i.events[2].evidence.lines[0].baseAmount = "-1.0000";
    },
    (i) => {
      i.events[2].occurredAt = new Date("2026-10-06T00:00:00Z");
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = correctionFixture();
    mutate(input);
    assert.throws(
      () => verifyPayrollRedemptionCorrections(input),
      /EVIDENCE_UNCONFIRMED/,
      `mutation ${index}`,
    );
  }
});

function inventoryFixture() {
  const { input } = fixture();
  return {
    tenantId: input.tenantId,
    purchase: input.purchase,
    holding: {
      id: "holding",
      tenantId: "salon",
      packageId: "package",
      saleLineId: "original-line",
      quantity: 3,
      quantityRemaining: 1,
      payrollAvailableOrdinals: [{ first: 3, last: 3 }] as unknown,
      redemptionRules: input.redemptionRules,
    },
    redemptions: [input],
    collections: [
      {
        id: "receipt",
        tenantId: "salon",
        saleLineId: "original-line",
        netCents: 6667n,
        occurredAt: new Date("2026-08-02T00:00:00Z"),
      },
    ],
  };
}

function overrideFixture() {
  const input = inventoryFixture();
  input.collections[0].netCents = 3333n;
  return {
    ...input,
    overrides: [
      {
        id: "approval",
        tenantId: "salon",
        action: "package.unpaid-session.override",
        targetType: "CustomerPackageHolding",
        targetId: "holding",
        createdAt: new Date("2026-09-15T00:00:00Z"),
        metadata: {
          actorId: "operator",
          managerId: "manager",
          managerRole: "MANAGER",
          saleId: "usage-sale",
          reason: "Approved exception",
          quantity: 2,
          paidSessions: 0,
          usedSessions: 0,
        },
      },
    ],
  };
}

test("sale-bound override permits unpaid ordinals without changing purchase economics", () => {
  const input = overrideFixture();
  // The original per-session policy requires 3334 cents to fund session one.
  const result = verifyPayrollPackageRedemptionInventory(input);
  assert.equal(result.redemptions[0].session.baseAmount, "66.6667");
  assert.deepEqual(result.remaining, [{ first: 3, last: 3 }]);
  input.overrides[0].metadata.managerRole = "SUPER_ADMIN";
  assert.deepEqual(verifyPayrollPackageRedemptionInventory(input), result);
  // PIN verification happens after POS assigns usedAt, before capture append.
  input.overrides[0].createdAt = new Date("2026-09-15T00:00:01Z");
  input.redemptions[0].event.createdAt = new Date("2026-09-15T00:00:02Z");
  assert.deepEqual(verifyPayrollPackageRedemptionInventory(input), result);
});

test("unpaid override reconciliation rejects missing, duplicate, foreign and mismatched audits", () => {
  const mutations: ((input: ReturnType<typeof overrideFixture>) => void)[] = [
    (i) => {
      i.overrides.length = 0;
    },
    (i) => {
      i.overrides.push(structuredClone(i.overrides[0]));
    },
    (i) => {
      i.overrides.push({ ...structuredClone(i.overrides[0]), id: "another" });
    },
    (i) => {
      i.overrides[0].tenantId = "foreign";
    },
    (i) => {
      i.overrides[0].targetId = "foreign";
    },
    (i) => {
      i.overrides[0].targetType = "Sale";
    },
    (i) => {
      i.overrides[0].action = "other";
    },
    (i) => {
      i.overrides[0].metadata.saleId = "other";
    },
    (i) => {
      i.overrides[0].metadata.quantity = 1;
    },
    (i) => {
      i.overrides[0].metadata.paidSessions = 1;
    },
    (i) => {
      i.overrides[0].metadata.usedSessions = 1;
    },
    (i) => {
      i.overrides[0].metadata.managerRole = "STAFF";
    },
    (i) => {
      i.overrides[0].metadata.managerId = "";
    },
    (i) => {
      i.overrides[0].metadata.actorId = "";
    },
    (i) => {
      i.overrides[0].metadata.reason = " ";
    },
    (i) => {
      Reflect.deleteProperty(i.overrides[0].metadata, "saleId");
    },
    (i) => {
      i.overrides[0].createdAt = new Date("2026-09-16T00:00:00Z");
    },
    (i) => {
      i.overrides[0].createdAt = new Date("2026-07-01T00:00:00Z");
    },
    (i) => {
      i.collections[0].netCents = 10000n;
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = overrideFixture();
    mutate(input);
    assert.throws(
      () => verifyPayrollPackageRedemptionInventory(input),
      /EVIDENCE_UNCONFIRMED/,
      `mutation ${index}`,
    );
  }
});

test("supplied holding inventory reconciles paid sessions and remaining original ordinals", () => {
  const input = inventoryFixture();
  const result = verifyPayrollPackageRedemptionInventory(input);
  assert.deepEqual(result.remaining, [{ first: 3, last: 3 }]);
  assert.equal(result.redemptions[0].session.baseAmount, "66.6667");
  result.remaining[0].first = 1;
  assert.deepEqual(verifyPayrollPackageRedemptionInventory(input).remaining, [
    { first: 3, last: 3 },
  ]);
  input.collections[0].netCents = 6666n;
  assert.throws(() => verifyPayrollPackageRedemptionInventory(input), /EVIDENCE_UNCONFIRMED/);
});

test("holding replay restores original ordinals and reuses them with unchanged residuals", () => {
  const input = inventoryFixture();
  const original = input.redemptions[0];
  original.redemption.revertedAt = new Date("2026-09-16T00:00:00Z");
  input.holding.quantityRemaining = 3;
  input.holding.payrollAvailableOrdinals = [{ first: 1, last: 3 }];
  const restored = verifyPayrollPackageRedemptionInventory(input);
  assert.deepEqual(restored.remaining, [{ first: 1, last: 3 }]);
  assert.equal(restored.redemptions[0].session.baseAmount, "66.6667");
  const next = structuredClone(original);
  next.redemption.id = "redraw";
  next.redemption.saleId = "redraw-sale";
  next.redemption.usedAt = new Date("2026-09-17T00:00:00Z");
  next.redemption.revertedAt = null;
  next.sale.id = "redraw-sale";
  next.sale.soldAt = next.redemption.usedAt;
  next.snapshot.id = "redraw-snapshot";
  next.snapshot.redemptionId = "redraw";
  next.snapshot.eventKey = "capture:redraw";
  next.snapshot.evidence.evaluatedAt = next.redemption.usedAt.toISOString();
  next.snapshot.eventHash = createHash("sha256")
    .update(JSON.stringify(next.snapshot.evidence))
    .digest("hex");
  next.coverageLines[0].saleId = "redraw-sale";
  next.event.id = "redraw-event";
  next.event.sourceKey = "redemption:redraw:0";
  next.event.sourceId = "redraw";
  next.event.saleId = "redraw-sale";
  next.event.occurredAt = next.redemption.usedAt;
  next.event.createdAt = next.redemption.usedAt;
  next.event.evidence.rateProvenance.rateAt = next.redemption.usedAt.toISOString();
  for (const line of next.event.evidence.lines) {
    line.id = `redraw-${line.id}`;
    line.businessDate = "2026-09-17";
  }
  input.redemptions.push(next);
  input.holding.quantityRemaining = 1;
  input.holding.payrollAvailableOrdinals = [{ first: 3, last: 3 }];
  assert.deepEqual(verifyPayrollPackageRedemptionInventory(input).remaining, [
    { first: 3, last: 3 },
  ]);
  original.redemption.revertedAt = next.redemption.usedAt;
  assert.throws(() => verifyPayrollPackageRedemptionInventory(input), /EVIDENCE_UNCONFIRMED/);
});

test("supplied holding inventory rejects incomplete, ambiguous, foreign and corrupt history", () => {
  const mutations: ((input: ReturnType<typeof inventoryFixture>) => void)[] = [
    (i) => {
      i.tenantId = "other";
    },
    (i) => {
      i.holding.tenantId = "other";
    },
    (i) => {
      i.holding.id = "other";
    },
    (i) => {
      i.holding.packageId = "other";
    },
    (i) => {
      i.holding.saleLineId = "other";
    },
    (i) => {
      i.holding.quantity = 4;
    },
    (i) => {
      i.holding.quantityRemaining = 2;
    },
    (i) => {
      i.holding.quantityRemaining = -1;
    },
    (i) => {
      i.holding.payrollAvailableOrdinals = null;
    },
    (i) => {
      i.holding.payrollAvailableOrdinals = [{ first: 1, last: 1 }];
    },
    (i) => {
      i.holding.redemptionRules = null;
    },
    (i) => {
      i.redemptions = [];
    },
    (i) => {
      i.redemptions.push(structuredClone(i.redemptions[0]));
    },
    (i) => {
      i.collections = [];
    },
    (i) => {
      i.collections.push(structuredClone(i.collections[0]));
    },
    (i) => {
      i.collections[0].tenantId = "other";
    },
    (i) => {
      i.collections[0].saleLineId = "other";
    },
    (i) => {
      i.collections[0].netCents = -1n;
    },
    (i) => {
      i.collections[0].netCents = 10001n;
    },
    (i) => {
      i.collections[0].occurredAt = new Date("invalid");
    },
    (i) => {
      i.collections[0].occurredAt = new Date("2026-07-31T00:00:00Z");
    },
    (i) => {
      i.collections[0].occurredAt = i.redemptions[0].redemption.usedAt;
    },
    (i) => {
      i.collections[0].occurredAt = new Date("2026-10-01T00:00:00Z");
    },
    (i) => {
      i.redemptions[0].redemption.revertedAt = new Date();
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = inventoryFixture();
    mutate(input);
    assert.throws(
      () => verifyPayrollPackageRedemptionInventory(input),
      /EVIDENCE_UNCONFIRMED/,
      `mutation ${index}`,
    );
  }
});

test("later receipts cannot retroactively authorize an unpaid draw", () => {
  const input = inventoryFixture();
  input.collections[0].netCents = 6666n;
  input.collections.push({
    ...input.collections[0],
    id: "later-receipt",
    netCents: 3334n,
    occurredAt: new Date("2026-10-01T00:00:00Z"),
  });
  assert.throws(() => verifyPayrollPackageRedemptionInventory(input), /EVIDENCE_UNCONFIRMED/);
});

test("holding inventory rejects overlapping session ordinals even when individual captures verify", () => {
  const input = inventoryFixture();
  input.collections[0].netCents = 10000n;
  const second = structuredClone(input.redemptions[0]);
  const at = new Date("2026-09-16T00:00:00Z");
  second.redemption.id = "second-redemption";
  second.redemption.usedAt = at;
  second.sale.soldAt = at;
  second.snapshot.redemptionId = second.redemption.id;
  second.snapshot.evidence.evaluatedAt = at.toISOString();
  second.snapshot.eventHash = createHash("sha256")
    .update(JSON.stringify(second.snapshot.evidence))
    .digest("hex");
  second.event.id = "second-event";
  second.event.sourceId = second.redemption.id;
  second.event.sourceKey = `redemption:${second.redemption.id}:0`;
  second.event.occurredAt = at;
  second.event.createdAt = at;
  second.event.evidence.rateProvenance.rateAt = at.toISOString();
  for (const line of second.event.evidence.lines) line.businessDate = "2026-09-16";
  assert.doesNotThrow(() => verifyPayrollPackageRedemption(second));
  input.redemptions.push(second);
  assert.throws(() => verifyPayrollPackageRedemptionInventory(input), /EVIDENCE_UNCONFIRMED/);
});

function secondSingleSession() {
  const { input, rehash } = fixture();
  const at = new Date("2026-09-16T00:00:00Z");
  input.redemption.id = "second-redemption";
  input.redemption.quantity = 1;
  input.redemption.usedAt = at;
  input.sale.soldAt = at;
  input.snapshot.redemptionId = input.redemption.id;
  input.snapshot.evidence.evaluatedAt = at.toISOString();
  input.snapshot.evidence.payrollSession = payrollSessionEvidence(
    "holding",
    { purchase: input.purchase, ordinals: [{ first: 3, last: 3 }], missingEvidence: [] },
    input.snapshot.evidence.performers,
  );
  input.snapshot.evidence.coverage[0].quantity = 1;
  input.event.id = "second-event";
  input.event.sourceId = input.redemption.id;
  input.event.sourceKey = `redemption:${input.redemption.id}:0`;
  input.event.occurredAt = at;
  input.event.createdAt = at;
  input.event.evidence.rateProvenance.rateAt = at.toISOString();
  for (const [index, line] of input.event.evidence.lines.entries()) {
    line.businessDate = "2026-09-16";
    line.baseAmount = input.snapshot.evidence.payrollSession.bases[index].amount;
    line.units = input.snapshot.evidence.payrollSession.units[index].amount;
  }
  rehash();
  return input;
}

test("holding inventory replays all draws chronologically and conserves original residuals", () => {
  const input = inventoryFixture();
  const second = secondSingleSession();
  second.sale.id = "second-sale";
  second.redemption.saleId = second.sale.id;
  second.event.saleId = second.sale.id;
  second.coverageLines[0].saleId = second.sale.id;
  input.collections[0].netCents = 10000n;
  input.redemptions = [second, input.redemptions[0]];
  input.holding.quantityRemaining = 0;
  input.holding.payrollAvailableOrdinals = [];
  const result = verifyPayrollPackageRedemptionInventory(input);
  assert.deepEqual(
    result.redemptions.map((row) => row.redemptionId),
    ["redemption", "second-redemption"],
  );
  assert.deepEqual(
    result.redemptions.map((row) => row.session.baseAmount),
    ["66.6667", "33.3333"],
  );
  assert.deepEqual(result.remaining, []);
});

test("holding inventory rejects aggregate coverage overflow despite valid individual draws", () => {
  const input = inventoryFixture();
  const second = secondSingleSession();
  // Separate draws claim the same two-unit service line: 2 + 1 is not 2.
  assert.doesNotThrow(() => verifyPayrollPackageRedemption(second));
  input.collections[0].netCents = 10000n;
  input.redemptions.push(second);
  input.holding.quantityRemaining = 0;
  input.holding.payrollAvailableOrdinals = [];
  assert.throws(() => verifyPayrollPackageRedemptionInventory(input), /EVIDENCE_UNCONFIRMED/);
  // Raising the second copy's capacity cannot hide conflicting source evidence.
  second.coverageLines[0].quantity = 3;
  assert.throws(() => verifyPayrollPackageRedemptionInventory(input), /EVIDENCE_UNCONFIRMED/);
});

test("unspent holding inventory requires the entire original grant and permits no inferred usage", () => {
  const input = inventoryFixture();
  input.redemptions = [];
  input.collections = [];
  input.holding.quantityRemaining = 3;
  input.holding.payrollAvailableOrdinals = [{ first: 1, last: 3 }];
  assert.deepEqual(verifyPayrollPackageRedemptionInventory(input).remaining, [
    { first: 1, last: 3 },
  ]);
  input.holding.payrollAvailableOrdinals = [{ first: 2, last: 3 }];
  assert.throws(() => verifyPayrollPackageRedemptionInventory(input), /EVIDENCE_UNCONFIRMED/);
});

test("holding inventory rejects ambiguous draw ordering rather than ordering by arbitrary IDs", () => {
  const input = inventoryFixture();
  const second = secondSingleSession();
  second.redemption.usedAt = input.redemptions[0].redemption.usedAt;
  input.collections[0].netCents = 10000n;
  input.redemptions.push(second);
  input.holding.quantityRemaining = 0;
  input.holding.payrollAvailableOrdinals = [];
  assert.throws(() => verifyPayrollPackageRedemptionInventory(input), /EVIDENCE_UNCONFIRMED/);
});

test("server holding history verifies corrections without consuming sessions or replacing original capture", async () => {
  const f = historyLoaderFixture();
  const chain = correctionFixture();
  f.data.snapshots = chain.snapshots as typeof f.data.snapshots;
  f.data.events = [...chain.events, f.data.events[1]];
  const result = await f.load();
  assert.equal(result.verified.redemptions[0].session.baseAmount, "66.6667");
  assert.deepEqual(
    result.corrections[0].revisions[0].session.bases.map((row) => row.amount),
    ["33.3334", "33.3333"],
  );
  assert.deepEqual(result.verified.remaining, [{ first: 3, last: 3 }]);
  assert.equal(result.evidence.correctionReversals.length, 1);
  f.data.events.splice(2, 1);
  await assert.rejects(f.load(), /UNCONFIRMED/);
});

function historyLoaderFixture() {
  const { input } = fixture();
  const D = (value: string) => new Prisma.Decimal(value);
  const at = new Date(input.purchase.purchasedAt);
  const shares = input.purchase.sellers;
  const line = {
    id: "original-line",
    tenantId: "salon",
    saleId: "original-sale",
    itemType: "PACKAGE",
    itemId: "package",
    quantity: 1,
    attribution: { sellers: shares },
    lineTotal: D("109"),
    voucherDiscountAmount: D("0"),
    taxAmount: D("9"),
  };
  const sale = {
    id: "original-sale",
    tenantId: "salon",
    outletId: "original-outlet",
    customerId: "original-buyer",
    soldAt: at,
    status: "COMPLETED",
    collectionCurrency: "SGD",
    lines: [line],
  };
  const usage = {
    ...input.sale,
    collectionCurrency: "SGD",
    customerId: "original-buyer",
    lines: input.coverageLines,
  };
  const holding = {
    ...inventoryFixture().holding,
    customerId: "original-buyer",
    expiresAt: null as Date | null,
    payrollPurchaseSnapshot: input.purchase,
  };
  const receiptAt = new Date("2026-08-02T00:00:00Z");
  const capture = {
    ...input.event,
    id: "collection-event",
    sourceType: "COLLECTION",
    sourceId: "allocation",
    sourceKey: "collection:allocation",
    saleId: sale.id,
    outletId: sale.outletId,
    occurredAt: receiptAt,
    createdAt: receiptAt,
    evidence: {
      ...input.event.evidence,
      lines: [
        {
          id: "sale-base",
          staffId: "seller",
          outletId: sale.outletId,
          commissionType: "PKG_SALE",
          baseAmount: "100.0000",
          units: "1.0000",
          businessDate: "2026-08-02",
          mode: "FOLLOW_PLAN",
          status: "EARNED",
          fallbackRatePct: "0",
        },
      ],
      rateProvenance: {
        ...input.event.evidence.rateProvenance,
        rateAt: receiptAt.toISOString(),
        selections: [
          {
            staffId: "seller",
            legacyServiceRate: "0",
            selection: { rate: "0", source: "NONE", ruleId: null },
          },
        ],
      },
    },
  };
  const data = {
    actor: { globalRole: "SUPER_ADMIN", twoFactorEnabled: true },
    holding,
    line,
    sale,
    usage,
    holdings: [holding],
    redemptions: [{ ...input.redemption, customerId: "original-buyer" }],
    snapshots: [input.snapshot],
    events: [input.event, capture],
    transfers: [] as object[],
    refunds: [] as object[],
    overrides: [] as object[],
    receipts: [
      {
        id: "receipt",
        tenantId: "salon",
        saleId: sale.id,
        sourceType: "SALE_PAYMENT",
        sourceId: "payment",
        currency: "SGD",
        grossCents: 10900n,
        occurredAt: receiptAt,
        createdAt: receiptAt,
        allocations: [
          {
            id: "allocation",
            tenantId: "salon",
            collectionId: "receipt",
            saleLineId: line.id,
            grossCents: 10900n,
            netCents: 10000n,
            taxCents: 900n,
          },
        ],
      },
    ],
    payments: [
      {
        id: "payment",
        tenantId: "salon",
        saleId: sale.id,
        amount: D("109"),
        createdAt: receiptAt,
        method: "CASH",
        sessionId: null as string | null,
      },
    ],
    outstanding: [] as object[],
  };
  const queries: { model: string; args: unknown }[] = [];
  const many = (model: string, get: () => unknown) => ({
    findMany: async (args: unknown) => {
      queries.push({ model, args });
      return get();
    },
  });
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    user: { findFirst: async () => data.actor },
    tenant: { findUniqueOrThrow: async () => ({ timeZone: "Asia/Singapore" }) },
    customerPackageHolding: {
      ...many("holding", () => data.holdings),
      findFirst: async () => data.holding,
    },
    saleLine: { findFirst: async () => data.line },
    sale: {
      findFirst: async (args: { where: { id: string } }) =>
        args.where.id === sale.id ? data.sale : data.usage,
    },
    customerRedemption: many("redemption", () => data.redemptions),
    commissionCollection: many("receipt", () => data.receipts),
    salePayment: many("payment", () => data.payments),
    customerOutstandingPayment: many("outstanding", () => data.outstanding),
    sessionPackageTransferEvent: many("transfer", () => data.transfers),
    commissionRedemptionSnapshot: many("snapshot", () => data.snapshots),
    payrollSourceEvent: many("event", () => data.events),
    commissionRule: many("rule", () => []),
    saleRefund: many("refund", () => data.refunds),
    auditLog: many("override", () => data.overrides),
  } as unknown as PayrollCloseTransaction;
  const load = () =>
    runAsTenant("salon", () => loadPayrollPackageRedemptionHistory(tx, "holding"), "owner");
  return { data, tx, queries, load };
}

test("server history loader independently inventories original purchase, settled receipts and all holding draws", async () => {
  const f = historyLoaderFixture();
  const result = await f.load();
  assert.equal(result.verified.redemptions[0].session.baseAmount, "66.6667");
  assert.deepEqual(result.verified.remaining, [{ first: 3, last: 3 }]);
  for (const query of f.queries) {
    const args = query.args as { where: { tenantId: string }; take?: number; skip?: number };
    assert.equal(args.where.tenantId, "salon");
    assert.equal(args.take, undefined);
    assert.equal(args.skip, undefined);
  }
  assert.deepEqual(f.queries.find((row) => row.model === "redemption")!.args, {
    where: { tenantId: "salon", holdingId: "holding" },
    orderBy: { id: "asc" },
  });
});

test("server history preserves original economics through transfers before and after a draw", async () => {
  const f = historyLoaderFixture();
  f.data.holding.customerId = "final-owner";
  f.data.redemptions[0].customerId = "recipient";
  f.data.usage.customerId = "recipient";
  const transfer = {
    id: "before",
    tenantId: "salon",
    holdingId: "holding",
    fromCustomerId: "original-buyer",
    toCustomerId: "recipient",
    actorId: "owner",
    quantity: 3,
    expiresAt: null,
    reason: "Transfer remaining sessions",
    createdAt: new Date("2026-09-01T00:00:00Z"),
  };
  f.data.transfers = [
    {
      ...transfer,
      id: "after",
      fromCustomerId: "recipient",
      toCustomerId: "final-owner",
      quantity: 1,
      createdAt: new Date("2026-09-16T00:00:00Z"),
    },
    transfer,
  ];
  const result = await f.load();
  assert.equal(result.evidence.ownership.customerId, "final-owner");
  assert.equal(result.evidence.transfers.length, 2);
  assert.equal(result.verified.purchase.originalCustomerId, "original-buyer");
  assert.equal(result.verified.purchase.sellers![0].staffId, "seller");
  assert.equal(result.verified.redemptions[0].session.baseAmount, "66.6667");
});

test("server history loader fails closed for omitted inventory, unsupported lifecycle and payment tampering", async () => {
  const mutations: ((f: ReturnType<typeof historyLoaderFixture>) => void)[] = [
    (f) => {
      f.data.holdings = [];
    },
    (f) => {
      f.data.redemptions = [];
    },
    (f) => {
      f.data.snapshots = [];
    },
    (f) => {
      f.data.snapshots.push(structuredClone(f.data.snapshots[0]));
    },
    (f) => {
      f.data.events = [];
    },
    (f) => {
      f.data.payments = [];
    },
    (f) => {
      f.data.receipts = [];
    },
    (f) => {
      f.data.payments[0].sessionId = "unsettled";
    },
    (f) => {
      f.data.payments[0].amount = new Prisma.Decimal("108");
    },
    (f) => {
      f.data.receipts[0].allocations[0].netCents = 10001n;
    },
    (f) => {
      f.data.receipts[0].allocations[0].tenantId = "foreign";
    },
    (f) => {
      f.data.transfers.push({ id: "transfer" });
    },
    (f) => {
      f.data.refunds.push({ id: "refund" });
    },
    (f) => {
      f.data.holding.customerId = "new-owner";
    },
    (f) => {
      f.data.usage.customerId = "other";
    },
    (f) => {
      f.data.holding.expiresAt = new Date("2026-09-01T00:00:00Z");
    },
    (f) => {
      f.data.redemptions[0].revertedAt = new Date();
    },
    (f) => {
      f.data.events[0].sourceType = "CORRECTION";
    },
    (f) => {
      f.data.events.push({
        ...f.data.events[0],
        id: "reversal",
        sourceType: "REVERSAL",
        sourceId: f.data.events[0].id,
      });
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = historyLoaderFixture();
    mutate(f);
    await assert.rejects(f.load(), /UNCONFIRMED/, `mutation ${index}`);
  }
});

test("server history loader rejects missing actor, outlet scope and unverified owner", async () => {
  const f = historyLoaderFixture();
  await assert.rejects(
    runAsTenant("salon", () => loadPayrollPackageRedemptionHistory(f.tx, "holding")),
    /authenticated actor/,
  );
  await assert.rejects(
    runAsTenant(
      "salon",
      () => runAtOutlet("outlet", () => loadPayrollPackageRedemptionHistory(f.tx, "holding")),
      "owner",
    ),
    /authenticated actor/,
  );
  f.data.actor.twoFactorEnabled = false;
  await assert.rejects(f.load(), /not permitted/);
});

test("persisted JSONB key ordering preserves writer hashes without accepting changed evidence", () => {
  const { input, rehash } = fixture();
  // Mirror captureRedemptionCommission's schema parsing before its hash write.
  const original = input.snapshot.evidence;
  input.snapshot.evidence = {
    payrollSession: original.payrollSession,
    version: original.version,
    coverage: original.coverage,
    performers: original.performers,
    attributionStatus: original.attributionStatus,
    valuation: original.valuation,
    evaluatedAt: original.evaluatedAt,
    rates: original.rates,
    postingStatus: original.postingStatus,
    previousSnapshotId: original.previousSnapshotId,
  };
  input.snapshot.evidence = redemptionCommissionEvidenceSchema.parse(
    input.snapshot.evidence,
  ) as typeof original;
  rehash();
  const reorder = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, reorder(item)]),
      );
    return value;
  };
  input.snapshot.evidence = reorder(input.snapshot.evidence) as typeof original;
  assert.doesNotThrow(() => verifyPayrollPackageRedemption(input));
  input.snapshot.evidence.payrollSession.baseAmount = "999.0000";
  assert.throws(() => verifyPayrollPackageRedemption(input), /EVIDENCE_UNCONFIRMED/);
});

function saleCoverageFixture(twoHoldings = false) {
  const first = historyLoaderFixture();
  const second = historyLoaderFixture();
  // The second package has a separate purchase and session inventory but covers
  // the same usage sale/service line. Both individual histories remain valid.
  second.data.holding.id = "second-holding";
  second.data.holding.saleLineId = "second-original-line";
  second.data.line.id = "second-original-line";
  second.data.sale.id = "second-original-sale";
  second.data.line.saleId = second.data.sale.id;
  second.data.holding.payrollPurchaseSnapshot = {
    ...second.data.holding.payrollPurchaseSnapshot,
    saleId: second.data.sale.id,
    saleLineId: second.data.line.id,
  };
  second.data.redemptions[0].id = "second-redemption";
  second.data.redemptions[0].holdingId = second.data.holding.id;
  second.data.snapshots[0].redemptionId = "second-redemption";
  second.data.snapshots[0].id = "second-snapshot";
  second.data.snapshots[0].eventKey = "capture:second-redemption";
  const session = second.data.snapshots[0].evidence.payrollSession;
  session.holdingId = second.data.holding.id;
  session.purchase = second.data.holding.payrollPurchaseSnapshot;
  second.data.snapshots[0].eventHash = createHash("sha256")
    .update(JSON.stringify(second.data.snapshots[0].evidence))
    .digest("hex");
  second.data.events[0].id = "second-capture";
  second.data.events[0].sourceId = "second-redemption";
  second.data.events[0].sourceKey = "redemption:second-redemption:0";
  second.data.receipts[0].id = "second-receipt";
  second.data.receipts[0].saleId = second.data.sale.id;
  second.data.receipts[0].sourceId = "second-payment";
  Object.assign(second.data.receipts[0].allocations[0], {
    id: "second-allocation",
    collectionId: "second-receipt",
    saleLineId: second.data.line.id,
  });
  Object.assign(second.data.payments[0], { id: "second-payment", saleId: second.data.sale.id });
  Object.assign(second.data.events[1], {
    id: "second-collection",
    sourceId: "second-allocation",
    sourceKey: "collection:second-allocation",
    saleId: second.data.sale.id,
  });
  const fixtures = twoHoldings ? [first, second] : [first];
  for (const f of fixtures) f.data.usage.lines[0].quantity = twoHoldings ? 5 : 3;
  const rows = fixtures.flatMap((f) => f.data.redemptions);
  const events = fixtures.flatMap((f) => f.data.events);
  const snapshots = fixtures.flatMap((f) => f.data.snapshots);
  const queries: { model: string; args: unknown }[] = [];
  const tx = {
    ...first.tx,
    sale: {
      findFirst: async (args: { where: { id: string } }) => {
        const f = fixtures.find((f) => f.data.sale.id === args.where.id);
        return f ? f.data.sale : first.data.usage;
      },
    },
    saleLine: {
      findFirst: async (args: { where: { id: string } }) =>
        fixtures.find((f) => f.data.line.id === args.where.id)?.data.line,
    },
    customerPackageHolding: {
      findFirst: async (args: { where: { id: string } }) =>
        fixtures.find((f) => f.data.holding.id === args.where.id)?.data.holding,
      findMany: async (args: { where: { saleLineId: string } }) =>
        fixtures.filter((f) => f.data.line.id === args.where.saleLineId).map((f) => f.data.holding),
    },
    customerRedemption: {
      findMany: async (args: { where: { holdingId?: string; saleId?: string } }) => {
        queries.push({ model: "redemption", args });
        return rows.filter((row) =>
          args.where.holdingId
            ? row.holdingId === args.where.holdingId
            : row.saleId === args.where.saleId,
        );
      },
    },
    commissionCollection: {
      findMany: async (args: { where: { saleId: string } }) =>
        fixtures
          .filter((f) => f.data.sale.id === args.where.saleId)
          .flatMap((f) => f.data.receipts),
    },
    salePayment: {
      findMany: async (args: { where: { saleId: string } }) =>
        fixtures
          .filter((f) => f.data.sale.id === args.where.saleId)
          .flatMap((f) => f.data.payments),
    },
    payrollSourceEvent: {
      findMany: async (args: { where: { saleId?: string } }) =>
        events.filter((row) => !args.where.saleId || row.saleId === args.where.saleId),
    },
    commissionRedemptionSnapshot: { findMany: async () => snapshots },
  } as unknown as PayrollCloseTransaction;
  const load = () =>
    runAsTenant("salon", () => loadPayrollSalePackageCoverage(tx, "usage-sale"), "owner");
  return { first, second, fixtures, rows, events, snapshots, tx, load, queries };
}

test("sale coverage aggregates independently verified holdings and retains uncovered quantities", async () => {
  for (const two of [false, true]) {
    const f = saleCoverageFixture(two);
    const result = await f.load();
    assert.deepEqual(result.lines, [
      { saleLineId: "service-line", coveredQuantity: two ? 4 : 2, remainingQuantity: 1 },
    ]);
    assert.equal(result.evidence.histories.length, two ? 2 : 1);
    assert.deepEqual(f.queries[0].args, {
      where: { tenantId: "salon", saleId: "usage-sale" },
      orderBy: { id: "asc" },
    });
  }
});

test("sale coverage rejects cross-holding overflow even when each holding is valid", async () => {
  const f = saleCoverageFixture(true);
  for (const item of f.fixtures) item.data.usage.lines[0].quantity = 3;
  for (const item of f.fixtures)
    await runAsTenant(
      "salon",
      () => loadPayrollPackageRedemptionHistory(f.tx, item.data.holding.id),
      "owner",
    );
  await assert.rejects(f.load(), /SALE_PACKAGE_COVERAGE_UNCONFIRMED/);
});

test("sale coverage fails closed for omitted and unsupported sale inventory", async () => {
  const mutations: ((f: ReturnType<typeof saleCoverageFixture>) => void)[] = [
    (f) => {
      f.rows.length = 0;
    },
    (f) => {
      f.events.splice(0, 1);
    },
    (f) => {
      f.snapshots.length = 0;
    },
    (f) => {
      f.rows.push(structuredClone(f.rows[0]));
    },
    (f) => {
      f.rows[0].itemType = "VALUE_PACKAGE";
    },
    (f) => {
      f.rows[0].holdingId = "";
    },
    (f) => {
      f.rows[0].revertedAt = new Date();
    },
    (f) => {
      f.rows[0].customerId = "foreign";
    },
    (f) => {
      f.first.data.usage.tenantId = "foreign";
    },
    (f) => {
      f.first.data.usage.status = "VOIDED";
    },
    (f) => {
      f.first.data.usage.lines[0].quantity = 1;
    },
    (f) => {
      f.events[0].sourceType = "CORRECTION";
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = saleCoverageFixture();
    mutate(f);
    await assert.rejects(f.load(), /UNCONFIRMED/, `mutation ${index}`);
  }
});

test("sale coverage requires a verified salon-wide manager or owner even without package usage", async () => {
  const f = saleCoverageFixture();
  f.rows.length = 0;
  f.events.splice(0, 1);
  f.snapshots.length = 0;
  const empty = await f.load();
  assert.deepEqual(empty.lines, [
    { saleLineId: "service-line", coveredQuantity: 0, remainingQuantity: 3 },
  ]);
  assert.deepEqual(empty.evidence.histories, []);
  await assert.rejects(
    () => loadPayrollSalePackageCoverage(f.tx, "usage-sale"),
    /salon-wide authenticated/,
  );
  await assert.rejects(
    () => runAsTenant("salon", () => loadPayrollSalePackageCoverage(f.tx, "usage-sale")),
    /salon-wide authenticated/,
  );
  await assert.rejects(
    () =>
      runAsTenant(
        "salon",
        () => runAtOutlet("outlet", () => loadPayrollSalePackageCoverage(f.tx, "usage-sale")),
        "owner",
      ),
    /salon-wide authenticated/,
  );
  f.first.data.actor.twoFactorEnabled = false;
  await assert.rejects(f.load(), /not permitted/);
  f.first.data.actor.globalRole = "STAFF";
  await assert.rejects(f.load(), /not permitted/);
  f.first.data.actor.globalRole = "MANAGER";
  assert.equal((await f.load()).lines[0].remainingQuantity, 3);
});
