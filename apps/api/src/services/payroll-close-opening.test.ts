import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePayrollCloseCarry } from "./payroll-close-carry.js";
import { openPayrollClose, payrollInputHash } from "./payroll-close-state.js";
import { resolvePayrollOpeningCarry, type PayrollOpeningCarry } from "./payroll-close-opening.js";

function fixture(): PayrollOpeningCarry {
  return {
    id: "opening",
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    effectiveAt: "2026-08-31T16:00:00.000Z",
    revision: 1,
    firstClose: true,
    completeInventory: true,
    approval: {
      actorId: "owner",
      at: "2026-08-31T15:00:00.000Z",
      reason: "Reviewed complete opening inventory",
    },
    evidence: { inventoryRevision: 1, eligibilityRevision: 1 },
    staff: [{ staffId: "departed", carryForward: [], fallbackCarryCommission: "-10.1234567890" }],
  };
}

test("explicit first-close evidence retains exact fallback debt and departed staff", () => {
  const opening = fixture();
  const result = resolvePayrollCloseCarry({
    tenantId: "salon",
    periodKey: "2026-09",
    previous: null,
    opening,
  });
  assert.equal(result.status, "CARRY_EVIDENCE_READY");
  assert.deepEqual(result.carry!.requiredStaffIds, ["departed"]);
  assert.equal(result.carry!.staff[0].fallbackCarryCommission, "-10.1234567890");
  assert.equal(result.carry!.previousCloseId, null);
  assert.equal(result.carry!.calculation, null);
  assert.equal(result.earningsActive, false);
});

test("explicit reviewed zero inventory differs from missing opening evidence", () => {
  const opening = fixture();
  opening.staff = [];
  const scope = { tenantId: "salon", periodKey: "2026-09", previous: null };
  assert.equal(resolvePayrollCloseCarry(scope).carry, null);
  assert.deepEqual(resolvePayrollCloseCarry({ ...scope, opening }).carry!.staff, []);
});

test("opening carry uses salon-local boundaries including DST and January rollover", () => {
  for (const [periodKey, timeZone, effectiveAt] of [
    ["2026-11", "America/New_York", "2026-11-01T04:00:00.000Z"],
    ["2027-01", "Asia/Singapore", "2026-12-31T16:00:00.000Z"],
  ]) {
    const opening = { ...fixture(), periodKey, timeZone, effectiveAt };
    opening.approval.at = effectiveAt;
    assert.equal(resolvePayrollOpeningCarry(opening, "salon", periodKey).effectiveAt, effectiveAt);
  }
});

test("opening evidence cannot replace an existing prior close", () => {
  const result = resolvePayrollCloseCarry({
    tenantId: "salon",
    periodKey: "2026-09",
    opening: fixture(),
    previous: { id: "prior", tenantId: "salon", state: openPayrollClose("2026-08") },
  });
  assert.deepEqual(result.blockers, ["OPENING_PREVIOUS_CLOSE_CONFLICT"]);
  assert.equal(result.carry, null);
});

test("opening evidence rejects foreign scope, wrong month, boundaries and late approval", () => {
  for (const change of ["tenant", "month", "effective", "approval", "zone"]) {
    const opening = fixture();
    if (change === "tenant") opening.tenantId = "foreign";
    if (change === "month") opening.periodKey = "2026-08";
    if (change === "effective") opening.effectiveAt = "2026-09-01T00:00:00.000Z";
    if (change === "approval") opening.approval.at = "2026-08-31T16:00:00.001Z";
    if (change === "zone") opening.timeZone = "Invalid/Zone";
    assert.throws(() => resolvePayrollOpeningCarry(opening, "salon", "2026-09"), Error, change);
  }
});

test("opening evidence requires complete first-close approval and JSON provenance", () => {
  for (const change of ["first", "complete", "actor", "reason", "revision", "evidence"]) {
    const opening = fixture();
    if (change === "first") Object.assign(opening, { firstClose: false });
    if (change === "complete") Object.assign(opening, { completeInventory: false });
    if (change === "actor") opening.approval.actorId = "";
    if (change === "reason") opening.approval.reason = "";
    if (change === "revision") opening.revision = 0;
    if (change === "evidence") opening.evidence = new Date();
    assert.throws(() => resolvePayrollOpeningCarry(opening, "salon", "2026-09"), Error, change);
  }
});

test("opening balances reject positive amounts, duplicate staff and component keys", () => {
  for (const change of ["fallback", "base", "units", "staff", "component"]) {
    const opening = fixture();
    const staff = opening.staff[0];
    staff.carryForward = [{ componentKey: "historic", base: "-1.0000", units: "-0.5000" }];
    if (change === "fallback") staff.fallbackCarryCommission = "1.0000000000";
    if (change === "base") staff.carryForward[0].base = "0.0001";
    if (change === "units") staff.carryForward[0].units = "1";
    if (change === "staff") opening.staff.push(structuredClone(staff));
    if (change === "component") staff.carryForward.push(structuredClone(staff.carryForward[0]));
    assert.throws(() => resolvePayrollOpeningCarry(opening, "salon", "2026-09"), Error, change);
  }
});

test("opening snapshots are detached, canonically ordered and revision sensitive", () => {
  const opening = fixture();
  opening.staff[0].carryForward = [
    { componentKey: "z", base: "-1", units: "0" },
    { componentKey: "a", base: "0", units: "-1" },
  ];
  const before = structuredClone(opening);
  const result = resolvePayrollOpeningCarry(opening, "salon", "2026-09");
  assert.deepEqual(opening, before);
  const hash = payrollInputHash(result);
  opening.staff[0].carryForward.reverse();
  assert.equal(payrollInputHash(resolvePayrollOpeningCarry(opening, "salon", "2026-09")), hash);
  opening.revision++;
  assert.notEqual(payrollInputHash(resolvePayrollOpeningCarry(opening, "salon", "2026-09")), hash);
  result.staff[0].fallbackCarryCommission = "0.0000000000";
  assert.equal(opening.staff[0].fallbackCarryCommission, "-10.1234567890");
});
