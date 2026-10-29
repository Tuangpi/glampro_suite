import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolvePayrollCloseInventory as resolve,
  type PayrollCloseInventoryRecords,
} from "./payroll-close-inventory.js";
import { payrollInputHash } from "./payroll-close-state.js";

function fixture(): PayrollCloseInventoryRecords {
  const operation = {
    tenantId: "salon",
    sourceType: "SALE_LINE" as const,
    sourceId: "line",
    saleId: "sale",
    outletId: "branch",
    occurredAt: new Date("2026-09-15T00:00:00Z"),
    evidence: { revision: 1 },
  };
  return {
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    lineageEvents: [],
    operations: [operation],
    events: [
      {
        ...operation,
        id: "event",
        sourceKey: "key",
        createdAt: operation.occurredAt,
        evidence: {
          version: 1,
          status: "CAPTURED",
          postingStatus: "PENDING_RELEASE",
          currency: "SGD",
          lines: [
            {
              id: "base",
              staffId: "staff",
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
    ],
  };
}
test("independent operation matches exactly one captured source without activation", () => {
  const result = resolve(fixture());
  assert.equal(result.status, "INVENTORY_EVIDENCE_READY");
  assert.equal(result.earningsActive, false);
  assert.equal(result.inventory!.operations.length, 1);
});
test("missing capture and orphan capture cannot produce usable inventory", () => {
  const input = fixture();
  input.events = [];
  assert.equal(resolve(input).inventory, null);
  const orphan = fixture();
  orphan.operations = [];
  assert.equal(resolve(orphan).inventory, null);
});
test("sale, outlet and operation timestamp must match", () => {
  for (const change of [
    { saleId: "other" },
    { outletId: null },
    { occurredAt: new Date("2026-09-16T00:00:00Z") },
  ]) {
    const input = fixture();
    Object.assign(input.operations[0], change);
    assert.equal(resolve(input).inventory, null);
  }
});
test("duplicate operation or captured source identity is rejected or blocked", () => {
  const input = fixture();
  input.operations.push(structuredClone(input.operations[0]));
  assert.throws(() => resolve(input), /Duplicate/);
  const duplicate = fixture();
  const event = structuredClone(duplicate.events[0]);
  event.id = "second";
  event.sourceKey = "second";
  duplicate.events.push(event);
  assert.equal(resolve(duplicate).inventory, null);
});
test("foreign operations and absent evidence fail closed", () => {
  const input = fixture();
  input.operations[0].tenantId = "foreign";
  assert.throws(() => resolve(input), /another salon/);
  const missing = fixture();
  missing.operations[0].evidence = null;
  assert.throws(() => resolve(missing));
});
test("inventory snapshots remain detached and preserve revisions for hashing", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = resolve(input);
  assert.deepEqual(input, before);
  assert.doesNotThrow(() => payrollInputHash(result));
  result.inventory!.operations[0].saleId = "changed";
  assert.equal(input.operations[0].saleId, "sale");
  const old = payrollInputHash(resolve(input));
  input.operations[0].evidence = { revision: 2 };
  assert.notEqual(payrollInputHash(resolve(input)), old);
});
