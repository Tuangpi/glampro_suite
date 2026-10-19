import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  gstRegistrationNumberSchema,
  salonLocaleSchema,
  salonTimeZoneSchema,
  updateSalonProfileSchema,
} from "./settings.js";

describe("salon localisation contracts", () => {
  it("accepts supported locales and named timezones, including DST zones", () => {
    for (const value of ["Asia/Singapore", "America/New_York", "Europe/London", "UTC"]) {
      assert.equal(salonTimeZoneSchema.parse(value), value);
    }
    for (const value of ["en-SG", "en-GB", "fr-FR"]) {
      assert.equal(salonLocaleSchema.parse(value), value);
    }
  });

  it("rejects empty, malformed, unsupported and offset-only preferences", () => {
    for (const value of ["", "Mars/Olympus", "+08:00", "-05:00", "a".repeat(101)]) {
      assert.equal(salonTimeZoneSchema.safeParse(value).success, false, value);
    }
    for (const value of ["", "en_SG", "zz-ZZ", "a".repeat(101)]) {
      assert.equal(salonLocaleSchema.safeParse(value).success, false, value);
    }
  });

  it("trims preferences and preserves older profile requests without injecting defaults", () => {
    const legacy = { name: "Salon", lowStockThreshold: 5 };
    assert.deepEqual(updateSalonProfileSchema.parse(legacy), legacy);
    assert.deepEqual(
      updateSalonProfileSchema.parse({
        ...legacy,
        timeZone: " Asia/Singapore ",
        locale: " en-SG ",
      }),
      { ...legacy, timeZone: "Asia/Singapore", locale: "en-SG" },
    );
  });

  it("retains the required existing fields and refuses platform-owned fields", () => {
    assert.equal(updateSalonProfileSchema.safeParse({ locale: "en-SG" }).success, false);
    assert.equal(
      updateSalonProfileSchema.safeParse({ name: "Salon", lowStockThreshold: 5, slug: "forged" })
        .success,
      false,
    );
  });
});

describe("GST contracts", () => {
  const profile = { name: "Salon", lowStockThreshold: 5 };

  it("trims a registration number and keeps the punctuation the registry prints", () => {
    assert.equal(gstRegistrationNumberSchema.parse("  M90312345X  "), "M90312345X");
    assert.equal(gstRegistrationNumberSchema.parse("200012345M"), "200012345M");
  });

  it("refuses blank, overlong and symbol-only numbers", () => {
    for (const value of ["", "   ", "a".repeat(51), "!!", "M90@123"]) {
      assert.equal(gstRegistrationNumberSchema.safeParse(value).success, false, value);
    }
  });

  it("carries the toggle and number, and still accepts older clients", () => {
    // An omitted pair leaves both stored values alone.
    assert.deepEqual(updateSalonProfileSchema.parse(profile), profile);
    assert.deepEqual(
      updateSalonProfileSchema.parse({
        ...profile,
        gstEnabled: true,
        gstRegistrationNumber: " M90312345X ",
      }),
      { ...profile, gstEnabled: true, gstRegistrationNumber: "M90312345X" },
    );
    // A toggle-only request is legal: the service knows whether a number is stored.
    assert.equal(
      updateSalonProfileSchema.safeParse({ ...profile, gstEnabled: true }).success,
      true,
    );
  });

  it("refuses clearing the number while switching GST on in the same request", () => {
    assert.equal(
      updateSalonProfileSchema.safeParse({
        ...profile,
        gstEnabled: true,
        gstRegistrationNumber: null,
      }).success,
      false,
    );
    // Clearing is fine while the toggle is off, which is how a salon stops charging it.
    assert.equal(
      updateSalonProfileSchema.safeParse({
        ...profile,
        gstEnabled: false,
        gstRegistrationNumber: null,
      }).success,
      true,
    );
  });
});
