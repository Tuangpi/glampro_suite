import assert from "node:assert/strict";
import { test } from "node:test";
import {
  companyLifecycleSchema,
  recordSubscriptionSchema,
  companyModuleSchema,
} from "./company-administration.js";

const period = {
  startDate: "2026-10-01T00:00:00Z",
  endDate: "2026-11-01T00:00:00Z",
  amount: "99.00",
  currency: "SGD",
  reason: "Manual renewal",
};
test("subscription contracts require ordered offset dates, exact decimal money and a reason", () => {
  assert.equal(recordSubscriptionSchema.safeParse(period).success, true);
  for (const change of [
    { amount: 99 },
    { amount: "1.001" },
    { amount: "-1.00" },
    { amount: "10000000000.00" },
    { currency: "sgd" },
    { reason: " " },
    { endDate: period.startDate },
    { startDate: "2026-10-01" },
    { tenantId: "other" },
  ]) {
    assert.equal(
      recordSubscriptionSchema.safeParse({ ...period, ...change }).success,
      false,
      JSON.stringify(change),
    );
  }
});
test("lifecycle contract allows only explicit supported actions and rejects mass assignment", () => {
  for (const action of ["suspend", "reactivate", "cancel"])
    assert.equal(
      companyLifecycleSchema.safeParse({ action, reason: "Operator review" }).success,
      true,
    );
  assert.equal(
    companyLifecycleSchema.safeParse({ action: "delete", reason: "Review" }).success,
    false,
  );
  assert.equal(
    companyLifecycleSchema.safeParse({ action: "cancel", reason: "Review", actorId: "other" })
      .success,
    false,
  );
});
test("module access requires boolean grants and an explicit nullable expiry", () => {
  assert.equal(
    companyModuleSchema.safeParse({
      code: "packages",
      enabled: true,
      expiresAt: null,
      reason: "Purchased add-on",
    }).success,
    true,
  );
  assert.equal(
    companyModuleSchema.safeParse({
      code: "packages",
      enabled: "false",
      expiresAt: null,
      reason: "Review",
    }).success,
    false,
  );
});
