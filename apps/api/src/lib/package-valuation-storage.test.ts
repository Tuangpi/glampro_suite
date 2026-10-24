import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";

import { prisma } from "./prisma.js";
import { runAsPlatform, runAsTenant } from "./tenant-context.js";

// Explicit opt-in: never allow dotenv's application URL to start fixture writes.
const enabled = process.env["PACKAGE_VALUATION_STORAGE_TEST"] === "1";
const url = process.env["DATABASE_URL"];
const tenantA = `valuation-storage-a-${randomUUID()}`;
const tenantB = `valuation-storage-b-${randomUUID()}`;
const activationA = randomUUID();
const activationB = randomUUID();
const snapshotA = randomUUID();
const activatedAt = new Date("2026-10-24T00:00:00Z");
let pool: pg.Pool;

async function snapshot(overrides: Record<string, unknown> = {}) {
  return runAsTenant(tenantA, () =>
    prisma.packagePurchaseSnapshot.create({
      data: {
        tenantId: tenantA,
        activationId: activationA,
        policyVersion: 1,
        currency: "SGD",
        holdingId: randomUUID(),
        saleId: randomUUID(),
        saleLineId: randomUUID(),
        originalCustomerId: randomUUID(),
        grantedSessions: 3,
        netCents: 10000n,
        taxCents: 900n,
        grossCents: 10900n,
        purchasedAt: new Date("2026-10-23T00:00:00Z"),
        recordedAt: new Date("2026-10-24T01:00:00Z"),
        actorId: "fixture-actor",
        ...overrides,
      },
    }),
  );
}

describe("package valuation immutable storage", { skip: !enabled }, () => {
  before(async () => {
    assert.ok(url, "Explicit disposable DATABASE_URL is required.");
    pool = new pg.Pool({ connectionString: url });
    await runAsPlatform(async () => {
      for (const id of [tenantA, tenantB]) {
        await prisma.tenant.create({ data: { id, name: id, slug: id } });
      }
    });
    for (const [tenantId, id] of [
      [tenantA, activationA],
      [tenantB, activationB],
    ] as const) {
      await runAsTenant(tenantId, () =>
        prisma.packageValuationActivation.create({
          data: {
            id,
            tenantId,
            policyVersion: 1,
            currency: "SGD",
            actorId: "fixture-actor",
            reason: "Disposable storage test",
            activatedAt,
          },
        }),
      );
    }
    await snapshot({
      id: snapshotA,
      holdingId: "deleted-source-holding",
      saleLineId: "deleted-source-line",
    });
  });

  after(async () => {
    await runAsPlatform(() =>
      prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } }),
    );
    for (const table of ["package_purchase_snapshots", "package_valuation_activations"]) {
      const result = await pool.query(
        `SELECT count(*)::int AS count FROM ${table} WHERE "tenantId" = ANY($1::text[])`,
        [[tenantA, tenantB]],
      );
      assert.equal(result.rows[0].count, 0, "Only tenant deletion may cascade evidence.");
    }
    await pool.end();
    await prisma.$disconnect();
  });

  it("stores original ids without requiring surviving source rows or guessing a backfill", async () => {
    const row = await runAsTenant(tenantA, () =>
      prisma.packagePurchaseSnapshot.findUniqueOrThrow({ where: { id: snapshotA } }),
    );
    assert.equal(row.holdingId, "deleted-source-holding");
    assert.equal(row.saleLineId, "deleted-source-line");
    assert.equal(row.netCents, 10000n);
    assert.equal(row.grossCents, row.netCents + row.taxCents);
    assert.ok(
      row.purchasedAt < activatedAt,
      "Original operational sale date is not the recording boundary.",
    );
    assert.equal(await runAsTenant(tenantB, () => prisma.packagePurchaseSnapshot.count()), 0);
  });

  it("scopes both models and refuses cross-tenant activation references", async () => {
    assert.equal(
      await runAsTenant(tenantB, () =>
        prisma.packagePurchaseSnapshot.findUnique({ where: { id: snapshotA } }),
      ),
      null,
    );
    assert.equal(
      await runAsTenant(tenantB, () =>
        prisma.packageValuationActivation.findUnique({ where: { id: activationA } }),
      ),
      null,
    );
    await assert.rejects(() => snapshot({ activationId: activationB }));
    await assert.rejects(async () => prisma.packagePurchaseSnapshot.findMany(), /No tenant scope/);
    await assert.rejects(
      async () => prisma.packageValuationActivation.findMany(),
      /No tenant scope/,
    );
  });

  it("enforces purchase source uniqueness for retries", async () => {
    await assert.rejects(() => snapshot({ holdingId: "deleted-source-holding" }));
    await assert.rejects(() => snapshot({ saleLineId: "deleted-source-line" }));
    await assert.rejects(() =>
      runAsTenant(tenantA, () =>
        prisma.packageValuationActivation.create({
          data: {
            tenantId: tenantA,
            policyVersion: 1,
            currency: "SGD",
            actorId: "fixture-actor",
            reason: "Duplicate activation",
          },
        }),
      ),
    );
  });

  it("checks nonnegative exact-cent components, quantities and activation provenance", async () => {
    for (const invalid of [
      { netCents: -1n, grossCents: 899n },
      { taxCents: -1n, grossCents: 9999n },
      { grossCents: 10901n },
      { grantedSessions: 0 },
      { currency: "USD" },
      { currency: "sgd" },
      { policyVersion: 2 },
      { recordedAt: new Date(+activatedAt - 1) },
      { actorId: " " },
      { holdingId: "" },
    ])
      await assert.rejects(() => snapshot(invalid));
    const zero = await snapshot({ netCents: 0n, taxCents: 0n, grossCents: 0n });
    assert.equal(zero.grossCents, 0n);
  });

  it("protects snapshots and activations from raw SQL edits/deletes while tenant exists", async () => {
    for (const [table, id] of [
      ["package_valuation_activations", activationA],
      ["package_purchase_snapshots", snapshotA],
    ]) {
      await assert.rejects(
        () => pool.query(`UPDATE ${table} SET currency = 'USD' WHERE id = $1`, [id]),
        /append-only/,
      );
      await assert.rejects(
        () => pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]),
        /append-only/,
      );
    }
  });

  it("rolls back evidence on transaction failure", async () => {
    const holdingId = randomUUID();
    await assert.rejects(
      () =>
        runAsTenant(tenantA, () =>
          prisma.$transaction(async (tx) => {
            const original = await tx.packagePurchaseSnapshot.findUniqueOrThrow({
              where: { id: snapshotA },
            });
            await tx.packagePurchaseSnapshot.create({
              data: { ...original, id: randomUUID(), holdingId, saleLineId: randomUUID() },
            });
            throw new Error("Forced valuation write failure");
          }),
        ),
      /Forced valuation write failure/,
    );
    assert.equal(
      await runAsTenant(tenantA, () =>
        prisma.packagePurchaseSnapshot.count({ where: { holdingId } }),
      ),
      0,
    );
  });
});
