import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

// Opt in only against the dedicated disposable database, never the application DB.
test(
  "outlet foundation against replayed PostgreSQL migrations",
  { skip: process.env.OUTLET_ACCEPTANCE !== "1" },
  async (t) => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55448");
    assert.equal(url.pathname, "/outlet_test");
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        INSERT INTO tenants (id, name, slug, "updatedAt") VALUES
          ('outlet-a', 'Outlet A', 'outlet-a', now()),
          ('outlet-b', 'Outlet B', 'outlet-b', now());
        INSERT INTO outlets (id, "tenantId", name, slug, "updatedAt") VALUES
          ('branch-a1', 'outlet-a', 'Central', 'central', now()),
          ('branch-a2', 'outlet-a', 'East', 'east', now()),
          ('branch-b1', 'outlet-b', 'Central', 'central', now());
      `);

      async function rejectsConstraint(sql: string, code: string) {
        await client.query("SAVEPOINT expected_rejection");
        try {
          await assert.rejects(client.query(sql), (error: unknown) => {
            assert.ok(error instanceof Error && "code" in error);
            assert.equal(error.code, code);
            return true;
          });
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT expected_rejection");
          await client.query("RELEASE SAVEPOINT expected_rejection");
        }
      }

      await t.test(
        "product availability has tenant-bound references and restricted deletion",
        async () => {
          await client.query(
            `INSERT INTO products (id, "tenantId", name, "memberPrice", "nonmemberPrice", "outletId", "updatedAt") VALUES ('outlet-product', 'outlet-a', 'Product', 10, 10, 'branch-a1', now())`,
          );
          await rejectsConstraint(
            `UPDATE products SET "outletId" = 'branch-b1' WHERE id = 'outlet-product'`,
            "23503",
          );
          await rejectsConstraint(`DELETE FROM outlets WHERE id = 'branch-a1'`, "23001");
          await client.query(`UPDATE products SET "outletId" = null WHERE id = 'outlet-product'`);
        },
      );

      await t.test("allows the same slug across tenants, but not within a tenant", async () => {
        await rejectsConstraint(
          `INSERT INTO outlets (id, "tenantId", name, slug, "updatedAt")
           VALUES ('duplicate', 'outlet-a', 'Duplicate', 'central', now())`,
          "23505",
        );
      });

      await t.test(
        "keeps tenant-wide and outlet-specific customers, packages and sales",
        async () => {
          for (const [suffix, outletId] of [
            ["global", null],
            ["a1", "branch-a1"],
            ["a2", "branch-a2"],
          ]) {
            await client.query(
              `INSERT INTO customers (id, "tenantId", name, "familyId", "outletId", "updatedAt")
             VALUES ($1, 'outlet-a', 'Customer', 'shared-family', $2, now())`,
              [`customer-${suffix}`, outletId],
            );
            await client.query(
              `INSERT INTO packages (id, "tenantId", name, "memberPrice", "nonmemberPrice",
               "familyId", "outletId", "updatedAt")
             VALUES ($1, 'outlet-a', 'Package', 10, 10, 'shared-family', $2, now())`,
              [`package-${suffix}`, outletId],
            );
            await client.query(
              `INSERT INTO sales (id, "tenantId", "totalQuantity", "totalAmount", "paidAmount",
               "soldAt", "outletId", "updatedAt")
             VALUES ($1, 'outlet-a', 0, 0, 0, now(), $2, now())`,
              [`sale-${suffix}`, outletId],
            );
          }
          for (const table of ["customers", "packages"]) {
            const result = await client.query(
              `SELECT "familyId", "outletId" FROM "${table}" WHERE "tenantId" = 'outlet-a'`,
            );
            assert.equal(result.rowCount, 3);
            assert.deepEqual(
              new Set(result.rows.map((row) => row.familyId)),
              new Set(["shared-family"]),
            );
            assert.deepEqual(
              new Set(result.rows.map((row) => row.outletId)),
              new Set([null, "branch-a1", "branch-a2"]),
            );
          }
        },
      );

      await t.test(
        "rejects cross-tenant and nonexistent outlet links on all three models",
        async () => {
          for (const table of ["customers", "packages", "sales"]) {
            for (const outletId of ["branch-b1", "missing-branch"]) {
              await rejectsConstraint(
                `UPDATE "${table}" SET "outletId" = '${outletId}' WHERE "tenantId" = 'outlet-a'`,
                "23503",
              );
            }
          }
        },
      );

      await t.test("protects referenced outlets from deletion or tenant reassignment", async () => {
        await rejectsConstraint(`DELETE FROM outlets WHERE id = 'branch-a1'`, "23001");
        await rejectsConstraint(
          `UPDATE outlets SET "tenantId" = 'outlet-b' WHERE id = 'branch-a2'`,
          "23001",
        );
      });

      await t.test("preserves tenant-wide email uniqueness across outlets", async () => {
        await client.query(
          `UPDATE customers SET email = 'shared@example.test' WHERE id = 'customer-a1'`,
        );
        await rejectsConstraint(
          `UPDATE customers SET email = 'shared@example.test' WHERE id = 'customer-a2'`,
          "23505",
        );
      });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }

    await t.test("scopes Prisma outlet reads and writes to the active tenant", async () => {
      const { prisma } = await import("../src/lib/prisma.js");
      const { runAsTenant, runAsPlatform } = await import("../src/lib/tenant-context.js");
      const tenantIds: string[] = [];
      try {
        for (const name of ["A", "B"]) {
          const tenant = await prisma.tenant.create({
            data: { name, slug: `outlet-acceptance-${randomUUID()}` },
          });
          tenantIds.push(tenant.id);
        }
        const a = tenantIds[0]!;
        const b = tenantIds[1]!;
        const branch = await runAsTenant(a, () =>
          prisma.outlet.create({ data: { tenantId: b, name: "Central", slug: "central" } }),
        );
        assert.equal(branch.tenantId, a);
        assert.equal(await runAsTenant(a, () => prisma.outlet.count()), 1);
        assert.equal(await runAsTenant(b, () => prisma.outlet.count()), 0);
        assert.equal(
          await runAsTenant(b, () => prisma.outlet.findUnique({ where: { id: branch.id } })),
          null,
        );
        await assert.rejects(
          runAsTenant(b, () =>
            prisma.outlet.update({ where: { id: branch.id }, data: { name: "Foreign" } }),
          ),
          { code: "P2025" },
        );
        await assert.rejects(prisma.outlet.findMany(), /No tenant scope/);
      } finally {
        await runAsPlatform(() =>
          prisma.outlet.deleteMany({ where: { tenantId: { in: tenantIds } } }),
        );
        await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
        await prisma.$disconnect();
      }
    });
  },
);
