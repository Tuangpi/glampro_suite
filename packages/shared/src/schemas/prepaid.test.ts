import assert from "node:assert/strict";
import { test } from "node:test";
import { transferPrepaidSchema } from "./prepaid.js";

const valid = {
  targetCustomerId: "customer2",
  expectedUpdatedAt: "2026-10-23T01:00:00.000Z",
  reason: " Customer requested ",
  confirmed: true,
};
test("prepaid transfers require confirmation, bounded reason and a version; reject caller actors/tenants/amounts", () => {
  assert.equal(transferPrepaidSchema.parse(valid).reason, "Customer requested");
  for (const fields of [
    { confirmed: false },
    { reason: " " },
    { reason: "x".repeat(2001) },
    { expectedUpdatedAt: "yesterday" },
    { targetCustomerId: "" },
    { tenantId: "foreign" },
    { actorId: "forged" },
    { amount: 1 },
  ]) {
    assert.equal(transferPrepaidSchema.safeParse({ ...valid, ...fields }).success, false);
  }
});
