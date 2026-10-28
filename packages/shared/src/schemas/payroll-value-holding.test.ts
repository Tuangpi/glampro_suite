import assert from "node:assert/strict";
import { test } from "node:test";
import { payrollValueHoldingDetailSchema } from "./payroll-holding.js";

const detail = {
  holdingId: "holding",
  updatedAt: "2026-10-28T00:00:00.000Z",
  creditRemaining: "500.00",
  purchase: null,
  originalTaxCents: null,
  collectedNetCents: null,
  collectedTaxCents: null,
  usedBaseTicks: null,
  missingEvidence: ["ORIGINAL_PURCHASE_EVIDENCE"],
  refunded: false,
  refund: null,
};
test("value detail permits explicit legacy unavailable evidence without invented amounts", () => {
  assert.deepEqual(payrollValueHoldingDetailSchema.parse(detail), detail);
});
test("value detail rejects malformed monetary evidence", () => {
  for (const patch of [
    { creditRemaining: "1.001" },
    { creditRemaining: "-1.00" },
    { collectedNetCents: "1e2" },
    { collectedTaxCents: "-1" },
    { usedBaseTicks: "1.1" },
    { originalTaxCents: "01" },
  ])
    assert.equal(payrollValueHoldingDetailSchema.safeParse({ ...detail, ...patch }).success, false);
});
test("recorded value refund requires explicit complete payout evidence", () => {
  const refund = {
    occurredAt: detail.updatedAt,
    grossCents: "0",
    netCents: "0",
    taxCents: "0",
    reason: "Cancel unused credit",
    payoutMethod: "NONE",
  };
  assert.ok(
    payrollValueHoldingDetailSchema.safeParse({ ...detail, refunded: true, refund }).success,
  );
  assert.equal(
    payrollValueHoldingDetailSchema.safeParse({
      ...detail,
      refund: { ...refund, grossCents: "-1" },
    }).success,
    false,
  );
});
