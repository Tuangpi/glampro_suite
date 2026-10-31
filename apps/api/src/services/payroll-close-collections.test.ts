import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolvePayrollCloseCollections as resolve,
  type PayrollCloseCollectionRecords,
} from "./payroll-close-collections.js";
import { payrollInputHash } from "./payroll-close-state.js";

function fixture(): PayrollCloseCollectionRecords {
  const operation = {
    tenantId: "salon",
    sourceType: "SALE_PAYMENT" as const,
    sourceId: "payment",
    saleId: "sale",
    currency: "SGD" as const,
    grossCents: "10900",
    occurredAt: new Date("2026-09-15T02:00:00Z"),
  };
  return {
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
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
            saleLineId: "sale-line",
            itemType: "PACKAGE",
            grossCents: "10900",
            netCents: "10000",
            taxCents: "900",
          },
        ],
      },
    ],
    events: [
      {
        id: "event",
        tenantId: "salon",
        sourceKey: "collection:allocation",
        sourceType: "COLLECTION",
        sourceId: "allocation",
        saleId: "sale",
        outletId: "branch",
        occurredAt: operation.occurredAt,
        createdAt: operation.occurredAt,
        evidence: {
          version: 1,
          status: "CAPTURED",
          postingStatus: "PENDING_RELEASE",
          currency: "SGD",
          lines: [
            {
              id: "line",
              staffId: "seller",
              outletId: "branch",
              commissionType: "PKG_SALE",
              baseAmount: "100.0000",
              units: "1.0000",
              businessDate: "2026-09-15",
              status: "EARNED",
              mode: "FOLLOW_PLAN",
              fallbackRatePct: "10",
            },
          ],
        },
      },
    ],
  };
}

test("operational payment, captured GST allocations and package bases reconcile exactly", () => {
  const result = resolve(fixture());
  assert.equal(result.status, "COLLECTION_EVIDENCE_READY");
  assert.equal(result.earningsActive, false);
  assert.equal(result.reconciliation!.externalGrossCents, "10900");
  assert.equal(result.reconciliation!.externalNetCents, "10000");
});

test("missing operational or captured payments never produce partial reconciliation", () => {
  for (const field of ["operations", "collections"] as const) {
    const input = fixture();
    input[field] = [];
    assert.equal(resolve(input).reconciliation, null);
  }
});

test("sale, gross and payment date mismatches are blocked", () => {
  for (const change of [
    { saleId: "other" },
    { grossCents: "100" },
    { occurredAt: new Date("2026-09-16T00:00:00Z") },
  ]) {
    const input = fixture();
    Object.assign(input.operations[0], change);
    assert.ok(resolve(input).blockers.some((row) => row.code === "COLLECTION_PAYMENT_MISMATCH"));
  }
});

test("allocation net/tax/gross, parent and gross totals must agree", () => {
  for (const change of [{ netCents: "9999" }, { collectionId: "other" }, { grossCents: "100" }]) {
    const input = fixture();
    Object.assign(input.collections[0].allocations[0], change);
    assert.equal(resolve(input).reconciliation, null);
  }
});

test("missing, orphaned and duplicate package collection events are blocked", () => {
  const input = fixture();
  input.events = [];
  assert.equal(resolve(input).reconciliation, null);
  const orphan = fixture();
  orphan.events[0].sourceId = "other";
  assert.equal(resolve(orphan).reconciliation, null);
  const duplicate = fixture();
  const second = structuredClone(duplicate.events[0]);
  second.id = "second";
  second.sourceKey = "second";
  duplicate.events.push(second);
  assert.equal(resolve(duplicate).reconciliation, null);
});

test("package net bases cannot use gross consideration or another sale", () => {
  const input = fixture();
  const evidence = input.events[0].evidence as { lines: { baseAmount: string }[] };
  evidence.lines[0].baseAmount = "109.0000";
  assert.equal(resolve(input).reconciliation, null);
  evidence.lines[0].baseAmount = "100.0000";
  input.events[0].saleId = "other";
  assert.equal(resolve(input).reconciliation, null);
});

