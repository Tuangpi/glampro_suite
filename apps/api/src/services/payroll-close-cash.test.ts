import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolvePayrollCloseCash as resolve,
  type PayrollCashAttribution,
} from "./payroll-close-cash.js";
import type { PayrollCloseCollectionRecords } from "./payroll-close-collections.js";
import { payrollInputHash } from "./payroll-close-state.js";

function fixture(): PayrollCloseCollectionRecords & { cashAttributions: PayrollCashAttribution[] } {
  const operation = {
    tenantId: "salon",
    sourceType: "SALE_PAYMENT" as const,
    sourceId: "payment",
    saleId: "sale",
    currency: "SGD" as const,
    grossCents: "10900",
    occurredAt: new Date("2026-09-15T00:00:00Z"),
  };
  return {
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    events: [],
    lineageEvents: [],
    operations: [operation],
    collections: [
      {
        ...operation,
        id: "collection",
        allocations: [
          {
            id: "allocation",
            tenantId: "salon",
            collectionId: "collection",
            saleLineId: "line",
            itemType: "SERVICE",
            grossCents: "10900",
            netCents: "10000",
            taxCents: "900",
          },
        ],
      },
    ],
    cashAttributions: [
      {
        tenantId: "salon",
        allocationId: "allocation",
        saleLineId: "line",
        outletId: "branch",
        shares: [{ staffId: "departed", share: 10000 }],
        evidence: { attributionRevision: 1 },
      },
    ],
  };
}

test("cash denominator uses collected net external consideration, not GST or bases", () => {
  const result = resolve(fixture());
  assert.equal(result.status, "CASH_EVIDENCE_READY");
  assert.equal(result.earningsActive, false);
  assert.equal(result.cash!.salonCash, "100.0000");
  assert.deepEqual(result.cash!.staff, [{ staffId: "departed", collection: "100.0000" }]);
  assert.deepEqual(result.cash!.outlets, [{ outletId: "branch", collection: "100.0000" }]);
});

test("split collections conserve four-decimal residuals in stable staff order", () => {
  const input = fixture();
  input.cashAttributions[0].shares = [
    { staffId: "b", share: 6667 },
    { staffId: "a", share: 3333 },
  ];
  input.operations[0].grossCents = "1";
  input.collections[0].grossCents = "1";
  Object.assign(input.collections[0].allocations[0], {
    grossCents: "1",
    netCents: "1",
    taxCents: "0",
  });
  const result = resolve(input);
  assert.deepEqual(result.cash!.staff, [
    { staffId: "a", collection: "0.0034" },
    { staffId: "b", collection: "0.0066" },
  ]);
  input.cashAttributions[0].shares.reverse();
  assert.equal(payrollInputHash(resolve(input)), payrollInputHash(result));
});

test("each collection is counted once, across instalments and outlets", () => {
  const input = fixture();
  const operation = {
    ...input.operations[0],
    sourceType: "OUTSTANDING_PAYMENT" as const,
    sourceId: "later",
  };
  input.operations.push(operation);
  input.collections.push({
    ...operation,
    id: "second",
    allocations: [
      { ...input.collections[0].allocations[0], id: "second-allocation", collectionId: "second" },
    ],
  });
  input.cashAttributions.push({
    ...input.cashAttributions[0],
    allocationId: "second-allocation",
    outletId: "other-branch",
  });
  const result = resolve(input);
  assert.equal(result.cash!.salonCash, "200.0000");
  assert.equal(result.cash!.staff[0].collection, "200.0000");
  assert.equal(result.cash!.outlets.length, 2);
});

test("missing, orphaned or misidentified attribution cannot produce partial metrics", () => {
  const input = fixture();
  input.cashAttributions = [];
  assert.equal(resolve(input).cash, null);
  for (const change of [{ allocationId: "other" }, { saleLineId: "other" }]) {
    const mismatch = fixture();
    Object.assign(mismatch.cashAttributions[0], change);
    assert.equal(resolve(mismatch).cash, null);
  }
});

