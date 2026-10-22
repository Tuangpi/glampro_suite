import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  catalogueListQuerySchema,
  createGiftCardSchema,
  createPackageSchema,
  createProductSchema,
  createServiceSchema,
  giftCardSummarySchema,
  productSummarySchema,
  updatePackageSchema,
  updateProductSchema,
} from "./catalogue.js";

describe("catalogueListQuerySchema", () => {
  it("preserves and validates the family filter", () => {
    assert.equal(catalogueListQuerySchema.parse({ familyId: "family-1" }).familyId, "family-1");
    assert.equal(catalogueListQuerySchema.safeParse({ familyId: "" }).success, false);
  });
  it("coerces the lowStock flag from either boolean or query-string form", () => {
    assert.equal(catalogueListQuerySchema.parse({ lowStock: "true" }).lowStock, true);
    assert.equal(catalogueListQuerySchema.parse({ lowStock: true }).lowStock, true);
    assert.equal(catalogueListQuerySchema.parse({ lowStock: "false" }).lowStock, false);
  });

  it("leaves lowStock absent when not asked for, rather than defaulting to false", () => {
    // Defaulting to false would silently hide low stock from an unfiltered list.
    assert.equal(catalogueListQuerySchema.parse({}).lowStock, undefined);
  });

  it("rejects an unknown status rather than ignoring it", () => {
    assert.equal(catalogueListQuerySchema.safeParse({ status: "DISCONTINUED" }).success, false);
  });
});

describe("createProductSchema", () => {
  it("normalises barcode case without losing leading zeroes", () => {
    const input = { name: "Shampoo", memberPrice: 12, nonmemberPrice: 15 };
    assert.equal(createProductSchema.parse({ ...input, barcode: " 00abc " }).barcode, "00ABC");
    assert.equal(createProductSchema.parse({ ...input, barcode: " " }).barcode, null);
    assert.equal(createProductSchema.parse(input).barcode, undefined);
    assert.equal(
      createProductSchema.safeParse({ ...input, barcode: "x".repeat(65) }).success,
      false,
    );
  });

  it("distinguishes omitted barcodes from explicit clearing on update", () => {
    assert.equal(updateProductSchema.parse({}).barcode, undefined);
    assert.equal(updateProductSchema.parse({ barcode: null }).barcode, null);
    assert.equal(updateProductSchema.parse({ barcode: " " }).barcode, null);
    assert.equal(updateProductSchema.parse({ barcode: " abc " }).barcode, "ABC");
  });
  it("requires both prices, because a product cannot be rung up without them", () => {
    assert.equal(
      createProductSchema.safeParse({ name: "Shampoo", memberPrice: 12 }).success,
      false,
    );
    assert.equal(
      createProductSchema.safeParse({ name: "Shampoo", memberPrice: 12, nonmemberPrice: 15 })
        .success,
      true,
    );
  });

  it("refuses negative money and negative stock", () => {
    assert.equal(
      createProductSchema.safeParse({ name: "S", memberPrice: -1, nonmemberPrice: 5 }).success,
      false,
    );
    assert.equal(
      createProductSchema.safeParse({ name: "S", memberPrice: 1, nonmemberPrice: 5, quantity: -2 })
        .success,
      false,
    );
  });

  it("coerces numeric strings from a form", () => {
    const parsed = createProductSchema.parse({
      name: "S",
      memberPrice: "12.50",
      nonmemberPrice: "15",
    });
    assert.equal(parsed.memberPrice, 12.5);
  });
});

describe("createServiceSchema", () => {
  it("allows a missing duration, because legacy had no such column", () => {
    assert.equal(
      createServiceSchema.safeParse({ name: "Cut", memberPrice: 30, nonmemberPrice: 35 }).success,
      true,
    );
  });

  it("still refuses an absurd duration", () => {
    assert.equal(
      createServiceSchema.safeParse({
        name: "Cut",
        memberPrice: 30,
        nonmemberPrice: 35,
        durationMinutes: 2,
      }).success,
      false,
    );
  });
});

