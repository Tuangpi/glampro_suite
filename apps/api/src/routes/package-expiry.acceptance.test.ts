import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

test(
  "package expiry endpoints and spendable liability on an isolated database",
  {
    skip: process.env.PACKAGE_EXPIRY_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/package_expiry_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "package-expiry-isolated-test-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createApp } = await import("../app.js");
    const { getCustomerHoldings } = await import("../services/customer.service.js");
    const { reportOverview } = await import("../services/report.service.js");
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/packages`;
    const tenantId = "expiry-acceptance-a";
    const foreignId = "expiry-acceptance-b";
    async function purge() {
      await runAsPlatform(() =>
        prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } }),
      );
    }
    try {
      await purge();
      const fixture = await runAsPlatform(async () => {
        await prisma.tenant.createMany({
          data: [
            { id: tenantId, name: "Expiry A", slug: tenantId },
            { id: foreignId, name: "Expiry B", slug: foreignId },
          ],
        });
        const owner = await prisma.user.create({
          data: {
            tenantId,
            name: "Owner",
            email: "owner@expiry.test",
            twoFactorEnabled: true,
            passwordHash: "unused",
            globalRole: "SUPER_ADMIN",
          },
        });
        const staff = await prisma.user.create({
          data: {
            tenantId,
            name: "Staff",
            email: "staff@expiry.test",
            passwordHash: "unused",
            globalRole: "STAFF",
          },
        });
        const module = await prisma.module.upsert({
          where: { code: "packages" },
          update: {},
          create: { code: "packages", name: "Packages", category: "Add-on", isCore: false },
        });
        const own = await prisma.valuePackage.create({
          data: { tenantId, name: "Credit", price: 10, credit: 12 },
        });
        const foreign = await prisma.valuePackage.create({
          data: { tenantId: foreignId, name: "Other credit", price: 10, credit: 12 },
        });
        const bundle = await prisma.package.create({
          data: {
            tenantId,
            name: "Sessions",
            sessionCount: 5,
            memberPrice: 10,
            nonmemberPrice: 10,
          },
        });
        const customer = await prisma.customer.create({ data: { tenantId, name: "Customer" } });
        return { owner, staff, module, own, foreign, bundle, customer };
      });
      function tokenFor(user: typeof fixture.owner) {
        return signAccessToken({
          id: user.id,
          email: user.email!,
          globalRole: user.globalRole,
          tenantId,
          realm: "web",
          tokenVersion: user.tokenVersion,
        }).token;
      }
      async function patch(path: string, body: object, token?: string) {
        return fetch(`${base}${path}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
      }
      const ownerToken = tokenFor(fixture.owner);
      const path = `/prepaid/${fixture.own.id}/validity`;
      assert.equal((await patch(path, { validityDays: 30 })).status, 401);
      assert.equal((await patch(path, { validityDays: 30 }, ownerToken)).status, 403);
      await runAsTenant(tenantId, () =>
        prisma.tenantModule.create({ data: { tenantId, moduleId: fixture.module.id } }),
      );
      assert.equal((await patch(path, { validityDays: 30 }, tokenFor(fixture.staff))).status, 403);
      assert.equal((await patch(path, { validityDays: 0 }, ownerToken)).status, 422);
      assert.equal((await patch(path, {}, ownerToken)).status, 422);
      assert.equal(
        (await patch(`/prepaid/${fixture.foreign.id}/validity`, { validityDays: 30 }, ownerToken))
          .status,
        404,
      );
      assert.equal((await patch(path, { validityDays: 30 }, ownerToken)).status, 200);
      await runAsTenant(tenantId, async () => {
        assert.equal(
          (await prisma.valuePackage.findFirstOrThrow({ where: { id: fixture.own.id } }))
            .validityDays,
          30,
        );
      });
      assert.equal((await patch(path, { validityDays: null }, ownerToken)).status, 200);
      assert.equal(
        (await patch(`/${fixture.bundle.id}`, { validityDays: 45 }, ownerToken)).status,
        200,
      );
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
      );
      assert.equal((await patch(path, { validityDays: 30 }, ownerToken)).status, 403);
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } }),
      );
      await runAsTenant(tenantId, async () => {
        for (const expiresAt of [null, new Date("2100-01-01Z"), new Date("2020-01-01Z")]) {
          await prisma.customerPackageHolding.create({
            data: {
              tenantId,
              customerId: fixture.customer.id,
              packageId: fixture.bundle.id,
              quantity: 5,
              quantityRemaining: 5,
              expiresAt,
            },
          });
          await prisma.customerValuePackageHolding.create({
            data: {
              tenantId,
              customerId: fixture.customer.id,
              valuePackageId: fixture.own.id,
              amount: 12,
              amountRemaining: 12,
              expiresAt,
            },
          });
        }
        const holdings = await getCustomerHoldings(fixture.customer.id);
        assert.equal(holdings.holdings.length, 4);
        const report = await reportOverview({
          from: "2026-10-01T00:00:00Z",
          to: "2026-10-31T23:59:59Z",
          timeZone: "Asia/Singapore",
        });
        assert.equal(report.liability.packageSessions.sessionsRemaining, 10);
        assert.equal(report.liability.prepaidCredit.balance, "24.00");
      });
      await runAsPlatform(async () => {
        assert.equal(
          (await prisma.valuePackage.findFirstOrThrow({ where: { id: fixture.foreign.id } }))
            .validityDays,
          null,
        );
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await purge();
      await prisma.$disconnect();
    }
  },
);
