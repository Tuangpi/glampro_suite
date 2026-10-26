import assert from "node:assert/strict";
import { test } from "node:test";
import { commissionEventSchema, publishCommissionRuleSchema } from "./commission.js";
const base = {
  scope: "COMPANY",
  itemKind: "SERVICE",
  rate: 10,
  expectedRevision: null,
  reason: "New policy",
};
test("internal redemption financial links retain source time and reject extra fields", () => {
  const link = commissionEventSchema.shape.redemptionEvidence;
  const valid = {
    snapshotId: "capture-1",
    sourceOccurredAt: "2026-10-26T10:00:00.000Z",
    correctsSnapshotId: null,
  };
  assert.equal(link.safeParse(undefined).success, true); // Existing primitive events remain compatible.
  assert.deepEqual(link.parse(valid), valid);
  assert.equal(link.safeParse({ ...valid, sourceOccurredAt: "2026-10-26" }).success, false);
  assert.equal(link.safeParse({ ...valid, snapshotId: "" }).success, false);
  assert.equal(link.safeParse({ ...valid, eligibilityOverride: true }).success, false);
});
test("commission scope validation and explicit zero/inheritance", () => {
  assert.equal(publishCommissionRuleSchema.safeParse(base).success, true);
  assert.equal(publishCommissionRuleSchema.safeParse({ ...base, rate: 0 }).success, true);
  for (const extra of [
    { rate: null },
    { rate: -1 },
    { rate: 101 },
    { rate: 0.001 },
    { staffId: "other" },
    { targetId: "item" },
    { tenantId: "foreign" },
    { expectedRevision: undefined },
  ])
    assert.equal(publishCommissionRuleSchema.safeParse({ ...base, ...extra }).success, false);
  assert.equal(
    publishCommissionRuleSchema.safeParse({ ...base, scope: "STAFF", staffId: "amy", rate: null })
      .success,
    true,
  );
  assert.equal(
    publishCommissionRuleSchema.safeParse({
      ...base,
      scope: "ITEM",
      staffId: "amy",
      targetId: "facial",
      rate: 15,
    }).success,
    true,
  );
  assert.equal(
    publishCommissionRuleSchema.safeParse({ ...base, scope: "DEPARTMENT", staffId: "amy" }).success,
    false,
  );
});
