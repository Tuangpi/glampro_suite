import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePayrollCloseCash } from "./payroll-close-cash.js";
import type { PayrollCloseCollectionRecords } from "./payroll-close-collections.js";
import type { PayrollCloseReversalRecords } from "./payroll-close-reversals.js";
import { payrollInputHash } from "./payroll-close-state.js";

function fixture(
  type: "REDEMPTION" | "VALUE_SPEND" | "CORRECTION" = "REDEMPTION",
): PayrollCloseCollectionRecords & PayrollCloseReversalRecords & { cashAttributions: [] } {
  const at = new Date("2026-09-15T00:00:00Z");
  const before = new Date("2026-08-15T00:00:00Z");
  const line = {
    id: "original-line",
    staffId: "departed",
    outletId: "branch",
    commissionType: type === "VALUE_SPEND" ? "VP_SPEND" : "PKG_RED",
    baseAmount: "100.0000",
    units: "1.0000",
    businessDate: "2026-08-15",
    status: "EARNED",
    mode: "FOLLOW_PLAN",
    fallbackRatePct: "10",
  };
  const capture = {
    version: 1,
    status: "CAPTURED",
    postingStatus: "PENDING_RELEASE",
    currency: "SGD",
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
              id: "reverse-line",
              baseAmount: "-100.0000",
              units: "-1.0000",
              businessDate: "2026-09-15",
            },
          ],
        },
      },
    ],
    lineageEvents: [
      {
        id: "original",
        tenantId: "salon",
        sourceKey: "original",
        sourceType: type,
        sourceId: "usage",
        saleId: "sale",
        outletId: "branch",
        occurredAt: before,
        createdAt: before,
        evidence: { ...capture, lines: [line] },
      },
    ],
    noCashReversals: [
      {
        id: "void-evidence",
        tenantId: "salon",
        eventId: "reverse",
        originalEventId: "original",
        originalSourceId: "usage",
        originalSourceType: type,
        saleId: "sale",
        outletId: "branch",
        occurredAt: at,
        currency: "SGD",
        netCents: "0",
        taxCents: "0",
        grossCents: "0",
        evidence: { operationalRevision: 1, action: "VOID_USAGE" },
      },
    ],
  };
}

test("explicit non-cash redemption, spend and correction reversals do not subtract bases from cash", () => {
  for (const type of ["REDEMPTION", "VALUE_SPEND", "CORRECTION"] as const) {
    const result = resolvePayrollCloseCash(fixture(type));
    assert.equal(result.status, "CASH_EVIDENCE_READY", JSON.stringify(result.blockers));
    assert.equal(result.earningsActive, false);
    assert.equal(result.cash!.salonCash, "0.0000");
    assert.deepEqual(result.cash!.staff, []);
    assert.deepEqual(result.cash!.outlets, []);
    assert.equal(result.cash!.reversals!.noCashReversals.length, 1);
  }
});

test("missing no-cash evidence stays unavailable rather than assuming zero", () => {
  const input = fixture();
  delete input.noCashReversals;
  assert.equal(resolvePayrollCloseCash(input).cash, null);
});

test("no-cash records must match reversal and operational source identity exactly", () => {
  for (const patch of [
    { eventId: "other" },
    { originalEventId: "other" },
    { originalSourceId: "other" },
    { originalSourceType: "VALUE_SPEND" as const },
    { saleId: "other" },
    { outletId: "other" },
    { occurredAt: new Date("2026-09-16T00:00:00Z") },
  ]) {
    const input = fixture();
    Object.assign(input.noCashReversals![0], patch);
    assert.equal(resolvePayrollCloseCash(input).cash, null, JSON.stringify(patch));
  }
});

test("foreign and duplicate no-cash evidence throws", () => {
  const input = fixture();
  input.noCashReversals![0].tenantId = "other";
  assert.throws(() => resolvePayrollCloseCash(input), /another salon/);
  input.noCashReversals![0].tenantId = "salon";
  input.noCashReversals!.push({ ...input.noCashReversals![0], id: "second" });
  assert.throws(() => resolvePayrollCloseCash(input), /Duplicate/);
});

test("sale-line and collection reversals cannot masquerade as no-cash usage", () => {
  for (const sourceType of ["SALE_LINE", "COLLECTION"] as const) {
    const input = fixture();
    input.lineageEvents[0].sourceType = sourceType;
    assert.equal(resolvePayrollCloseCash(input).cash, null);
  }
});

test("no-cash evidence cannot bypass original lineage or exact reversal validation", () => {
  for (const change of ["missing", "amount", "date", "sale", "original"]) {
    const input = fixture();
    const evidence = input.events[0].evidence as {
      originalEventId: string;
      lines: { baseAmount: string }[];
    };
    if (change === "missing") input.lineageEvents = [];
    if (change === "amount") evidence.lines[0].baseAmount = "-99";
    if (change === "date") input.events[0].occurredAt = new Date("2026-10-15");
    if (change === "sale") input.lineageEvents[0].saleId = "other";
    if (change === "original") evidence.originalEventId = "other";
    assert.equal(resolvePayrollCloseCash(input).cash, null, change);
  }
});

test("nonzero money, foreign currency and non-JSON evidence are refused", () => {
  for (const patch of [
    { netCents: "1" },
    { taxCents: "1" },
    { grossCents: "1" },
    { currency: "USD" },
    { evidence: new Date() },
    { evidence: null },
  ]) {
    const input = fixture();
    Object.assign(input.noCashReversals![0], patch);
    assert.throws(() => resolvePayrollCloseCash(input));
  }
});

test("no-cash evidence is detached and revision-sensitive for frozen approval", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = resolvePayrollCloseCash(input);
  assert.deepEqual(input, before);
  const hash = payrollInputHash(result);
  input.noCashReversals![0].evidence = { operationalRevision: 2 };
  assert.notEqual(payrollInputHash(resolvePayrollCloseCash(input)), hash);
  result.cash!.reversals!.noCashReversals[0].saleId = "changed";
  assert.equal(input.noCashReversals![0].saleId, "sale");
});

test("empty reversal inventory is explicit and does not invent evidence", () => {
  const input = fixture();
  input.events = [];
  input.lineageEvents = [];
  input.noCashReversals = [];
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.status, "CASH_EVIDENCE_READY");
  assert.deepEqual(result.cash!.reversals!.noCashReversals, []);
});
