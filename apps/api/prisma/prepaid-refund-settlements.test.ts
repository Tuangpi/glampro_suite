import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(
  new URL("./migrations/20261030120000_prepaid_refund_settlements/migration.sql", import.meta.url),
  "utf8",
);

test("prepaid refund migration creates atomic tenant-scoped append-only exact-money journal without backfill", () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(sql, /UNIQUE \("tenantId", "sourceKey"\)/);
  assert.match(sql, /UNIQUE \("tenantId", "itemType", "holdingId"\)/);
  assert.match(sql, /"grossCents" = "netCents" \+ "taxCents"/);
  assert.match(sql, /CHECK \(\("grossCents" = 0\) = \("payoutMethod" = 'NONE'\)\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE/);
  assert.match(sql, /RAISE EXCEPTION 'Prepaid refund settlements are append-only'/);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE\s+\w+\s+SET|DROP\s+TABLE|TRUNCATE/i);
});
