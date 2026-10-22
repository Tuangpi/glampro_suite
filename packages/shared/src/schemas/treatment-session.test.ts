import assert from "node:assert/strict";
import { it } from "node:test";
import { createTreatmentRecordSchema, updateTreatmentRecordSchema } from "./customer.js";

it("accepts UTC treatment instants and legacy dates, but not unzoned times", () => {
  for (const value of ["2026-10-22", "2026-10-22T01:30:00.000Z"]) {
    assert.equal(
      updateTreatmentRecordSchema.safeParse({ startedAt: value, endedAt: value }).success,
      true,
    );
    assert.equal(
      createTreatmentRecordSchema.safeParse({
        customerId: "customer",
        treatmentType: "Facial",
        startedAt: value,
      }).success,
      true,
    );
  }
  assert.equal(
    updateTreatmentRecordSchema.safeParse({ startedAt: "2026-10-22T09:30" }).success,
    false,
  );
});

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
