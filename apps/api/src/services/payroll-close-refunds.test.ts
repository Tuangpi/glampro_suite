import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePayrollCloseCash } from "./payroll-close-cash.js";
import type { PayrollCloseCollectionRecords } from "./payroll-close-collections.js";
import type { PayrollCloseRefundRecords } from "./payroll-close-refunds.js";
import { payrollInputHash } from "./payroll-close-state.js";

function fixture(valuePackage = false): PayrollCloseCollectionRecords &
  PayrollCloseRefundRecords & {
    cashAttributions: [];
  } {
  const at = new Date("2026-09-15T00:00:00Z");
  const line = {
    id: "refund-line",
    staffId: "departed",
    outletId: "branch",
    commissionType: valuePackage ? "VP_SALE" : "PKG_SALE",
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
  return {
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    operations: [],
    collections: [],
    cashAttributions: [],
    events: [
      {
        id: "refund",
        tenantId: "salon",
        sourceKey: "refund",
        sourceId: "holding",
        sourceType: valuePackage ? "VALUE_PACKAGE_REFUND" : "PACKAGE_REFUND",
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
    ],
    lineageEvents: [
      {
        id: "original",
        tenantId: "salon",
        sourceKey: "original",
        sourceId: "allocation",
        sourceType: "COLLECTION",
        saleId: "sale",
        outletId: "branch",
        occurredAt: new Date("2026-08-15T00:00:00Z"),
        createdAt: new Date("2026-08-15T00:00:00Z"),
        evidence: {
          ...capture,
          lines: [
            { ...line, id: "original-line", baseAmount: "100.0000", businessDate: "2026-08-15" },
          ],
        },
      },
    ],
    refundPayouts: [
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
    ],
  };
}

test("package and value-package payouts subtract net only, retaining departed sellers and negative totals", () => {
  for (const valuePackage of [false, true]) {
    const result = resolvePayrollCloseCash(fixture(valuePackage));
    assert.equal(result.status, "CASH_EVIDENCE_READY");
    assert.equal(result.earningsActive, false);
    assert.equal(result.cash!.salonCash, "-25.0000");
    assert.deepEqual(result.cash!.staff, [{ staffId: "departed", collection: "-25.0000" }]);
    assert.deepEqual(result.cash!.outlets, [{ outletId: "branch", collection: "-25.0000" }]);
  }
});

test("refunds require independently supplied payout evidence", () => {
  const input = fixture();
  delete input.refundPayouts;
  assert.equal(resolvePayrollCloseCash(input).cash, null);
});

test("payout identity, date, tender, GST and net mismatches fail closed", () => {
  for (const patch of [
    { saleId: "other" },
    { saleLineId: "other" },
    { outletId: "other" },
    { eventId: "other" },
    { netCents: "2499" },
    { taxCents: "224" },
    { grossCents: "2724" },
    { payoutMethod: "NONE" as const },
    { occurredAt: new Date("2026-09-16T00:00:00Z") },
  ]) {
    const input = fixture();
    Object.assign(input.refundPayouts![0], patch);
    assert.equal(resolvePayrollCloseCash(input).cash, null, JSON.stringify(patch));
  }
});

test("foreign and duplicate payout evidence is rejected", () => {
  const input = fixture();
  input.refundPayouts![0].tenantId = "other";
  assert.throws(() => resolvePayrollCloseCash(input), /another salon/);
  input.refundPayouts![0].tenantId = "salon";
  input.refundPayouts!.push(structuredClone(input.refundPayouts![0]));
  assert.throws(() => resolvePayrollCloseCash(input), /Duplicate/);
});

test("original collection lineage cannot be absent, foreign-sale, later or insufficient", () => {
  for (const change of ["missing", "sale", "date", "amount"]) {
    const input = fixture();
    if (change === "missing") input.lineageEvents = [];
    if (change === "sale") input.lineageEvents[0].saleId = "other";
    if (change === "date") input.lineageEvents[0].occurredAt = new Date("2026-10-01");
    if (change === "amount")
      (input.lineageEvents[0].evidence as { lines: { baseAmount: string }[] }).lines[0].baseAmount =
        "1";
    assert.equal(resolvePayrollCloseCash(input).cash, null, change);
  }
});

test("refund seller bases must exactly negate the original seller split", () => {
  const input = fixture();
  const evidence = input.events[0].evidence as { lines: { baseAmount: string; staffId: string }[] };
  evidence.lines[0].baseAmount = "-24.9999";
  assert.equal(resolvePayrollCloseCash(input).cash, null);
  evidence.lines[0].baseAmount = "-25.0000";
  evidence.lines[0].staffId = "cashier";
  assert.equal(resolvePayrollCloseCash(input).cash, null);
});

test("explicit zero/NONE cancellation contributes zero without inventing a payout", () => {
  const input = fixture();
  const zero = { netCents: "0", taxCents: "0", grossCents: "0", payoutMethod: "NONE" };
  Object.assign(input.refundPayouts![0], zero);
  Object.assign(input.events[0].evidence as object, zero, { lines: [] });
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.status, "CASH_EVIDENCE_READY");
  assert.equal(result.cash!.salonCash, "0.0000");
});

test("refund evidence is detached and payout revision changes its frozen hash", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = resolvePayrollCloseCash(input);
  assert.deepEqual(input, before);
  const oldHash = payrollInputHash(result);
  input.refundPayouts![0].evidence = { settledRevision: 2 };
  assert.notEqual(payrollInputHash(resolvePayrollCloseCash(input)), oldHash);
  result.cash!.refunds!.payouts[0].saleId = "changed";
  assert.equal(input.refundPayouts![0].saleId, "sale");
});

