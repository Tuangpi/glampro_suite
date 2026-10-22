import assert from "node:assert/strict";
import { it } from "node:test";
import { createTreatmentRecordSchema, updateTreatmentRecordSchema } from "./customer.js";

it("supports optional POS evidence and explicit clearing without writable holding IDs", () => {
  const input = {
    customerId: "customer",
    treatmentType: "Facial",
    packageRedemptionId: "redemption",
  };
  assert.equal(createTreatmentRecordSchema.parse(input).packageRedemptionId, "redemption");
  assert.equal(updateTreatmentRecordSchema.parse({}).packageRedemptionId, undefined);
  assert.equal(
    updateTreatmentRecordSchema.parse({ packageRedemptionId: null }).packageRedemptionId,
    null,
  );
  assert.equal(updateTreatmentRecordSchema.safeParse({ packageRedemptionId: "" }).success, false);
  assert.equal(
    "packageHoldingId" in
      createTreatmentRecordSchema.parse({ ...input, packageHoldingId: "forged" }),
    false,
  );
  assert.equal("customerId" in updateTreatmentRecordSchema.parse({ customerId: "forged" }), false);
});
