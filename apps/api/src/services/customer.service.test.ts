/**
 * The customer service, against the real database.
 *
 * The unit suites cannot show what matters most here: that a salon only ever sees
 * its own book. Two tenants are seeded and every read path is asserted to return
 * the caller's rows only — including the two that are easy to get wrong, reaching
 * another tenant's customer by id and passing another tenant's branch id into
 * `departmentIds`.
 *
 * Skipped with a clear message when `DATABASE_URL` is absent, so `npm run verify`
 * still passes on a machine with no database running.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { HttpError } from "../lib/http-error.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { prisma } from "../lib/prisma.js";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "./customer.service.js";

const databaseUrl = process.env["DATABASE_URL"];

const TENANT_A = "customer-test-a";
const TENANT_B = "customer-test-b";

/** No filters — the list contract makes every one of them optional. */
const NO_FILTERS = { page: 1, pageSize: 20, search: undefined, memberId: undefined } as const;

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    const ids = [TENANT_A, TENANT_B];
    await prisma.customerDepartment.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.department.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@customer.test" } } });
  });
}

async function seed(): Promise<void> {
  await purge();

  await runAsPlatform(async () => {
    for (const id of [TENANT_A, TENANT_B]) {
      await prisma.tenant.create({ data: { id, name: `Salon ${id}`, slug: `salon-${id}` } });

      const owner = await prisma.user.create({
        data: {
          tenantId: id,
          email: `owner-${id}@customer.test`,
          name: `Owner ${id}`,
          passwordHash: "not-a-real-hash",
        },
      });
      await prisma.tenant.update({ where: { id }, data: { ownerUserId: owner.id } });

      await prisma.department.create({ data: { tenantId: id, name: `Branch ${id}` } });

      // Two per tenant, so ordering and paging have something to work with.
      await prisma.customer.create({
        data: { tenantId: id, name: `Aloha ${id}`, phone: "1111 1111", email: `aloha@${id}.test` },
      });
      await prisma.customer.create({
        data: { tenantId: id, name: `Bahar ${id}`, phone: "2222 2222" },
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

function firstCustomerIdOf(tenantId: string): Promise<string> {
  return runAsPlatform(async () => {
    const customer = await prisma.customer.findFirstOrThrow({
      where: { tenantId },
      select: { id: true },
    });
    return customer.id;
  });
}

describe(
  "customer.service, against the database",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    before(seed);
    after(purge);

    it("lists only the calling tenant's customers, ordered by name", async () => {
      const page = await runAsTenant(TENANT_A, () => listCustomers(NO_FILTERS));

      assert.equal(page.total, 2);
      assert.deepEqual(
        page.data.map((row) => row.name),
        [`Aloha ${TENANT_A}`, `Bahar ${TENANT_A}`],
      );
    });

    it("paginates without losing or repeating rows", async () => {
      const first = await runAsTenant(TENANT_A, () =>
        listCustomers({ ...NO_FILTERS, pageSize: 1 }),
      );
      const second = await runAsTenant(TENANT_A, () =>
        listCustomers({ ...NO_FILTERS, page: 2, pageSize: 1 }),
      );

      assert.equal(first.pageCount, 2);
      assert.equal(first.data.length, 1);
      assert.equal(second.data.length, 1);
      assert.notEqual(first.data[0]?.id, second.data[0]?.id);
    });

    it("searches name and phone, case-insensitively", async () => {
      const byName = await runAsTenant(TENANT_A, () =>
        listCustomers({ ...NO_FILTERS, search: "aloha" }),
      );
      const byPhone = await runAsTenant(TENANT_A, () =>
        listCustomers({ ...NO_FILTERS, search: "2222" }),
      );

      assert.equal(byName.total, 1);
      assert.equal(byName.data[0]?.name, `Aloha ${TENANT_A}`);
      assert.equal(byPhone.total, 1);
      assert.equal(byPhone.data[0]?.name, `Bahar ${TENANT_A}`);
    });

    it("cannot read another tenant's customer by id", async () => {
      const foreign = await firstCustomerIdOf(TENANT_B);

      await assert.rejects(
        runAsTenant(TENANT_A, () => getCustomer(foreign)),
        /does not exist/,
        "a scoped read must find nothing rather than another salon's row",
      );
    });

    it("cannot update another tenant's customer", async () => {
      const foreign = await firstCustomerIdOf(TENANT_B);

      await assert.rejects(
        runAsTenant(TENANT_A, () => updateCustomer(foreign, { name: "Hijacked" })),
      );

      const unchanged = await runAsPlatform(() =>
        prisma.customer.findUniqueOrThrow({ where: { id: foreign }, select: { name: true } }),
      );
      assert.notEqual(unchanged.name, "Hijacked");
    });

    it("stamps the caller's tenant on create", async () => {
      // The service takes no tenantId at all, so the only way a row could land in
      // the wrong salon is the extension failing to overwrite the placeholder.
      const created = await runAsTenant(TENANT_A, () => createCustomer({ name: "Stamped" }));

      const stored = await runAsPlatform(() =>
        prisma.customer.findUniqueOrThrow({
          where: { id: created.id },
          select: { tenantId: true },
        }),
      );
      assert.equal(stored.tenantId, TENANT_A);
    });

    it("refuses another tenant's branch id rather than linking to it", async () => {
      const foreignBranch = await branchOf(TENANT_B);

      // The message on a validation failure is deliberately generic; the field
      // detail is what the form reads, so that is what is asserted here.
      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createCustomer({ name: "Smuggled Branch", departmentIds: [foreignBranch] }),
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 422);
          assert.equal(error.code, "VALIDATION_FAILED");
          assert.deepEqual(error.details, [
            { path: "body.departmentIds", message: "One or more selected branches do not exist." },
          ]);
          return true;
        },
      );

      const links = await runAsPlatform(() =>
        prisma.customerDepartment.count({ where: { departmentId: foreignBranch } }),
      );
      assert.equal(links, 0, "no link row may point at another tenant's branch");
    });

    it("links the caller's own branch", async () => {
      const ownBranch = await branchOf(TENANT_A);

      const created = await runAsTenant(TENANT_A, () =>
        createCustomer({ name: "With Branch", departmentIds: [ownBranch] }),
      );

      assert.deepEqual(
        created.departments.map((branch) => branch.id),
        [ownBranch],
      );
    });

    it("leaves an absent field alone and clears an explicit null", async () => {
      const created = await runAsTenant(TENANT_A, () =>
        createCustomer({ name: "Partial", phone: "3333 3333", email: "partial@a.test" }),
      );

      const renamed = await runAsTenant(TENANT_A, () =>
        updateCustomer(created.id, { name: "Partial Renamed" }),
      );
      assert.equal(renamed.phone, "3333 3333", "an absent field must not be cleared");
      assert.equal(renamed.email, "partial@a.test");

      const cleared = await runAsTenant(TENANT_A, () =>
        updateCustomer(created.id, { email: null }),
      );
      assert.equal(cleared.email, null, "an explicit null clears");
      assert.equal(cleared.phone, "3333 3333");
    });

    it("serialises a date of birth as a plain YYYY-MM-DD", async () => {
      const created = await runAsTenant(TENANT_A, () =>
        createCustomer({ name: "Born", dateOfBirth: "1980-03-12" }),
      );

      assert.equal(created.dateOfBirth, "1980-03-12");
      assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    });

    it("normalizes future email writes, refuses case duplicates and keeps tenant uniqueness", async () => {
      const created = await runAsTenant(TENANT_A, () =>
        createCustomer({ name: "Email", email: "  Mixed@Email.test  " }),
      );
      assert.equal(created.email, "mixed@email.test");
      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createCustomer({ name: "Duplicate", email: "MIXED@email.test" }),
        ),
        /belongs to another customer/,
      );
      const other = await runAsTenant(TENANT_B, () =>
        createCustomer({ name: "Other salon", email: "Mixed@Email.test" }),
      );
      assert.equal(other.email, created.email);
      const changed = await runAsTenant(TENANT_A, () =>
        updateCustomer(created.id, { email: " New@Email.test " }),
      );
      assert.equal(changed.email, "new@email.test");
      const cleared = await runAsTenant(TENANT_A, () =>
        updateCustomer(created.id, { email: "   " }),
      );
      assert.equal(cleared.email, null);
      assert.equal(
        (await runAsTenant(TENANT_A, () => createCustomer({ name: "Blank", email: " " }))).email,
        null,
      );
    });

    it("never returns credential material", async () => {
      const page = await runAsTenant(TENANT_A, () => listCustomers(NO_FILTERS));

      for (const row of page.data) {
        assert.equal("passwordHash" in row, false);
        assert.equal("otpHash" in row, false);
      }
    });

    it("reports a missing customer rather than an empty record", async () => {
      await assert.rejects(
        runAsTenant(TENANT_A, () => getCustomer("no-such-customer")),
        /does not exist/,
      );
    });
  },
);
