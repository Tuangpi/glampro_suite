import assert from "node:assert/strict";
import { test } from "node:test";
import { createTreatmentConsentEventSchema, treatmentSignatureSchema } from "./customer.js";

test("drawn signature evidence is bounded structured coordinates, not markup or images", () => {
  const valid = {
    strokes: [
      [
        { x: 1, y: 2 },
        { x: 25, y: 20 },
      ],
    ],
  };
  assert.equal(treatmentSignatureSchema.safeParse(valid).success, true);
  for (const invalid of [
    { strokes: [] },
    {
      strokes: [
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
      ],
    },
    {
      strokes: [
        [
          { x: -1, y: 2 },
          { x: 25, y: 20 },
        ],
      ],
    },
    {
      strokes: [
        [
          { x: 1, y: 201 },
          { x: 25, y: 20 },
        ],
      ],
    },
    { strokes: Array(31).fill(valid.strokes[0]) },
    { strokes: [Array(501).fill({ x: 1, y: 2 })] },
    { ...valid, html: "<script>" },
  ])
    assert.equal(treatmentSignatureSchema.safeParse(invalid).success, false);
  const input = {
    treatmentRecordId: "r",
    treatmentConsentFormId: "f",
    customerId: "c",
    consented: true,
  };
  assert.equal(
    createTreatmentConsentEventSchema.safeParse({ ...input, signatureData: JSON.stringify(valid) })
      .success,
    true,
  );
  for (const signatureData of [
    "<svg/>",
    "data:image/png;base64,abc",
    "{",
    JSON.stringify({ strokes: [] }),
  ])
    assert.equal(
      createTreatmentConsentEventSchema.safeParse({ ...input, signatureData }).success,
      false,
    );
});
