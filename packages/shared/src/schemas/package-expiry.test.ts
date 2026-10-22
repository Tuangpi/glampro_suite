import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPackageSchema,
  updatePackageSchema,
  updatePrepaidValiditySchema,
} from "./catalogue.js";

describe("package validity contracts", () => {
  const input = { name: "Facial", sessionCount: 5, memberPrice: 100, nonmemberPrice: 120 };

  it("preserves optional, explicitly cleared and configured session validity", () => {
    assert.equal(createPackageSchema.parse(input).validityDays, undefined);
    assert.equal(createPackageSchema.parse({ ...input, validityDays: null }).validityDays, null);
    assert.equal(createPackageSchema.parse({ ...input, validityDays: 365 }).validityDays, 365);
    assert.equal(updatePackageSchema.parse({}).validityDays, undefined);
    assert.equal(updatePackageSchema.parse({ validityDays: null }).validityDays, null);
  });

  it("requires an explicit prepaid validity setting and supports clearing it", () => {
    assert.equal(updatePrepaidValiditySchema.safeParse({}).success, false);
    assert.equal(updatePrepaidValiditySchema.parse({ validityDays: null }).validityDays, null);
    assert.equal(updatePrepaidValiditySchema.parse({ validityDays: 30 }).validityDays, 30);
  });

  it("rejects invalid types, fractional days and values outside the supported range", () => {
    for (const validityDays of [0, -1, 0.5, 36_501, "30", "", true]) {
      assert.equal(createPackageSchema.safeParse({ ...input, validityDays }).success, false);
      assert.equal(updatePackageSchema.safeParse({ validityDays }).success, false);
      assert.equal(updatePrepaidValiditySchema.safeParse({ validityDays }).success, false);
    }
  });
});