test("split refunds preserve stable four-decimal residuals", () => {
  const input = fixture();
  const evidence = input.events[0].evidence as {
    netCents: string;
    taxCents: string;
    grossCents: string;
    purchase: { sellers: { staffId: string; share: number }[] };
    lines: { staffId: string; baseAmount: string; id: string }[];
  };
  evidence.purchase.sellers = [
    { staffId: "a", share: 3333 },
    { staffId: "b", share: 6667 },
  ];
  Object.assign(evidence, { netCents: "1", taxCents: "0", grossCents: "1" });
  Object.assign(input.refundPayouts![0], { netCents: "1", taxCents: "0", grossCents: "1" });
  const template = evidence.lines[0];
  evidence.lines = [
    { ...template, id: "a-refund", staffId: "a", baseAmount: "-0.0034" },
    { ...template, id: "b-refund", staffId: "b", baseAmount: "-0.0066" },
  ];
  const original = input.lineageEvents[0].evidence as { lines: typeof evidence.lines };
  original.lines = [
    { ...original.lines[0], id: "a-original", staffId: "a", baseAmount: "33.3300" },
    { ...original.lines[0], id: "b-original", staffId: "b", baseAmount: "66.6700" },
  ];
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.cash!.salonCash, "-0.0100");
  assert.deepEqual(result.cash!.staff, [
    { staffId: "a", collection: "-0.0034" },
    { staffId: "b", collection: "-0.0066" },
  ]);
  evidence.purchase.sellers.reverse();
  assert.equal(payrollInputHash(resolvePayrollCloseCash(input)), payrollInputHash(result));
});

test("independent original allocation must belong to the refunded sale line", () => {
  const input = fixture();
  input.refundPayouts![0].originalAllocations[0].saleLineId = "another-package";
  assert.equal(resolvePayrollCloseCash(input).cash, null);
});

test("two refunds cannot consume the same original consideration", () => {
  const input = fixture();
  input.events.push({ ...structuredClone(input.events[0]), id: "second", sourceKey: "second" });
  input.refundPayouts!.push({
    ...structuredClone(input.refundPayouts![0]),
    id: "second-payout",
    eventId: "second",
  });
  assert.equal(resolvePayrollCloseCash(input).cash, null);
});
