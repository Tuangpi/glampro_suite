import assert from "node:assert/strict";
import { test } from "node:test";
import { publishCommissionRuleSchema } from "./commission.js";
const base = {
  scope: "COMPANY",
  itemKind: "SERVICE",
  rate: 10,
  expectedRevision: null,
  reason: "New policy",
};
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