describe("productSummarySchema", () => {
  const row = {
    id: "p1",
    name: "Shampoo",
    status: "ACTIVE",
    memberPrice: "12.50",
    nonmemberPrice: "15.00",
    quantity: 3,
    points: 0,
    description: null,
    departmentId: null,
    departmentName: null,
    lowStock: true,
    barcode: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("carries prices as strings so a Decimal never becomes a lossy float", () => {
    assert.equal(typeof productSummarySchema.parse(row).memberPrice, "string");
    assert.equal(productSummarySchema.parse(row).lowStock, true);
  });

  it("rejects a numeric price, so the mistake fails at the boundary", () => {
    assert.equal(productSummarySchema.safeParse({ ...row, memberPrice: 12.5 }).success, false);
  });
});

describe("createPackageSchema", () => {
  it("requires at least one session, because a bundle that grants none is a price", () => {
    assert.equal(
      createPackageSchema.safeParse({
        name: "Starter",
        sessionCount: 0,
        memberPrice: 100,
        nonmemberPrice: 120,
      }).success,
      false,
    );

    assert.equal(
      createPackageSchema.safeParse({
        name: "Starter",
        sessionCount: 1,
        memberPrice: 100,
        nonmemberPrice: 120,
      }).success,
      true,
    );
  });

  it("coerces a session count typed into a form", () => {
    const parsed = createPackageSchema.parse({
      name: "Starter",
      sessionCount: "10",
      memberPrice: "250.00",
      nonmemberPrice: 300,
    });

    assert.equal(parsed.sessionCount, 10);
    assert.equal(parsed.memberPrice, 250);
  });
});

describe("updatePackageSchema", () => {
  it("distinguishes an absent family from assigning or clearing one", () => {
    assert.equal(updatePackageSchema.parse({}).familyId, undefined);
    assert.equal(updatePackageSchema.parse({ familyId: "family-1" }).familyId, "family-1");
    assert.equal(updatePackageSchema.parse({ familyId: null }).familyId, null);
    assert.equal(updatePackageSchema.safeParse({ familyId: "" }).success, false);
    assert.equal(
      createPackageSchema.parse({
        name: "Bundle",
        sessionCount: 1,
        memberPrice: 10,
        nonmemberPrice: 12,
        familyId: "family-1",
      }).familyId,
      "family-1",
    );
  });
  it("accepts an empty serviceIds as a value, distinct from omitting it", () => {
    // `[]` means "this bundle covers nothing now"; an absent key means "do not touch
    // the list". Both must parse, and they must stay distinguishable.
    assert.deepEqual(updatePackageSchema.parse({ serviceIds: [] }).serviceIds, []);
    assert.equal(updatePackageSchema.parse({}).serviceIds, undefined);
  });
});

describe("giftCardSummarySchema", () => {
  const row = {
    id: "g1",
    name: "Aloha Card",
    value: "100.00",
    expiresAt: null,
    remark: null,
    qrPayload: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("leaves expiresAt null rather than defaulting a date in", () => {
    // A card with no expiry is a real product, so the contract has to be able to say
    // so — a defaulted date would expire every migrated card (Q6).
    assert.equal(giftCardSummarySchema.parse(row).expiresAt, null);
  });

  it("rejects a numeric value, so a Decimal never arrives as a float", () => {
    assert.equal(giftCardSummarySchema.safeParse({ ...row, value: 100 }).success, false);
  });

  it("has no status field at all, because the model has no column behind it", () => {
    // Screen 08 draws a Status cell for this tab; the field must not exist, or the
    // screen would render an invented state (`PROJECT.md#design-6`).
    assert.equal("status" in giftCardSummarySchema.parse({ ...row, status: "ACTIVE" }), false);
  });
});

describe("createGiftCardSchema", () => {
  it("takes a date-only expiry and rejects a localised one", () => {
    assert.equal(
      createGiftCardSchema.safeParse({ name: "Card", value: 50, expiresAt: "2027-01-31" }).success,
      true,
    );
    assert.equal(
      createGiftCardSchema.safeParse({ name: "Card", value: 50, expiresAt: "31/01/2027" }).success,
      false,
    );
  });

  it("leaves the expiry optional, which is what never-expiring means", () => {
    assert.equal(createGiftCardSchema.safeParse({ name: "Card", value: 50 }).success, true);
  });
});
