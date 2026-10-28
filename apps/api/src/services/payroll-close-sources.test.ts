import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePayrollStaffPeriod, type PayrollBaseLine } from "@glampro_suite/shared";
import { payrollInputHash } from "./payroll-close-state.js";
import {
  resolvePayrollCloseSources,
  type PayrollCloseSourceRecords,
} from "./payroll-close-sources.js";

function line(extra: Partial<PayrollBaseLine> = {}): PayrollBaseLine {
  return {
    id: "line",
    staffId: "departed",
    outletId: "branch",
    commissionType: "PKG_RED",
    baseAmount: "100.0000",
    units: "1.0000",
    businessDate: "2026-09-15",
    status: "EARNED",
    mode: "FOLLOW_PLAN",
    fallbackRatePct: "10",
    ...extra,
  };
}
function event(id = "source", lines = [line()]): PayrollCloseSourceRecords["events"][number] {
  return {
    id,
    tenantId: "salon",
    sourceKey: id,
    sourceType: "REDEMPTION",
    sourceId: "redemption",
    saleId: "sale",
    outletId: "branch",
    occurredAt: new Date("2026-09-15T02:00:00.000Z"),
    createdAt: new Date("2026-09-15T02:00:00.000Z"),
    evidence: {
      version: 1,
      status: "CAPTURED",
      postingStatus: "PENDING_RELEASE",
      currency: "SGD",
      missingEvidence: [],
      lines,
    },
  };
}
function fixture(): PayrollCloseSourceRecords {
  return {
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    events: [event()],
    lineageEvents: [],
  };
}
function evidence(row: PayrollCloseSourceRecords["events"][number]) {
  return row.evidence as { [key: string]: unknown; lines: PayrollBaseLine[] };
}
function reversalFixture(): PayrollCloseSourceRecords {
  const input = fixture();
  const original = event("original", [line({ id: "original-line", businessDate: "2026-08-15" })]);
  original.occurredAt = new Date("2026-08-15T02:00:00.000Z");
  original.createdAt = original.occurredAt;
  const reversal = event("reverse", [
    line({ id: "reverse-line", baseAmount: "-100.0000", units: "-1.0000" }),
  ]);
  reversal.sourceType = "REVERSAL";
  reversal.sourceId = original.id;
  evidence(reversal).originalEventId = original.id;
  input.events = [reversal];
  input.lineageEvents = [original];
  return input;
}
const resolve = (input = fixture()) => resolvePayrollCloseSources(input);

test("captured sources retain exact lines, source lineage and departed staff IDs without activation", () => {
  const result = resolve();
  assert.equal(result.status, "SOURCE_EVIDENCE_READY");
  assert.equal(result.earningsActive, false);
  assert.deepEqual(result.sources!.requiredStaffIds, ["departed"]);
  assert.deepEqual(result.sources!.lines, [line()]);
  assert.equal(result.sources!.events[0].id, "source");
  assert.doesNotThrow(() => payrollInputHash(result));
});

test("missing, unavailable, mixed-currency or released evidence yields no partial sources", () => {
  for (const change of [
    { status: "UNAVAILABLE" },
    { version: 2 },
    { currency: null },
    { currency: "USD" },
    { postingStatus: "POSTED" },
    { missingEvidence: ["SOURCE_ECONOMICS"] },
    { lines: null },
  ]) {
    const input = fixture();
    Object.assign(evidence(input.events[0]), change);
    input.events.push(event("good-source", [line({ id: "good-line" })]));
    const result = resolve(input);
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.sources, null);
    assert.ok(result.blockers.some((row) => row.code === "SOURCE_EVIDENCE_UNAVAILABLE"));
  }
});

test("source month boundaries are inclusive start and exclusive end in salon time", () => {
  const input = fixture();
  input.events[0].occurredAt = new Date("2026-08-31T16:00:00.000Z");
  evidence(input.events[0]).lines[0].businessDate = "2026-09-01";
  assert.equal(resolve(input).status, "SOURCE_EVIDENCE_READY");
  input.events[0].occurredAt = new Date("2026-09-30T16:00:00.000Z");
  evidence(input.events[0]).lines[0].businessDate = "2026-10-01";
  assert.ok(resolve(input).blockers.some((row) => row.code === "SOURCE_OUTSIDE_REQUESTED_MONTH"));
});

