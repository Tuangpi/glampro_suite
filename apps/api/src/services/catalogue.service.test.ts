/**
 * The catalogue service, against the real database.
 *
 * Three things here can only be shown against a real database and real scoping:
 * that a salon sees only its own products and services, that a branch id from
 * another salon is refused rather than linked, and that "low stock" is decided by
 * **the calling tenant's own threshold** — the same `quantity: 10` is low in one
 * salon and healthy in the other, which is the whole point of ADR 0010 and the one
 * assertion a mocked Prisma could not make.
 *
 * Skipped with a clear message when `DATABASE_URL` is absent, so `npm run verify`
 * still passes on a machine with no database running.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { HttpError } from "../lib/http-error.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { prisma } from "../lib/prisma.js";
import {
  createProduct,
  createService,
  getProduct,
  getService,
  listProducts,
  listServices,
  updateProduct,
  updateService,
} from "./catalogue.service.js";
import { listDepartments } from "./department.service.js";

const databaseUrl = process.env["DATABASE_URL"];

const TENANT_A = "catalogue-test-a";
const TENANT_B = "catalogue-test-b";

/**
 * A stock level that is **healthy** in A (threshold 5) and **low** in B
 * (threshold 20). Every low-stock assertion below turns on this one number.
 */
const MID_STOCK = 10;

/** No filters — the list contract makes every one of them optional. */
const NO_FILTERS = {
  page: 1,
  pageSize: 20,
  search: undefined,
  status: undefined,
  departmentId: undefined,
  lowStock: undefined,
  threshold: undefined,
} as const;

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    const ids = [TENANT_A, TENANT_B];
    await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.department.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@catalogue.test" } } });
  });
}

async function seed(): Promise<void> {
  await purge();

  await runAsPlatform(async () => {
    // A holds little stock and B holds a lot, which is the difference the
    // threshold has to honour.
    const thresholds: Record<string, number> = { [TENANT_A]: 5, [TENANT_B]: 20 };

    for (const id of [TENANT_A, TENANT_B]) {
      await prisma.tenant.create({
        data: {
          id,
          name: `Salon ${id}`,
          slug: `salon-${id}`,
          lowStockThreshold: thresholds[id],
        },
      });

      const owner = await prisma.user.create({
        data: {
          tenantId: id,
          email: `owner-${id}@catalogue.test`,
          name: `Owner ${id}`,
          passwordHash: "not-a-real-hash",
        },
      });
      await prisma.tenant.update({ where: { id }, data: { ownerUserId: owner.id } });

      const branch = await prisma.department.create({
        data: { tenantId: id, name: `Branch ${id}` },
      });

      // Three products per tenant, so ordering, paging and each filter have
      // something to work with. `Charlie Serum` is deliberately unassigned and
      // the one genuinely low row in A.
      for (const [name, quantity, description] of [
        [`Aloha Shampoo ${id}`, MID_STOCK, "Gentle daily shampoo"],
        [`Bahar Towel ${id}`, 40, "Bleached cotton"],
        [`Charlie Serum ${id}`, 2, "Leave-in treatment"],
      ] as const) {
        await prisma.product.create({
          data: {
            tenantId: id,
            name,
            memberPrice: "12.50",
            nonmemberPrice: "15.00",
            quantity,
            description,
            // Only the first product is shelved in a branch.
            departmentId: name.startsWith("Aloha") ? branch.id : null,
          },
        });
      }

      // `Bahar Towel` is withdrawn, so a status filter has something to hide.
      await prisma.product.updateMany({
        where: { tenantId: id, name: `Bahar Towel ${id}` },
        data: { status: "INACTIVE" },
      });

      await prisma.service.create({
        data: {
          tenantId: id,
          name: `Aloha Cut ${id}`,
          memberPrice: "30.00",
          nonmemberPrice: "35.00",
          durationMinutes: 45,
          departmentId: branch.id,
        },
      });
      // No duration: legacy had no such column, and booking — not this form — is
      // where that becomes a blocking question.
      await prisma.service.create({
        data: {
          tenantId: id,
          name: `Bahar Colour ${id}`,
          memberPrice: "90.00",
          nonmemberPrice: "110.00",
        },
      });
    }
  });
}

/** A branch id read unscoped, so the test can hand tenant A a tenant B branch. */
function branchOf(tenantId: string): Promise<string> {
  return runAsPlatform(async () => {
    const department = await prisma.department.findFirstOrThrow({
      where: { tenantId },
      select: { id: true },
    });
    return department.id;
  });
}

