import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test(
  "SC-003 attribution policy HTTP permissions, revisions, isolation and write guards",
  {
    skip: process.env.SC003_POLICY_TEST !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55464");
    assert.equal(url.pathname, "/commission_redemption_test");
    process.env.JWT_SECRET = "sc003-policy-disposable-test-secret";
    process.env.NODE_ENV = "test";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { createApp } = await import("../app.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/commissions/attribution-policy`;
    const ids: string[] = [];
    let originalStaffCore: boolean | undefined;
    const optional = {
      revision: null,
      requireSellers: false,
      requireServicePerformers: false,
      requireRedemptionPerformers: false,
    };
    const input = {
      expectedRevision: null,
      requireSellers: true,
      requireServicePerformers: false,
      requireRedemptionPerformers: true,
      reason: "Require explicit attribution",
    };
    async function call(token?: string, body?: object) {
      const response = await fetch(base, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    try {
      const module = await prisma.module.upsert({
        where: { code: "staff" },
        update: {},
        create: { code: "staff", name: "Staff", category: "Core", isCore: false },
      });
      originalStaffCore = module.isCore;
      const makeTenant = async () => {
        const tenant = await runAsPlatform(() =>
          prisma.tenant.create({
            data: { name: "Synthetic policy", slug: `sc003-policy-${randomUUID()}` },
          }),
        );
        ids.push(tenant.id);
        await runAsTenant(tenant.id, () =>
          prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id } }),
        );
        return tenant;
      };
      const a = await makeTenant(),
        b = await makeTenant();
      const makeUser = (tenantId: string, globalRole: "MANAGER" | "STAFF" | "SUPER_ADMIN") =>
        runAsTenant(tenantId, () =>
          prisma.user.create({
            data: {
              tenantId,
              globalRole,
              email: `${randomUUID()}@policy.test`,
              name: globalRole,
              passwordHash: "synthetic-not-login",
            },
          }),
        );
      const manager = await makeUser(a.id, "MANAGER"),
        staff = await makeUser(a.id, "STAFF"),
        owner = await makeUser(a.id, "SUPER_ADMIN"),
        foreign = await makeUser(b.id, "MANAGER");
      const token = (user: typeof manager, realm: "web" | "platform" = "web") =>
        signAccessToken({
          id: user.id,
          email: user.email!,
          globalRole: user.globalRole,
          tenantId: user.tenantId,
          tokenVersion: 0,
          realm,
        }).token;
      const admin = token(manager),
        staffToken = token(staff),
        ownerToken = token(owner),
        other = token(foreign);
      assert.equal((await call()).status, 401);
      assert.equal((await call(staffToken)).status, 403);
      assert.equal((await call(staffToken, input)).status, 403);
      assert.equal((await call(token(manager, "platform"))).status, 403);
      assert.equal((await call(ownerToken)).body.code, "TWO_FACTOR_REQUIRED");
      assert.equal((await call(ownerToken, input)).body.code, "TWO_FACTOR_REQUIRED");
      assert.deepEqual((await call(admin)).body.data, optional);
      assert.equal((await call(admin, { ...input, tenantId: b.id })).status, 422);
      assert.equal((await call(admin, { ...input, reason: " " })).status, 422);
      assert.equal((await call(admin, { ...input, requireSellers: "true" })).status, 422);
      const outcomes = await Promise.all([call(admin, input), call(admin, input)]);
      assert.deepEqual(outcomes.map((result) => result.status).sort(), [200, 409]);
      const saved = outcomes.find((result) => result.status === 200)!.body.data;
      assert.equal(typeof saved.revision, "string");
      assert.equal(saved.requireSellers, true);
      assert.equal(saved.requireRedemptionPerformers, true);
      assert.deepEqual((await call(other)).body.data, optional);
      assert.equal((await call(other, { ...input, expectedRevision: saved.revision })).status, 409);
      await runAsTenant(a.id, async () => {
        const rows = await prisma.commissionAttributionPolicy.findMany();
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.actorId, manager.id);
        assert.equal(rows[0]!.reason, input.reason);
        await prisma.user.update({ where: { id: owner.id }, data: { twoFactorEnabled: true } });
      });
      assert.equal((await call(ownerToken)).status, 200);
      const replacement = await call(ownerToken, {
        ...input,
        expectedRevision: saved.revision,
        requireSellers: false,
      });
      assert.equal(replacement.status, 200);
      assert.equal(replacement.body.data.requireSellers, false);
      await runAsTenant(a.id, () =>
        prisma.user.update({ where: { id: manager.id }, data: { disabled: true } }),
      );
      assert.equal((await call(admin)).status, 401);
      assert.equal((await call(admin, input)).status, 401);
      await runAsTenant(a.id, () =>
        prisma.user.update({
          where: { id: manager.id },
          data: { disabled: false, tokenVersion: 1 },
        }),
      );
      assert.equal((await call(admin, input)).status, 401);
      await runAsTenant(b.id, () =>
        prisma.user.update({ where: { id: foreign.id }, data: { globalRole: "STAFF" } }),
      );
      assert.equal(
        (await call(other)).status,
        403,
        "Role is rechecked even if the token still says manager",
      );
      await runAsTenant(b.id, () =>
        prisma.user.update({ where: { id: foreign.id }, data: { globalRole: "MANAGER" } }),
      );
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: a.id }, data: { status: "SUSPENDED" } }),
      );
      assert.equal((await call(ownerToken)).status, 200);
      const refused = await call(ownerToken, {
        ...input,
        expectedRevision: replacement.body.data.revision,
      });
      assert.equal(refused.status, 403);
      assert.equal(refused.body.code, "TENANT_SUSPENDED");
      assert.equal(await runAsTenant(a.id, () => prisma.commissionAttributionPolicy.count()), 2);
      // This database is disposable. Temporarily make staff an add-on so these guard
      // assertions always run, even when an earlier fixture made the module core.
      await prisma.module.update({ where: { id: module.id }, data: { isCore: false } });
      {
        await runAsTenant(b.id, () =>
          prisma.tenantModule.updateMany({
            where: { moduleId: module.id },
            data: { expiresAt: new Date(0) },
          }),
        );
        assert.equal((await call(other)).body.code, "MODULE_NOT_ENTITLED");
        await runAsTenant(b.id, () =>
          prisma.tenantModule.deleteMany({ where: { moduleId: module.id } }),
        );
        assert.equal((await call(other)).body.code, "MODULE_NOT_ENTITLED");
        assert.equal((await call(other, input)).body.code, "MODULE_NOT_ENTITLED");
      }
      assert.equal(
        await runAsTenant(a.id, () =>
          prisma.employeeCommission.count({ where: { ledgerVersion: 1 } }),
        ),
        0,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      if (originalStaffCore !== undefined)
        await prisma.module.update({
          where: { code: "staff" },
          data: { isCore: originalStaffCore },
        });
      await runAsPlatform(() => prisma.tenant.deleteMany({ where: { id: { in: ids } } }));
      await prisma.$disconnect();
    }
  },
);
