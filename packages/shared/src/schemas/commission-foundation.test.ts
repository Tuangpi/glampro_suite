import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commissionKindSchema,
  commissionEventSchema,
  publishCommissionRuleSchema,
} from "./commission.js";

test("administration allows foundation kinds but never accepts earnings activation", () => {
  for (const kind of [
    "SERVICE",
    "PRODUCT",
    "PACKAGE_SALE",
    "PACKAGE_REDEMPTION",
    "FOC",
    "STORED_CREDIT_SALE",
    "STORED_CREDIT_SPEND",
  ])
    assert.equal(commissionKindSchema.parse(kind), kind);
  assert.equal(
    publishCommissionRuleSchema.safeParse({
      itemKind: "PACKAGE_SALE",
      scope: "COMPANY",
      rate: 5,
      reason: "test",
      expectedRevision: null,
      activateEarnings: true,
    }).success,
    false,
  );
});
test("snapshot contract keeps exact cents and bounded percentage/split", () => {
  assert.equal(commissionEventSchema.shape.basis.safeParse("0.01").success, true);
  assert.equal(commissionEventSchema.shape.basis.safeParse("0.001").success, false);
  assert.equal(commissionEventSchema.shape.rate.safeParse("100.01").success, false);
  assert.equal(commissionEventSchema.shape.share.safeParse(0).success, false);
});