test("foreign records and duplicate source or allocation identities are rejected", () => {
  const input = fixture();
  input.operations[0].tenantId = "foreign";
  assert.throws(() => resolve(input), /another salon/);
  const duplicate = fixture();
  duplicate.operations.push(structuredClone(duplicate.operations[0]));
  assert.throws(() => resolve(duplicate), /Duplicate/);
  const allocation = fixture();
  allocation.collections[0].allocations.push(
    structuredClone(allocation.collections[0].allocations[0]),
  );
  assert.throws(() => resolve(allocation), /Duplicate/);
});

test("half-open month boundaries reject out-of-period money", () => {
  const input = fixture();
  input.operations[0].occurredAt = new Date("2026-09-30T16:00:00Z");
  assert.ok(resolve(input).blockers.some((row) => row.code === "PAYMENT_OUTSIDE_REQUESTED_MONTH"));
});

test("invalid captured evidence cannot be cleared by valid collections", () => {
  const input = fixture();
  input.events[0].evidence = {};
  assert.equal(resolve(input).reconciliation, null);
  assert.ok(resolve(input).sourceBlockers.length);
});

test("returned snapshots are JSON-hashable detached copies", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = resolve(input);
  assert.deepEqual(input, before);
  assert.doesNotThrow(() => payrollInputHash(result));
  result.reconciliation!.collections[0].allocations[0].netCents = "1";
  assert.equal(input.collections[0].allocations[0].netCents, "10000");
});

test("split sellers retain four-decimal residuals while reconciling collected cents", () => {
  const input = fixture();
  const evidence = input.events[0].evidence as { lines: Record<string, unknown>[] };
  const original = evidence.lines[0];
  evidence.lines = [
    { ...original, id: "seller-a", staffId: "a", baseAmount: "33.3333", units: "0.3333" },
    { ...original, id: "seller-b", staffId: "b", baseAmount: "66.6667", units: "0.6667" },
  ];
  assert.equal(resolve(input).status, "COLLECTION_EVIDENCE_READY");
  evidence.lines[1].baseAmount = "66.6666";
  assert.equal(resolve(input).reconciliation, null);
});

test("ordinary service allocations reconcile payments but never masquerade as package bases", () => {
  const input = fixture();
  input.collections[0].allocations[0].itemType = "SERVICE";
  input.events = [];
  assert.equal(resolve(input).status, "COLLECTION_EVIDENCE_READY");
  input.events = fixture().events;
  assert.equal(resolve(input).reconciliation, null);
});

test("ordinary instalment sources reconcile exact later cash without issuing units again", () => {
  const input = fixture();
  input.operations[0].sourceType = "OUTSTANDING_PAYMENT";
  input.collections[0].sourceType = "OUTSTANDING_PAYMENT";
  input.collections[0].allocations[0].itemType = "SERVICE";
  input.events[0].sourceType = "ORDINARY_COLLECTION";
  const evidence = input.events[0].evidence as {
    lines: { commissionType: string; units: string; baseAmount: string }[];
  };
  evidence.lines[0].commissionType = "SVC";
  evidence.lines[0].units = "0.0000";
  assert.equal(resolve(input).status, "COLLECTION_EVIDENCE_READY");
  evidence.lines[0].units = "1.0000";
  assert.equal(resolve(input).reconciliation, null);
  evidence.lines[0].units = "0.0000";
  evidence.lines[0].baseAmount = "100.0001";
  assert.equal(resolve(input).reconciliation, null);
  evidence.lines[0].baseAmount = "100.0000";
  input.collections[0].sourceType = "SALE_PAYMENT";
  input.operations[0].sourceType = "SALE_PAYMENT";
  assert.equal(resolve(input).reconciliation, null);
});
