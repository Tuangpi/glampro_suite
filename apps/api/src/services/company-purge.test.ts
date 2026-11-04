import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";

const { TENANT_PURGE_ORDER } = await import("./company-purge.service.js");
const { TENANT_SCOPED_MODELS, TENANT_REFERENCE_MODELS } = await import("../lib/prisma.js");

const SCHEMA_PATH = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
const schema = readFileSync(SCHEMA_PATH, "utf8");

/**
 * The table a model maps to, read from the schema.
 *
 * Same reasoning as `prisma.test.ts`: the `prisma-client` generator exports no
 * DMMF, and `@@map` is what a developer edits when adding a model, so the schema
 * file is the right thing to assert against.
 */
function tableOf(model: string): string {
  const body = schema.match(new RegExp(`^model\\s+${model}\\s*\\{([^}]*)\\}`, "m"))?.[1] ?? "";
  return /@@map\("(\w+)"\)/.exec(body)?.[1] ?? model.toLowerCase();
}

describe("TENANT_PURGE_ORDER", () => {
  it("covers every tenant-scoped table, so no salon row survives a purge", () => {
    assert.deepEqual(
      [...TENANT_PURGE_ORDER].sort(),
      TENANT_SCOPED_MODELS.map(tableOf).sort(),
      "a tenant-scoped model is missing from TENANT_PURGE_ORDER — its rows would " +
        "survive a company purge. Add the table to company-purge.service.ts.",
    );
  });

  it("leaves reference tables alone so the purge stays auditable", () => {
    const purged = new Set<string>(TENANT_PURGE_ORDER);
    for (const model of TENANT_REFERENCE_MODELS) {
      assert.equal(
        purged.has(tableOf(model)),
        false,
        `${model} records actions *about* a tenant; deleting them would erase the ` +
          `evidence of the purge itself`,
      );
    }
  });

  it("names each table once", () => {
    assert.equal(
      new Set(TENANT_PURGE_ORDER).size,
      TENANT_PURGE_ORDER.length,
      "a duplicated table would be deleted twice and inflate the reported row count",
    );
  });
});