/** A product id read unscoped, for the cross-tenant read and write attempts. */
function productIdOf(tenantId: string, name: string): Promise<string> {
  return runAsPlatform(async () => {
    const product = await prisma.product.findFirstOrThrow({
      where: { tenantId, name: `Aloha ${name} ${tenantId}` },
      select: { id: true },
    });
    return product.id;
  });
}

describe(
  "catalogue.service, against the database",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    before(seed);
    after(purge);

    describe("products", () => {
      it("lists only the calling tenant's products, ordered by name", async () => {
        const page = await runAsTenant(TENANT_A, () => listProducts(NO_FILTERS));

        assert.equal(page.total, 3);
        assert.deepEqual(
          page.data.map((row) => row.name),
          [`Aloha Shampoo ${TENANT_A}`, `Bahar Towel ${TENANT_A}`, `Charlie Serum ${TENANT_A}`],
        );
      });

      it("paginates without losing or repeating rows", async () => {
        const first = await runAsTenant(TENANT_A, () =>
          listProducts({ ...NO_FILTERS, pageSize: 1 }),
        );
        const second = await runAsTenant(TENANT_A, () =>
          listProducts({ ...NO_FILTERS, page: 2, pageSize: 1 }),
        );

        assert.equal(first.pageCount, 3);
        assert.equal(first.data.length, 1);
        assert.notEqual(first.data[0]?.id, second.data[0]?.id);
      });

      it("searches name and description, case-insensitively", async () => {
        const byName = await runAsTenant(TENANT_A, () =>
          listProducts({ ...NO_FILTERS, search: "shampoo" }),
        );
        const byDescription = await runAsTenant(TENANT_A, () =>
          listProducts({ ...NO_FILTERS, search: "cotton" }),
        );

        assert.equal(byName.total, 1);
        assert.equal(byName.data[0]?.name, `Aloha Shampoo ${TENANT_A}`);
        assert.equal(byDescription.total, 1);
        assert.equal(byDescription.data[0]?.name, `Bahar Towel ${TENANT_A}`);
      });

      it("filters by status and by branch", async () => {
        const active = await runAsTenant(TENANT_A, () =>
          listProducts({ ...NO_FILTERS, status: "ACTIVE" }),
        );

        assert.deepEqual(
          active.data.map((row) => row.name),
          [`Aloha Shampoo ${TENANT_A}`, `Charlie Serum ${TENANT_A}`],
        );

        // An unassigned product is not in a branch filter's result, which is what
        // makes the branch column trustworthy.
        const branch = await branchOf(TENANT_A);
        const shelved = await runAsTenant(TENANT_A, () =>
          listProducts({ ...NO_FILTERS, departmentId: branch }),
        );
        assert.equal(shelved.total, 1);
        assert.equal(shelved.data[0]?.name, `Aloha Shampoo ${TENANT_A}`);
      });

      it("serialises money as a fixed-2 string and resolves the branch name", async () => {
        const page = await runAsTenant(TENANT_A, () =>
          listProducts({ ...NO_FILTERS, search: "Aloha Shampoo" }),
        );
        const row = page.data[0];

        assert.equal(typeof row?.memberPrice, "string");
        assert.equal(row?.memberPrice, "12.50", "a Decimal never becomes a lossy float");
        assert.equal(row?.nonmemberPrice, "15.00");
        assert.equal(row?.departmentName, `Branch ${TENANT_A}`);
      });

      it("decides low stock by the calling tenant's own threshold", async () => {
        // Identical stock, identical code path — only the tenant differs. This is
        // the assertion ADR 0010 exists for.
        const a = await runAsTenant(TENANT_A, () =>
          listProducts({ ...NO_FILTERS, search: "Aloha Shampoo" }),
        );
        const b = await runAsTenant(TENANT_B, () =>
          listProducts({ ...NO_FILTERS, search: "Aloha Shampoo" }),
        );

        assert.equal(a.data[0]?.quantity, MID_STOCK);
        assert.equal(b.data[0]?.quantity, MID_STOCK);
        assert.equal(a.data[0]?.lowStock, false, "10 is healthy where the threshold is 5");
        assert.equal(b.data[0]?.lowStock, true, "10 is low where the threshold is 20");
      });

      it("counts low stock over the whole catalogue, not over the page returned", async () => {
        const a = await runAsTenant(TENANT_A, () =>
          listProducts({ ...NO_FILTERS, lowStock: true }),
        );
        const b = await runAsTenant(TENANT_B, () =>
          listProducts({ ...NO_FILTERS, lowStock: true }),
        );

        // A: `Charlie Serum` alone (2 ≤ 5). B: that plus `Aloha Shampoo` (10 ≤ 20).
        assert.equal(a.total, 1);
        assert.deepEqual(
          a.data.map((row) => row.name),
          [`Charlie Serum ${TENANT_A}`],
        );
        assert.equal(b.total, 2);
      });

      it("filters on an explicit threshold but badges rows on the tenant's", async () => {
        const page = await runAsTenant(TENANT_A, () =>
          listProducts({ ...NO_FILTERS, lowStock: true, threshold: MID_STOCK }),
        );

        // "At or below" includes the boundary, so `Aloha Shampoo` at exactly 10 counts.
        assert.equal(page.total, 2);
        const shampoo = page.data.find((row) => row.name === `Aloha Shampoo ${TENANT_A}`);
        const serum = page.data.find((row) => row.name === `Charlie Serum ${TENANT_A}`);
        // The override widened the filter to two rows, but each row is still judged
        // against the salon's own threshold (5), so 10 units is not relabelled as low.
        assert.equal(shampoo?.lowStock, false, "the filter override must not change the badge");
        assert.equal(serum?.lowStock, true);
      });

      it("cannot read another tenant's product by id", async () => {
        const foreign = await productIdOf(TENANT_B, "Shampoo");

        await assert.rejects(
          runAsTenant(TENANT_A, () => getProduct(foreign)),
          /does not exist/,
          "a scoped read must find nothing rather than another salon's row",
        );
      });

      it("cannot update another tenant's product", async () => {
        const foreign = await productIdOf(TENANT_B, "Shampoo");

        await assert.rejects(
          runAsTenant(TENANT_A, () => updateProduct(foreign, { name: "Hijacked" })),
        );

        const unchanged = await runAsPlatform(() =>
          prisma.product.findUniqueOrThrow({ where: { id: foreign }, select: { name: true } }),
        );
        assert.notEqual(unchanged.name, "Hijacked");
      });
    });

    describe("product writes", () => {
      it("stamps the caller's tenant on create", async () => {
        // The service takes no tenantId at all, so the only way a row could land in
        // the wrong salon is the extension failing to overwrite the placeholder.
        const created = await runAsTenant(TENANT_A, () =>
          createProduct({ name: "Stamped A", memberPrice: 12.5, nonmemberPrice: 15 }),
        );

        const stored = await runAsPlatform(() =>
          prisma.product.findUniqueOrThrow({
            where: { id: created.id },
            select: { tenantId: true },
          }),
        );
        assert.equal(stored.tenantId, TENANT_A);
      });

      it("refuses another tenant's branch id rather than shelving in it", async () => {
        const foreignBranch = await branchOf(TENANT_B);

        // The message on a validation failure is deliberately generic; the field
        // detail is what the form reads, so that is what is asserted here.
        await assert.rejects(
          runAsTenant(TENANT_A, () =>
            createProduct({
              name: "Smuggled Branch",
              memberPrice: 1,
              nonmemberPrice: 2,
              departmentId: foreignBranch,
            }),
          ),
          (error: unknown) => {
            assert.ok(error instanceof HttpError);
            assert.equal(error.statusCode, 422);
            assert.equal(error.code, "VALIDATION_FAILED");
            assert.deepEqual(error.details, [
              { path: "body.departmentId", message: "That branch does not exist." },
            ]);
            return true;
          },
        );

        // Tenant B's own product legitimately sits in that branch, so the count is
        // scoped to A: what must be zero is a *smuggled* shelf.
        const shelved = await runAsPlatform(() =>
          prisma.product.count({ where: { departmentId: foreignBranch, tenantId: TENANT_A } }),
        );
        assert.equal(shelved, 0, "no product may be shelved in another tenant's branch");
      });

      it("defaults stock and points to zero, and calls a brand-new product low", async () => {
        const created = await runAsTenant(TENANT_A, () =>
          createProduct({ name: "Brand New", memberPrice: 9, nonmemberPrice: 9 }),
        );

        assert.equal(created.quantity, 0);
        assert.equal(created.points, 0);
        assert.equal(created.status, "ACTIVE");
        assert.equal(created.departmentId, null);
        assert.equal(created.memberPrice, "9.00");
        // Zero stock is at or below every threshold, so an unstocked product is
        // exactly the thing the badge is there to surface.
        assert.equal(created.lowStock, true);
      });

      it("leaves an absent field alone, clears an explicit null, and unassigns a branch", async () => {
        const branch = await branchOf(TENANT_A);
        const created = await runAsTenant(TENANT_A, () =>
          createProduct({
            name: "Partial",
            memberPrice: 3,
            nonmemberPrice: 4,
            description: "Keep me",
            departmentId: branch,
          }),
        );

        const renamed = await runAsTenant(TENANT_A, () =>
          updateProduct(created.id, { name: "Partial Renamed" }),
        );
        assert.equal(renamed.description, "Keep me", "an absent field must not be cleared");
        assert.equal(renamed.memberPrice, "3.00");
        assert.equal(renamed.departmentId, branch, "an absent branch must not be unassigned");

        const cleared = await runAsTenant(TENANT_A, () =>
          updateProduct(created.id, { description: null, departmentId: null }),
        );
        assert.equal(cleared.description, null, "an explicit null clears");
        assert.equal(cleared.departmentId, null, "an explicit null unassigns the branch");
      });

      it("reports a missing product rather than an empty record", async () => {
        await assert.rejects(
          runAsTenant(TENANT_A, () => getProduct("no-such-product")),
          /does not exist/,
        );
      });
    });

    describe("services", () => {
      it("lists only the calling tenant's services, ordered by name", async () => {
        const page = await runAsTenant(TENANT_A, () => listServices(NO_FILTERS));

        assert.equal(page.total, 2);
        assert.deepEqual(
          page.data.map((row) => row.name),
          [`Aloha Cut ${TENANT_A}`, `Bahar Colour ${TENANT_A}`],
        );
      });

      it("carries no stock at all, because a service is not stock", async () => {
        const page = await runAsTenant(TENANT_A, () => listServices(NO_FILTERS));

        for (const row of page.data) {
          assert.equal("quantity" in row, false);
          assert.equal("lowStock" in row, false);
        }
      });

      it("ignores ?lowStock rather than rejecting it, since the tabs share a query string", async () => {
        const page = await runAsTenant(TENANT_A, () =>
          listServices({ ...NO_FILTERS, lowStock: true }),
        );

        assert.equal(page.total, 2);
      });

      it("keeps a missing duration and accepts one on update", async () => {
        const page = await runAsTenant(TENANT_A, () =>
          listServices({ ...NO_FILTERS, search: "Bahar Colour" }),
        );
        const service = page.data[0];
        assert.ok(service, "the seeded service must be found");

        // Legacy had no duration column, so null is a real migrated state and must
        // survive a read rather than being defaulted to zero minutes.
        assert.equal(service.durationMinutes, null);

        const filled = await runAsTenant(TENANT_A, () =>
          updateService(service.id, { durationMinutes: 30 }),
        );
        assert.equal(filled.durationMinutes, 30);
      });

      it("cannot read another tenant's service by id", async () => {
        const foreign = await runAsPlatform(async () => {
          const service = await prisma.service.findFirstOrThrow({
            where: { tenantId: TENANT_B },
            select: { id: true },
          });
          return service.id;
        });

        await assert.rejects(
          runAsTenant(TENANT_A, () => getService(foreign)),
          /does not exist/,
        );
      });

      it("creates a service for the caller's tenant", async () => {
        const created = await runAsTenant(TENANT_A, () =>
          createService({ name: "Fresh Perm", memberPrice: 55, nonmemberPrice: 65 }),
        );

        assert.equal(created.memberPrice, "55.00");
        assert.equal(created.durationMinutes, null);
        assert.equal(created.status, "ACTIVE");
      });
    });

    describe("branches", () => {
      it("lists only the calling tenant's branches", async () => {
        const a = await runAsTenant(TENANT_A, () => listDepartments());
        const b = await runAsTenant(TENANT_B, () => listDepartments());

        assert.deepEqual(
          a.map((row) => row.name),
          [`Branch ${TENANT_A}`],
        );
        assert.deepEqual(
          b.map((row) => row.name),
          [`Branch ${TENANT_B}`],
        );
      });
    });
  },
);
