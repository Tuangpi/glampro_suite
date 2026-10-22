import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createTreatmentRecordSchema,
  updateTreatmentRecordSchema,
  treatmentRedemptionQuerySchema,
  treatmentRedemptionOptionSchema,
} from "./customer.js";

it("requires a customer and valid pagination for treatment evidence", () => {
  assert.equal(treatmentRedemptionQuerySchema.safeParse({}).success, false);
  assert.equal(
    treatmentRedemptionQuerySchema.safeParse({ customerId: "customer", page: 0 }).success,
    false,
  );
  assert.equal(
    treatmentRedemptionQuerySchema.safeParse({ customerId: "customer", serviceId: "" }).success,
    false,
  );
  assert.equal(treatmentRedemptionQuerySchema.parse({ customerId: "customer", page: "2" }).page, 2);
});

it("requires positive whole-redemption evidence and a covered service", () => {
  const option = {
    id: "redemption",
    receiptNumber: null,
    usedAt: "2026-10-22T01:00:00Z",
    packageName: "Facial",
    quantity: 2,
    services: [{ id: "service", name: "Facial" }],
  };
  assert.equal(treatmentRedemptionOptionSchema.safeParse(option).success, true);
  assert.equal(
    treatmentRedemptionOptionSchema.safeParse({ ...option, services: [] }).success,
    false,
  );
  assert.equal(
    treatmentRedemptionOptionSchema.safeParse({ ...option, quantity: 0 }).success,
    false,
  );
});

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