test("foreign, duplicate and invalid split records are rejected", () => {
  const input = fixture();
  input.cashAttributions[0].tenantId = "foreign";
  assert.throws(() => resolve(input), /another salon/);
  const duplicate = fixture();
  duplicate.cashAttributions.push(structuredClone(duplicate.cashAttributions[0]));
  assert.throws(() => resolve(duplicate), /Duplicate/);
  const shares = fixture();
  shares.cashAttributions[0].shares[0].share = 9999;
  assert.throws(() => resolve(shares));
});

test("failed payment reconciliation cannot be cleared by supplied attribution", () => {
  const input = fixture();
  input.operations = [];
  assert.equal(resolve(input).cash, null);
  assert.ok(
    resolve(input).blockers.some((row) => row.code === "COLLECTION_RECONCILIATION_UNAVAILABLE"),
  );
});

test("refund and reversal activity explicitly blocks positive-only cash totals", () => {
  for (const sourceType of ["REVERSAL", "PACKAGE_REFUND", "VALUE_PACKAGE_REFUND"] as const) {
    const input = fixture();
    input.events.push({
      id: "refund",
      tenantId: "salon",
      sourceType,
      sourceId: "original",
      sourceKey: "refund",
      saleId: "sale",
      outletId: "branch",
      occurredAt: new Date("2026-09-15T00:00:00Z"),
      createdAt: new Date("2026-09-15T00:00:00Z"),
      evidence: {},
    });
    const result = resolve(input);
    assert.equal(result.cash, null);
    assert.ok(result.blockers.some((row) => row.code === "CASH_REFUND_RECONCILIATION_UNAVAILABLE"));
  }
});

test("empty reconciled money inventory permits explicit zero without inventing activity", () => {
  const input = fixture();
  input.operations = [];
  input.collections = [];
  input.cashAttributions = [];
  const result = resolve(input);
  assert.equal(result.status, "CASH_EVIDENCE_READY");
  assert.equal(result.cash!.salonCash, "0.0000");
  assert.deepEqual(result.cash!.staff, []);
});

test("cash evidence is detached and retains attribution revisions for stale approval hashing", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = resolve(input);
  assert.deepEqual(input, before);
  assert.doesNotThrow(() => payrollInputHash(result));
  result.cash!.attributions[0].shares[0].staffId = "changed";
  assert.equal(input.cashAttributions[0].shares[0].staffId, "departed");
  const old = payrollInputHash(resolve(input));
  input.cashAttributions[0].evidence = { attributionRevision: 2 };
  assert.notEqual(payrollInputHash(resolve(input)), old);
  input.cashAttributions[0].evidence = new Date();
  assert.throws(() => resolve(input), /JSON/);
});

test("package cash attribution must match original captured staff bases and outlet", () => {
  const input = fixture();
  input.collections[0].allocations[0].itemType = "PACKAGE";
  input.events = [
    {
      id: "event",
      tenantId: "salon",
      sourceKey: "collection:allocation",
      sourceType: "COLLECTION",
      sourceId: "allocation",
      saleId: "sale",
      outletId: "branch",
      occurredAt: input.operations[0].occurredAt,
      createdAt: input.operations[0].occurredAt,
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
            commissionType: "PKG_SALE",
            baseAmount: "100",
            units: "1",
            businessDate: "2026-09-15",
            status: "EARNED",
            mode: "EXCLUDE",
            fallbackRatePct: "10",
          },
        ],
      },
    },
  ];
  assert.equal(resolve(input).cash!.salonCash, "100.0000");
  input.cashAttributions[0].shares[0].staffId = "different-seller";
  assert.equal(resolve(input).cash, null);
  input.cashAttributions[0].shares[0].staffId = "departed";
  input.cashAttributions[0].outletId = "different-branch";
  assert.equal(resolve(input).cash, null);
});
