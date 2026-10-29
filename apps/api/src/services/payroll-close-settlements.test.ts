import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolvePayrollCarrySettlements,
  type PayrollCarrySettlement,
} from "./payroll-close-settlements.js";
import { payrollInputHash } from "./payroll-close-state.js";

const balance = {
  staffId: "departed",
  carryForward: [{ componentKey: "old", base: "-25.0000", units: "-1.0000" }],
  fallbackCarryCommission: "-10.1234567890",
};
function fixture(): PayrollCarrySettlement {
  return {
    id: "settlement",
    tenantId: "salon",
    periodKey: "2026-09",
    staffId: "departed",
    revision: 1,
    balanceHash: payrollInputHash(balance),
    approval: { actorId: "owner", at: "2026-09-30T16:00:00.000Z", reason: "Reviewed exact debt" },
    evidence: { revision: 1 },
    components: [{ fromKey: "old", toKey: "new", reason: "Reviewed component mapping" }],
    fallbackWriteOff: { amount: balance.fallbackCarryCommission },
  };
}
test("carry settlements retain explicit mapping, exact write-off and detached approval evidence", () => {
  const input = fixture();
  const result = resolvePayrollCarrySettlements([input], "salon", "2026-09", [balance]);
  assert.equal(result[0].fallbackWriteOff!.amount, "-10.1234567890");
  assert.equal(result[0].components[0].toKey, "new");
  result[0].approval.reason = "Changed";
  assert.equal(input.approval.reason, "Reviewed exact debt");
});
test("settlements reject stale, duplicate, foreign, partial or unknown debt", () => {
  for (const change of [
    "hash",
    "tenant",
    "period",
    "staff",
    "partial",
    "component",
    "duplicate",
    "empty",
    "json",
    "actor",
  ]) {
    const input = fixture();
    if (change === "hash") input.balanceHash = "0".repeat(64);
    if (change === "tenant") input.tenantId = "foreign";
    if (change === "period") input.periodKey = "2026-08";
    if (change === "staff") input.staffId = "unknown";
    if (change === "partial") input.fallbackWriteOff!.amount = "-1.0000000000";
    if (change === "component") input.components[0].fromKey = "missing";
    if (change === "duplicate") input.components.push(structuredClone(input.components[0]));
    if (change === "empty") {
      input.components = [];
      input.fallbackWriteOff = null;
    }
    if (change === "json") input.evidence = new Date();
    if (change === "actor") input.approval.actorId = "";
    assert.throws(
      () => resolvePayrollCarrySettlements([input], "salon", "2026-09", [balance]),
      Error,
      change,
    );
  }
  assert.throws(
    () => resolvePayrollCarrySettlements([fixture(), fixture()], "salon", "2026-09", [balance]),
    /Duplicate/,
  );
});
