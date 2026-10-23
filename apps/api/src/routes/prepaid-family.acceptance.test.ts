import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

test(
  "explicit prepaid family membership isolation, authorization, races and immutable history",
  {
    skip: process.env.PREPAID_FAMILY_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/package_expiry_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "prepaid-family-isolated-test-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createApp } = await import("../app.js");
    const { createPrepaidFamily, changePrepaidMembership, getPrepaidFamily } =
      await import("../services/prepaid-family.service.js");
    const { getCustomerHoldings } = await import("../services/customer.service.js");
    const tenantId = "prepaid-family-acceptance-a";
    const foreignId = "prepaid-family-acceptance-b";
    const scoped = <T>(fn: () => T) => runAsTenant(tenantId, fn);
    const purge = () =>
      runAsPlatform(() =>
        prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } }),
      );
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/customers`;
    try {
      await purge();
      const fixture = await runAsPlatform(async () => {
        await prisma.tenant.createMany({
          data: [
            { id: tenantId, name: "Family A", slug: tenantId },
            { id: foreignId, name: "Family B", slug: foreignId },
          ],
        });
        const manager = await prisma.user.create({
          data: {
            tenantId,
            name: "Manager",
            email: "manager@prepaid-family.test",
            passwordHash: "unused",
            globalRole: "MANAGER",
          },
        });
        const staff = await prisma.user.create({
          data: {
            tenantId,
            name: "Staff",
            email: "staff@prepaid-family.test",
            passwordHash: "unused",
            globalRole: "STAFF",
          },
        });
        const a = await prisma.customer.create({
          data: { tenantId, name: "A", familyId: "legacy-group" },
        });
        const b = await prisma.customer.create({
          data: { tenantId, name: "B", familyId: "legacy-group" },
        });
        const foreign = await prisma.customer.create({
          data: { tenantId: foreignId, name: "Foreign" },
        });
        const credit = await prisma.valuePackage.create({
          data: { tenantId, name: "Private credit", price: 100, credit: 100 },
        });
        const holding = await prisma.customerValuePackageHolding.create({
          data: {
            tenantId,
            customerId: a.id,
            valuePackageId: credit.id,
            amount: 100,
            amountRemaining: 100,
          },
        });
        const module = await prisma.module.upsert({
          where: { code: "packages" },
          update: {},
          create: {
            code: "packages",
            name: "Packages",
            category: "Add-on",
            isCore: false,
          },
        });
        await prisma.module.upsert({
          where: { code: "customers" },
          update: { isCore: true },
          create: {
            code: "customers",
            name: "Customers",
            category: "Core",
            isCore: true,
          },
        });
        return { manager, staff, a, b, foreign, holding, module };
      });
      const bearer = (user: typeof fixture.manager) =>
        signAccessToken({
          id: user.id,
          email: user.email!,
          globalRole: user.globalRole,
          realm: "web",
          tenantId,
          tokenVersion: user.tokenVersion,
        }).token;
      const post = (customerId: string, path: string, body: object, token?: string) =>
        fetch(`${base}/${customerId}/${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
      const input = { name: "Family", reason: "Customer request", confirmed: true as const };
      assert.equal(
        await scoped(() => getPrepaidFamily(fixture.a.id)),
        null,
        "legacy familyId must not enroll customers",
      );
      assert.equal((await post(fixture.a.id, "prepaid-family", input)).status, 401);
      assert.equal(
        (await post(fixture.a.id, "prepaid-family", input, bearer(fixture.manager))).status,
        403,
        "entitlement required",
      );
      await scoped(() =>
        prisma.tenantModule.create({ data: { tenantId, moduleId: fixture.module.id } }),
      );
      assert.equal(
        (await post(fixture.a.id, "prepaid-family", input, bearer(fixture.staff))).status,
        403,
      );
      assert.equal(
        (await post(fixture.foreign.id, "prepaid-family", input, bearer(fixture.manager))).status,
        404,
      );
      const created = await post(fixture.a.id, "prepaid-family", input, bearer(fixture.manager));
      assert.equal(created.status, 200);
      const family = ((await created.json()) as { data: { id: string } }).data;
      assert.equal(
        (await post(fixture.a.id, "prepaid-family", input, bearer(fixture.manager))).status,
        409,
      );
      const join = {
        familyId: family.id,
        expectedFamilyId: null,
        reason: "Join",
        confirmed: true as const,
      };
      const concurrent = await Promise.all([
        post(fixture.b.id, "prepaid-family-membership", join, bearer(fixture.manager)),
        post(fixture.b.id, "prepaid-family-membership", join, bearer(fixture.manager)),
      ]);
      assert.deepEqual(concurrent.map((row) => row.status).sort(), [200, 409]);
      assert.equal((await scoped(() => getPrepaidFamily(fixture.a.id)))!.members.length, 2);
      const spendable = await scoped(() => getCustomerHoldings(fixture.b.id));
      assert.equal(
        spendable.holdings.length,
        0,
        "joining alone must never expose private holdings",
      );
      assert.equal(
        (
          await scoped(() =>
            prisma.customerValuePackageHolding.findFirstOrThrow({
              where: { id: fixture.holding.id },
            }),
          )
        ).amountRemaining.toFixed(2),
        "100.00",
      );
      const foreignFamily = await runAsTenant(foreignId, () =>
        prisma.prepaidFamily.create({ data: { tenantId: foreignId, name: "Foreign" } }),
      );
      assert.equal(
        (
          await post(
            fixture.b.id,
            "prepaid-family-membership",
            { ...join, familyId: foreignFamily.id, expectedFamilyId: family.id },
            bearer(fixture.manager),
          )
        ).status,
        404,
      );
      const event = await scoped(() =>
        prisma.prepaidFamilyEvent.findFirstOrThrow({ where: { customerId: fixture.b.id } }),
      );
      await assert.rejects(
        scoped(() =>
          prisma.prepaidFamilyEvent.update({
            where: { id: event.id },
            data: { reason: "rewrite" },
          }),
        ),
        /append-only/,
      );
      await assert.rejects(
        scoped(() => prisma.prepaidFamilyEvent.delete({ where: { id: event.id } })),
        /append-only/,
      );
      assert.equal(await runAsTenant(foreignId, () => prisma.prepaidFamilyEvent.count()), 0);
      const history = await fetch(`${base}/${fixture.b.id}/prepaid-family-history?pageSize=1`, {
        headers: { Authorization: `Bearer ${bearer(fixture.manager)}` },
      });
      assert.equal(history.status, 200);
      assert.equal(((await history.json()) as { data: { total: number } }).data.total, 1);
      await scoped(() =>
        prisma.customer.update({ where: { id: fixture.b.id }, data: { archivedAt: new Date() } }),
      );
      await assert.rejects(
        scoped(() =>
          changePrepaidMembership(
            fixture.b.id,
            { ...join, familyId: null, expectedFamilyId: family.id },
            fixture.manager.id,
          ),
        ),
        { code: "CUSTOMER_ARCHIVED" },
      );
      await scoped(() =>
        prisma.customer.update({ where: { id: fixture.b.id }, data: { archivedAt: null } }),
      );
      await scoped(() =>
        changePrepaidMembership(
          fixture.b.id,
          { ...join, familyId: null, expectedFamilyId: family.id },
          fixture.manager.id,
        ),
      );
      assert.equal(await scoped(() => getPrepaidFamily(fixture.b.id)), null);
      // An evidence-write failure must roll back the membership, not leave an unaudited join.
      await runAsPlatform(() =>
        prisma.$executeRawUnsafe(
          `CREATE FUNCTION reject_family_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId" = 'prepaid-family-acceptance-a' THEN RAISE EXCEPTION 'injected family evidence failure'; END IF; RETURN NEW; END; $$`,
        ),
      );
      await runAsPlatform(() =>
        prisma.$executeRawUnsafe(
          `CREATE TRIGGER reject_family_test_event BEFORE INSERT ON prepaid_family_events FOR EACH ROW EXECUTE FUNCTION reject_family_test_event()`,
        ),
      );
      try {
        await assert.rejects(
          scoped(() => changePrepaidMembership(fixture.b.id, join, fixture.manager.id)),
          /injected family evidence failure/,
        );
        assert.equal(await scoped(() => getPrepaidFamily(fixture.b.id)), null);
      } finally {
        await runAsPlatform(() =>
          prisma.$executeRawUnsafe(
            `DROP TRIGGER reject_family_test_event ON prepaid_family_events`,
          ),
        );
        await runAsPlatform(() =>
          prisma.$executeRawUnsafe(`DROP FUNCTION reject_family_test_event()`),
        );
      }
      await scoped(() =>
        prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
      );
      await assert.rejects(
        scoped(() => createPrepaidFamily(fixture.b.id, input, fixture.manager.id)),
        { code: "TENANT_READ_ONLY" },
      );
      await scoped(() =>
        prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } }),
      );
      await scoped(() =>
        prisma.user.update({ where: { id: fixture.manager.id }, data: { disabled: true } }),
      );
      await assert.rejects(
        scoped(() => createPrepaidFamily(fixture.b.id, input, fixture.manager.id)),
        { statusCode: 403 },
      );
    } finally {
      server.close();
      await once(server, "close");
      await purge();
      await prisma.$disconnect();
    }
  },
);
