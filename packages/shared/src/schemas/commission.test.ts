import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commissionEventSchema,
  publishCommissionRuleSchema,
  bulkPublishCommissionRulesSchema,
  commissionKindSchema,
} from "./commission.js";
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
test("administration accepts all kinds, package overrides and strict atomic batches", () => {
  for (const itemKind of commissionKindSchema.options)
    assert.equal(publishCommissionRuleSchema.safeParse({ ...base, itemKind }).success, true);
  const pkg = {
    ...base,
    itemKind: "PACKAGE_REDEMPTION",
    scope: "PACKAGE",
    targetId: "pkg",
    rate: null,
  };
  assert.equal(publishCommissionRuleSchema.safeParse(pkg).success, true);
  for (const extra of [{ itemKind: "SERVICE" }, { staffId: "staff" }, { targetId: null }])
    assert.equal(publishCommissionRuleSchema.safeParse({ ...pkg, ...extra }).success, false);
  assert.equal(
    publishCommissionRuleSchema.safeParse({ ...pkg, scope: "DEPARTMENT", staffId: "staff" })
      .success,
    false,
  );
  const rule = { staffId: "amy", itemKind: "FOC", scope: "STAFF", targetId: null, rate: 0 };
  const batch = { expectedRevision: null, reason: "Matrix publish", rules: [rule] };
  assert.equal(bulkPublishCommissionRulesSchema.safeParse(batch).success, true);
  for (const extra of [
    { rules: [] },
    { rules: [rule, rule] },
    { rules: [{ ...rule, rate: 100.01 }] },
    { rules: [{ ...rule, tenantId: "foreign" }] },
    { rules: [{ ...rule, scope: "PACKAGE" }] },
    { activateEarnings: true },
    { expectedRevision: undefined },
  ])
    assert.equal(bulkPublishCommissionRulesSchema.safeParse({ ...batch, ...extra }).success, false);
  assert.equal(
    bulkPublishCommissionRulesSchema.safeParse({
      ...batch,
      rules: Array.from({ length: 101 }, (_, i) => ({ ...rule, staffId: String(i) })),
    }).success,
    false,
  );
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
