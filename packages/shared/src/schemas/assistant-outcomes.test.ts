import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assistantDelivery, assistantOutcomeSchema } from "./assistant-outcomes.js";

describe("assistant outcome contracts", () => {
  it("never treats queueing, acceptance, failure or uncertainty as delivery", () => {
    for (const state of [
      "PENDING",
      "RETRY",
      "ACCEPTED",
      "UNCERTAIN",
      "FAILED",
      "SUPPRESSED",
      "unknown",
    ])
      assert.equal(assistantDelivery(state), "not_confirmed");
    assert.equal(assistantDelivery(null), "not_queued");
    assert.equal(assistantDelivery("DELIVERED"), "provider_reported_delivered");
    assert.equal(assistantDelivery("READ"), "provider_reported_delivered");
  });
  it("rejects invented conversion fields in place of required observations", () => {
    assert.equal(
      assistantOutcomeSchema.safeParse({ conversions: 10, revenue: "100.00" }).success,
      false,
    );
  });
});
