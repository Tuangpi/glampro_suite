import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

test(
  "valuation activation HTTP permissions, strict confirmation, retry, audit and tenant isolation",
  {
    skip: process.env.PACKAGE_VALUATION_HTTP_TEST !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55462");
    assert.equal(url.pathname, "/valuation_test");
    const { prisma } = await import("../lib/prisma.js");
    const { runAsTenant, runAsPlatform } = await import("../lib/tenant-context.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createApp } = await import("../app.js");
    const tenants: string[] = [];
    const server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/reports`;
    const input = {
      policyVersion: 1,
      currency: "SGD",
      confirmed: true,
      reason: "Confirmed future SGD purchases",
    };
    async function salon() {
      const tenant = await prisma.tenant.create({
        data: { name: "Activation HTTP", slug: randomUUID() },
      });
      tenants.push(tenant.id);
      return tenant;
    }
    async function actor(tenantId: string, globalRole: "MANAGER" | "SUPER_ADMIN" | "STAFF") {
      const user = await runAsTenant(tenantId, () =>
        prisma.user.create({
          data: {
            tenantId,
            globalRole,
            email: `${randomUUID()}@valuation-http.test`,
            name: globalRole,
            passwordHash: "fixture",
          },
        }),
      );
      const { token } = signAccessToken({ ...user, email: user.email!, realm: "web" });
      return { user, token };
    }
    const post = (token?: string, body: unknown = input) =>
      fetch(`${base}/package-valuation/activation`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    try {
      const a = await salon(),
        b = await salon();
      const manager = await actor(a.id, "MANAGER");
      const staff = await actor(a.id, "STAFF");
      const owner = await actor(a.id, "SUPER_ADMIN");
      const other = await actor(b.id, "MANAGER");
      assert.equal((await post()).status, 401);
      assert.equal((await post(manager.token)).status, 403, "Reports entitlement is required.");
      const module = await prisma.module.upsert({
        where: { code: "reports" },
        update: {},
        create: {
          code: "reports",
          name: "Reports",
          category: "Core",
          isCore: false,
        },
      });
      for (const tenantId of tenants)
        await runAsTenant(tenantId, () =>
          prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } }),
        );
      assert.equal((await post(staff.token)).status, 403);
      assert.equal((await post(owner.token)).status, 401, "Auth invalidates owners without 2FA.");
      for (const body of [
        { ...input, confirmed: false },
        { ...input, currency: "USD" },
        { ...input, reason: " " },
        { ...input, actorId: other.user.id },
        { ...input, tenantId: b.id },
        { ...input, activatedAt: new Date().toISOString() },
      ]) {
        assert.equal((await post(manager.token, body)).status, 422);
      }
      await prisma.tenant.update({ where: { id: a.id }, data: { status: "SUSPENDED" } });
      assert.equal((await post(manager.token)).status, 403);
      await prisma.tenant.update({ where: { id: a.id }, data: { status: "ACTIVE" } });
      const [one, two] = await Promise.all([post(manager.token), post(manager.token)]);
      assert.equal(one.status, 200);
      assert.equal(two.status, 200);
      const evidence = (await one.json()) as {
        data: { id: string; actorId: string; currency: string };
      };
      assert.deepEqual(await two.json(), evidence);
      assert.equal(evidence.data.actorId, manager.user.id);
      assert.equal(evidence.data.currency, "SGD");
      assert.equal(
        (await post(manager.token, { ...input, reason: "Different confirmation" })).status,
        409,
      );
      await runAsTenant(a.id, async () => {
        assert.equal(await prisma.packageValuationActivation.count(), 1);
        assert.equal(
          await prisma.auditLog.count({
            where: { tenantId: a.id, action: "package.valuation.activate" },
          }),
          1,
        );
        assert.equal(await prisma.packagePurchaseSnapshot.count(), 0);
      });
      const otherReport = await fetch(`${base}/package-valuation`, {
        headers: { authorization: `Bearer ${other.token}` },
      });
      assert.equal(otherReport.status, 200);
      assert.equal(
        ((await otherReport.json()) as { data: { activation: unknown } }).data.activation,
        null,
      );
      await runAsTenant(b.id, () =>
        prisma.user.update({ where: { id: other.user.id }, data: { disabled: true } }),
      );
      assert.equal((await post(other.token)).status, 401);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await runAsPlatform(() => prisma.tenant.deleteMany({ where: { id: { in: tenants } } }));
      await prisma.$disconnect();
    }
  },
);
