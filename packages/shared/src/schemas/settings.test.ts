import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  gstRegistrationNumberSchema,
  salonLocaleSchema,
  salonProfileSchema,
  salonTimeZoneSchema,
  updateSalonProfileSchema,
  updateSalonSecuritySchema,
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
    // Expiry is the platform console's verdict, exactly like `status`.
    assert.equal(
      updateSalonProfileSchema.safeParse({
        name: "Salon",
        lowStockThreshold: 5,
        subscriptionEndsAt: "2099-01-01T00:00:00.000Z",
      }).success,
      false,
    );
  });
});

describe("salon profile contract", () => {
  const profile = {
    id: "tenant-1",
    name: "Salon",
    slug: "salon",
    status: "ACTIVE",
    lowStockThreshold: 5,
    timeZone: "Asia/Singapore",
    locale: "en-SG",
    gstEnabled: false,
    gstRegistrationNumber: null,
    onlineBookingEnabled: false,
    onlineDepositAmount: 0,
    onlineNoShowFee: 0,
    requireStaffTwoFactor: false,
    owner: null,
    subscriptionEndsAt: "2027-03-31T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("carries the subscription expiry as an instant, or null when there is no plan", () => {
    assert.equal(salonProfileSchema.parse(profile).subscriptionEndsAt, "2027-03-31T00:00:00.000Z");
    assert.equal(
      salonProfileSchema.parse({ ...profile, subscriptionEndsAt: null }).subscriptionEndsAt,
      null,
    );
  });

  it("requires the expiry, so a screen cannot silently render a blank date", () => {
    const withoutExpiry: Record<string, unknown> = { ...profile };
    delete withoutExpiry.subscriptionEndsAt;
    assert.equal(salonProfileSchema.safeParse(withoutExpiry).success, false);
  });

  it("reports the salon's staff second-factor policy alongside the profile", () => {
    assert.equal(salonProfileSchema.parse(profile).requireStaffTwoFactor, false);
    assert.equal(
      salonProfileSchema.parse({ ...profile, requireStaffTwoFactor: true }).requireStaffTwoFactor,
      true,
    );
  });
});

describe("salon security policy contract", () => {
  it("accepts an explicit yes or no", () => {
    assert.deepEqual(updateSalonSecuritySchema.parse({ requireStaffTwoFactor: true }), {
      requireStaffTwoFactor: true,
    });
    assert.deepEqual(updateSalonSecuritySchema.parse({ requireStaffTwoFactor: false }), {
      requireStaffTwoFactor: false,
    });
  });

  it("refuses a missing or non-boolean value rather than defaulting the policy", () => {
    for (const body of [{}, { requireStaffTwoFactor: "yes" }, { requireStaffTwoFactor: null }]) {
      assert.equal(updateSalonSecuritySchema.safeParse(body).success, false, JSON.stringify(body));
    }
  });

  it("refuses fields the policy screen does not own", () => {
    assert.equal(
      updateSalonSecuritySchema.safeParse({ requireStaffTwoFactor: true, status: "SUSPENDED" })
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
