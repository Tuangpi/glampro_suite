import assert from "node:assert/strict";
import { test } from "node:test";
import { disposeTreatmentSchema } from "./customer.js";

test("disposal requires a bounded preview, reason and exact confirmation without spoofed authorization", () => {
  const input = {
    previewToken: "signed-preview",
    reason: " Retention no longer needed ",
    confirmation: "DISPOSE",
  };
  assert.equal(disposeTreatmentSchema.parse(input).reason, "Retention no longer needed");
  for (const patch of [
    { previewToken: "" },
    { previewToken: "x".repeat(4001) },
    { reason: " " },
    { reason: "x".repeat(501) },
    { confirmation: "dispose" },
    { confirmation: true },
    { confirmation: undefined },
    { actorId: "spoof" },
    { tenantId: "foreign" },
    { force: true },
  ])
    assert.equal(disposeTreatmentSchema.safeParse({ ...input, ...patch }).success, false);
});
