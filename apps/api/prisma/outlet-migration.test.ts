import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL("./migrations/20261024090000_outlet_foundation/migration.sql", import.meta.url),
  "utf8",
);

describe("outlet foundation migration", () => {
  it("adds nullable outlet references without modifying family grouping or email uniqueness", () => {
    for (const table of ["customers", "packages", "sales"]) {
      assert.match(migration, new RegExp(`ALTER TABLE "${table}" ADD COLUMN\\s+"outletId" TEXT;`));
      assert.ok(migration.includes(`CREATE INDEX "${table}_tenantId_outletId_idx"`));
    }
    assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|DELETE)\b|"familyId"|"email"/im);
  });

  it("rejects cross-tenant outlet references and preserves referenced branches", () => {
    for (const table of ["customers", "packages", "sales"]) {
      assert.ok(
        migration.includes(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenantId_outletId_fkey" ` +
            'FOREIGN KEY ("tenantId", "outletId") REFERENCES "outlets"("tenantId", "id") ' +
            "ON DELETE RESTRICT ON UPDATE RESTRICT;",
        ),
      );
    }
  });

  it("scopes branch slugs to the tenant", () => {
    assert.ok(migration.includes('ON "outlets"("tenantId", "slug")'));
    assert.ok(migration.includes('ON "outlets"("tenantId", "id")'));
  });
});
