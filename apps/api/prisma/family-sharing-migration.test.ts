import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL("./migrations/20261022120000_family_sharing_fields/migration.sql", import.meta.url),
  "utf8",
);

describe("family-sharing migration", () => {
  it("adds nullable family identifiers to catalogue and customer tables", () => {
    for (const table of ["products", "packages", "customers"]) {
      assert.ok(migration.includes(`ALTER TABLE "${table}" ADD COLUMN "familyId" TEXT;`));
    }
  });

  it("adds the holding family identifier, audit actor and lookup index", () => {
    assert.match(
      migration,
      /ALTER TABLE "customer_value_package_holdings"\s+ADD COLUMN "familyId" TEXT,\s+ADD COLUMN "updatedBy" TEXT;/,
    );
    assert.match(
      migration,
      /CREATE INDEX "customer_value_package_holdings_familyId_idx"\s+ON "customer_value_package_holdings"\("familyId"\);/,
    );
  });

  it("applies the additions atomically without destructive statements", () => {
    assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE|NOT NULL)\b/i);
  });
});