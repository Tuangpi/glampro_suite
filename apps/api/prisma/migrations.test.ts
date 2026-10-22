import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const renameMigration = readFileSync(
  new URL("./migrations/20261021082620_treatment_records_and_consent/migration.sql", import.meta.url),
  "utf8",
);
const createMigration = readFileSync(
  new URL("./migrations/20261021120000_treatment_records_and_consent/migration.sql", import.meta.url),
  "utf8",
);

describe("treatment consent migration replay", () => {
  it("allows the legacy index to be absent before treatment tables are created", () => {
    assert.match(
      renameMigration,
      /ALTER INDEX IF EXISTS "treatment_consent_events_treatmentRecordId_treatmentConsentForm" RENAME TO "treatment_consent_events_treatmentRecordId_treatmentConsent_key";/,
    );
  });

  it("creates the unique index with the same final name without PostgreSQL truncation", () => {
    const indexName = "treatment_consent_events_treatmentRecordId_treatmentConsent_key";
    assert.ok(Buffer.byteLength(indexName, "utf8") <= 63);
    assert.ok(
      createMigration.includes(
        `CREATE UNIQUE INDEX "${indexName}" ON "treatment_consent_events"("treatmentRecordId", "treatmentConsentFormId");`,
      ),
    );
  });
});