test("wrong business date, outlet, duplicate line and PAID/REVERSED status block selection", () => {
  for (const change of [
    { businessDate: "2026-09-14" },
    { outletId: "another-branch" },
    { status: "PAID" as const },
    { status: "REVERSED" as const },
  ]) {
    const input = fixture();
    Object.assign(evidence(input.events[0]).lines[0], change);
    assert.equal(resolve(input).sources, null);
  }
  const input = fixture();
  input.events.push(event("another-source"));
  assert.ok(resolve(input).blockers.some((row) => row.code === "DUPLICATE_SOURCE_LINE"));
});

test("cross-tenant events and duplicate source event IDs or source keys fail closed", () => {
  for (const change of [
    (input: PayrollCloseSourceRecords) => {
      input.events[0].tenantId = "other";
    },
    (input: PayrollCloseSourceRecords) => {
      input.events.push(event());
    },
    (input: PayrollCloseSourceRecords) => {
      input.lineageEvents.push({ ...event("other"), sourceKey: "source" });
    },
  ]) {
    const input = fixture();
    change(input);
    assert.throws(() => resolve(input));
  }
});

test("prior-month reversal retains original history but contributes only the new negative lines", () => {
  const input = reversalFixture();
  const before = structuredClone(input);
  const result = resolve(input);
  assert.equal(result.status, "SOURCE_EVIDENCE_READY");
  assert.equal(result.sources!.lines.length, 1);
  assert.equal(result.sources!.lines[0].baseAmount, "-100.0000");
  assert.equal(result.sources!.lineageEvents[0].occurredAt, "2026-08-15T02:00:00.000Z");
  const calculation = calculatePayrollStaffPeriod({
    staffId: "departed",
    periodKey: "2026-09",
    joinDate: null,
    plan: null,
    lines: result.sources!.lines,
  });
  assert.equal(calculation.commissionTotal, "0.00");
  assert.equal(calculation.fallbackCarryCommission, "-10.0000000000");
  assert.deepEqual(input, before);
});

test("same-month reversal is additive and nets exactly without deleting original source lines", () => {
  const input = reversalFixture();
  const original = input.lineageEvents.pop()!;
  original.occurredAt = new Date("2026-09-14T02:00:00.000Z");
  evidence(original).lines[0].businessDate = "2026-09-14";
  input.events.push(original);
  const result = resolve(input);
  assert.equal(result.sources!.lines.length, 2);
  const calculated = calculatePayrollStaffPeriod({
    staffId: "departed",
    periodKey: "2026-09",
    joinDate: null,
    plan: null,
    lines: result.sources!.lines,
  });
  assert.equal(calculated.commissionTotal, "0.00");
  assert.equal(calculated.fallbackCarryCommission, "0.0000000000");
});

test("reversal requires the original tenant/sale/outlet/time and explicit original-event link", () => {
  for (const change of [
    (input: PayrollCloseSourceRecords) => {
      input.lineageEvents = [];
    },
    (input: PayrollCloseSourceRecords) => {
      input.lineageEvents[0].saleId = "other-sale";
    },
    (input: PayrollCloseSourceRecords) => {
      evidence(input.events[0]).originalEventId = "wrong";
    },
    (input: PayrollCloseSourceRecords) => {
      input.lineageEvents[0].occurredAt = new Date("2026-10-01T00:00:00.000Z");
    },
    (input: PayrollCloseSourceRecords) => {
      input.lineageEvents[0].sourceType = "REVERSAL";
    },
  ]) {
    const input = reversalFixture();
    change(input);
    assert.equal(resolve(input).sources, null);
  }
});

test("reversal must negate base and units while preserving original rate/mode/category/staff", () => {
  for (const change of [
    { baseAmount: "-99.9999" },
    { units: "0.0000" },
    { fallbackRatePct: "20" },
    { productCategory: "other" },
    { staffId: "someone-else" },
    { mode: "EXCLUDE" as const },
  ]) {
    const input = reversalFixture();
    Object.assign(evidence(input.events[0]).lines[0], change);
    assert.equal(resolve(input).sources, null);
  }
});

