import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createTreatmentConsentEventSchema,
  treatmentConsentEventSchema,
  treatmentConsentFormListQuerySchema,
  treatmentConsentTypeParamsSchema,
  treatmentRecordSchema,
} from "./customer.js";

it("validates consent type params and strict form filters", () => {
  assert.deepEqual(treatmentConsentTypeParamsSchema.parse({ treatmentType: " laser " }), {
    treatmentType: "laser",
  });
  assert.equal(treatmentConsentTypeParamsSchema.safeParse({ id: "laser" }).success, false);
  for (const isActive of ["yes", ["true", "false"], true]) {
    assert.equal(treatmentConsentFormListQuerySchema.safeParse({ isActive }).success, false);
  }
  assert.equal(treatmentConsentFormListQuerySchema.parse({ isActive: "false" }).isActive, false);
  assert.equal(treatmentConsentFormListQuerySchema.parse({ isActive: "true" }).isActive, true);
  assert.equal(treatmentConsentFormListQuerySchema.parse({}).isActive, undefined);
  assert.equal(
    treatmentConsentFormListQuerySchema.safeParse({ treatmentType: ["laser"] }).success,
    false,
  );
});

it("does not require or trust a submitted witness and refuses unsupported signatures", () => {
  const input = {
    treatmentRecordId: "record",
    treatmentConsentFormId: "form",
    customerId: "customer",
    consented: false,
  };
  assert.equal(createTreatmentConsentEventSchema.parse(input).consented, false);
  assert.equal(
    "consentedById" in
      createTreatmentConsentEventSchema.parse({ ...input, consentedById: "spoof" }),
    false,
  );
  assert.equal(
    createTreatmentConsentEventSchema.safeParse({ ...input, signatureData: "image" }).success,
    false,
  );
  assert.equal(
    createTreatmentConsentEventSchema.safeParse({ ...input, signatureData: null }).success,
    true,
  );
});

it("preserves original consent form evidence and detail event history", () => {
  const now = "2026-10-22T00:00:00.000Z";
  const form = {
    id: "form",
    tenantId: "tenant",
    treatmentType: "laser",
    title: "Original",
    content: "Original text",
    version: 1,
    isActive: false,
    createdAt: now,
    updatedAt: now,
  };
  const event = {
    id: "event",
    tenantId: "tenant",
    treatmentRecordId: "record",
    treatmentConsentFormId: "form",
    customerId: "customer",
    consented: false,
    consentedAt: now,
    consentedById: "staff",
    signatureData: null,
    createdAt: now,
    treatmentConsentForm: form,
  };
  assert.deepEqual(treatmentConsentEventSchema.parse(event).treatmentConsentForm, form);
  const record = {
    id: "record",
    tenantId: "tenant",
    customerId: "customer",
    appointmentId: null,
    staffId: null,
    serviceId: null,
    treatmentType: "laser",
    status: "SCHEDULED",
    notes: null,
    startedAt: null,
    endedAt: null,
    quantityConsumed: 0,
    createdAt: now,
    updatedAt: now,
    consentEvents: [event],
  };
  assert.deepEqual(treatmentRecordSchema.parse(record).consentEvents, [event]);
});
