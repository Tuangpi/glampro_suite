import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archiveCustomerSchema,
  customerListQuerySchema,
  reviewTreatmentRetentionSchema,
} from "./customer.js";

test("retention reviews require a date, reason and explicit documented hold state", () => {
  const input = {
    reviewAt: "2027-01-22T00:00:00.000Z",
    reason: " Clinical follow-up ",
    hold: true,
    holdReason: " Pending dispute ",
  };
  assert.deepEqual(reviewTreatmentRetentionSchema.parse(input), {
    ...input,
    reason: "Clinical follow-up",
    holdReason: "Pending dispute",
  });
  for (const patch of [
    { reviewAt: "tomorrow" },
    { reason: " " },
    { holdReason: null },
    { holdReason: " " },
    { hold: undefined },
    { reviewedById: "spoof" },
    { tenantId: "foreign" },
    { dispose: true },
  ])
    assert.equal(reviewTreatmentRetentionSchema.safeParse({ ...input, ...patch }).success, false);
  assert.equal(
    reviewTreatmentRetentionSchema.safeParse({ ...input, hold: false, holdReason: null }).success,
    true,
  );
});

test("archival requires a reason and archived-list inclusion is explicit", () => {
  assert.deepEqual(archiveCustomerSchema.parse({ reason: " No further visits " }), {
    reason: "No further visits",
  });
  assert.equal(archiveCustomerSchema.safeParse({ reason: " " }).success, false);
  assert.equal(
    archiveCustomerSchema.safeParse({ reason: "Review", archivedById: "spoof" }).success,
    false,
  );
  assert.equal(customerListQuerySchema.parse({}).includeArchived, undefined);
  assert.equal(customerListQuerySchema.parse({ includeArchived: "false" }).includeArchived, false);
  assert.equal(customerListQuerySchema.parse({ includeArchived: "true" }).includeArchived, true);
  for (const includeArchived of ["maybe", ["true", "false"], true]) {
    assert.equal(customerListQuerySchema.safeParse({ includeArchived }).success, false);
  }
});