test("fixed award reversals reconcile exactly and numeric decimal spellings do not change negation", () => {
  const input = reversalFixture();
  Object.assign(evidence(input.lineageEvents[0]).lines[0], {
    mode: "FIXED",
    fixedCommission: "12.3456",
    baseAmount: "100",
    units: "1",
  });
  Object.assign(evidence(input.events[0]).lines[0], { mode: "FIXED", fixedCommission: "-12.3456" });
  assert.equal(resolve(input).status, "SOURCE_EVIDENCE_READY");
  evidence(input.events[0]).lines[0].fixedCommission = "-12.34";
  assert.ok(resolve(input).blockers.some((row) => row.code === "REVERSAL_NOT_EXACT"));
});

test("duplicate reversals cannot claw back an original twice", () => {
  const input = reversalFixture();
  const second = structuredClone(input.events[0]);
  second.id = "second-reversal";
  second.sourceKey = "second-reversal";
  evidence(second).lines[0].id = "second-reversal-line";
  input.events.push(second);
  assert.ok(resolve(input).blockers.some((row) => row.code === "DUPLICATE_SOURCE_REVERSAL"));
});

test("zero-payout cancellation is valid empty evidence, but empty positive refunds are not", () => {
  const input = fixture();
  input.events[0].sourceType = "PACKAGE_REFUND";
  Object.assign(evidence(input.events[0]), {
    lines: [],
    netCents: "0",
    taxCents: "0",
    grossCents: "0",
    payoutMethod: "NONE",
  });
  assert.equal(resolve(input).status, "SOURCE_EVIDENCE_READY");
  assert.deepEqual(resolve(input).sources!.requiredStaffIds, []);
  evidence(input.events[0]).grossCents = "100";
  assert.equal(resolve(input).sources, null);
  input.events[0].sourceType = "SALE_LINE";
  assert.ok(resolve(input).blockers.some((row) => row.code === "SOURCE_LINES_UNAVAILABLE"));
});

test("database event order cannot change fingerprint; returned evidence owns deep copies", () => {
  const input = fixture();
  input.events.push(event("second", [line({ id: "second-line", staffId: "other" })]));
  const result = resolve(input);
  input.events.reverse();
  assert.equal(payrollInputHash(resolve(input)), payrollInputHash(result));
  result.sources!.lines[0].baseAmount = "9999";
  assert.notEqual(resolve(input).sources!.lines[0].baseAmount, "9999");
  evidence(input.events[0]).lines[0].baseAmount = "200";
  assert.notEqual(payrollInputHash(resolve(input)), payrollInputHash(result));
});

test("source types cannot impersonate other commission bases or duplicate credited staff", () => {
  const input = fixture();
  evidence(input.events[0]).lines[0].commissionType = "PKG_SALE";
  assert.ok(resolve(input).blockers.some((row) => row.code === "SOURCE_COMMISSION_TYPE_MISMATCH"));
  evidence(input.events[0]).lines = [line(), line({ id: "second-line" })];
  assert.ok(resolve(input).blockers.some((row) => row.code === "DUPLICATE_SOURCE_STAFF"));
});

test("split-performer reversals preserve each staff member's original four-decimal residual", () => {
  const input = reversalFixture();
  evidence(input.lineageEvents[0]).lines = [
    line({
      id: "original-a",
      staffId: "a",
      businessDate: "2026-08-15",
      baseAmount: "33.3333",
      units: "0.3333",
    }),
    line({
      id: "original-b",
      staffId: "b",
      businessDate: "2026-08-15",
      baseAmount: "66.6667",
      units: "0.6667",
    }),
  ];
  evidence(input.events[0]).lines = [
    line({ id: "reverse-b", staffId: "b", baseAmount: "-66.6667", units: "-0.6667" }),
    line({ id: "reverse-a", staffId: "a", baseAmount: "-33.3333", units: "-0.3333" }),
  ];
  assert.equal(resolve(input).status, "SOURCE_EVIDENCE_READY");
  evidence(input.events[0]).lines[1].baseAmount = "-33.3334";
  assert.equal(resolve(input).sources, null);
});
