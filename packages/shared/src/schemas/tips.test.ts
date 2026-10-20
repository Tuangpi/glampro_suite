import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordDirectTipSchema, returnDirectTipSchema } from "./tips.js";

describe("direct staff tip policy", () => {
  const input = {
    staffId: "staff",
    amount: 1.25,
    idempotencyKey: "d1fb35de-2048-4bdb-b39c-532737b86da4",
  };
  it("accepts positive cent-exact amounts and requires retry keys", () => {
    assert.equal(recordDirectTipSchema.safeParse(input).success, true);
    for (const amount of [0, -1, 0.001, 1.255, Infinity, NaN])
      assert.equal(recordDirectTipSchema.safeParse({ ...input, amount }).success, false);
    assert.equal(
      recordDirectTipSchema.safeParse({ ...input, idempotencyKey: "bad" }).success,
      false,
    );
  });
  it("does not accept salon payment, allocation or tax overrides", () => {
    for (const extra of [{ method: "CASH" }, { gstAmount: 0 }, { staffIds: ["other"] }])
      assert.equal(recordDirectTipSchema.safeParse({ ...input, ...extra }).success, false);
  });
  it("requires a meaningful bounded return reason", () => {
    assert.deepEqual(returnDirectTipSchema.parse({ reason: "  Returned directly  " }), {
      reason: "Returned directly",
    });
    for (const reason of ["", "ab", "x".repeat(501)])
      assert.equal(returnDirectTipSchema.safeParse({ reason }).success, false);
  });
});
