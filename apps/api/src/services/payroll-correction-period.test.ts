import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolvePayrollCorrectionPeriod as resolve,
  type PayrollCorrectionPeriodRecords,
} from "./payroll-correction-period.js";
import { payrollInputHash } from "./payroll-close-state.js";

function fixture(): PayrollCorrectionPeriodRecords {
  return {
    tenantId: "salon",
    timeZone: "Asia/Singapore",
    originalPeriodKey: "2026-09",
    correctionAt: new Date("2026-10-15T00:00:00Z"),
    periods: [
      { id: "sep", tenantId: "salon", periodKey: "2026-09", status: "APPROVED", revision: 2 },
      { id: "oct", tenantId: "salon", periodKey: "2026-10", status: "OPEN", revision: 0 },
    ],
  };
}

test("TC-19 allocation preserves approved September and selects open October", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = resolve(input);
  assert.equal(result.status, "CORRECTION_PERIOD_EVIDENCE_READY");
  assert.equal(result.earningsActive, false);
  assert.equal(result.allocation!.periodKey, "2026-10");
  assert.equal(result.allocation!.postingAt, "2026-10-15T00:00:00.000Z");
  assert.equal(result.allocation!.expectedRevision, 0);
  assert.deepEqual(input, before);
});

test("calculated targets require invalidation, not reuse of stale statements", () => {
  const input = fixture();
  input.periods[1].status = "CALCULATED";
  input.periods[1].revision = 7;
  const result = resolve(input);
  assert.equal(result.allocation!.invalidateCalculation, true);
  assert.equal(result.allocation!.expectedRevision, 7);
});

test("approved intervening months are skipped with revision evidence and future posting date", () => {
  const input = fixture();
  input.periods[1].status = "APPROVED";
  input.periods.push({
    id: "nov",
    tenantId: "salon",
    periodKey: "2026-11",
    status: "OPEN",
    revision: 0,
  });
  const result = resolve(input);
  assert.equal(result.allocation!.periodKey, "2026-11");
  assert.equal(result.allocation!.postingAt, "2026-10-31T16:00:00.000Z");
  assert.equal(result.allocation!.inspectedPeriods.length, 3);
});

test("missing periods fail closed rather than being created or skipped", () => {
  const input = fixture();
  input.periods[1].periodKey = "2026-11";
  const result = resolve(input);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.allocation, null);
  assert.deepEqual(result.blockers, [
    { code: "NEXT_PERIOD_EVIDENCE_UNAVAILABLE", periodKey: "2026-10" },
  ]);
});

test("unapproved or missing original is not a historical correction allocation", () => {
  const input = fixture();
  input.periods[0].status = "CALCULATED";
  assert.equal(resolve(input).status, "UNAVAILABLE");
  input.periods.shift();
  assert.equal(resolve(input).status, "UNAVAILABLE");
});

test("timezone boundary and year rollover use salon-local calendar months", () => {
  const input = fixture();
  input.originalPeriodKey = "2026-12";
  input.correctionAt = new Date("2026-12-31T16:00:00Z");
  input.periods[0].periodKey = "2026-12";
  input.periods[1].periodKey = "2027-01";
  assert.equal(resolve(input).allocation!.periodKey, "2027-01");
  assert.equal(resolve(input).allocation!.postingAt, "2026-12-31T16:00:00.000Z");
});

test("same-month historical correction posts no earlier than following month", () => {
  const input = fixture();
  input.correctionAt = new Date("2026-09-15T00:00:00Z");
  assert.equal(resolve(input).allocation!.postingAt, "2026-09-30T16:00:00.000Z");
  input.correctionAt = new Date("2026-08-15T00:00:00Z");
  assert.equal(resolve(input).status, "UNAVAILABLE");
});

test("foreign periods, duplicate IDs/months and invalid revisions are rejected", () => {
  for (const change of [
    { tenantId: "foreign" },
    { id: "sep" },
    { periodKey: "2026-09" },
    { revision: -1 },
  ]) {
    const input = fixture();
    Object.assign(input.periods[1], change);
    assert.throws(() => resolve(input));
  }
});

test("allocation is detached, order-independent and sensitive to approval races", () => {
  const input = fixture();
  const result = resolve(input);
  input.periods.reverse();
  assert.equal(payrollInputHash(result), payrollInputHash(resolve(input)));
  result.allocation!.inspectedPeriods[0].revision = 999;
  assert.equal(input.periods[1].revision, 2);
  input.periods[0].status = "APPROVED";
  assert.equal(resolve(input).status, "UNAVAILABLE");
});
