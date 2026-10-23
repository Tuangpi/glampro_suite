import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import jwt from "jsonwebtoken";

test(
  "SAAS-04 real HTTP lifecycle, subscriptions, entitlements, audit rollback and two-company isolation",
  {
    skip: process.env.SAAS04_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55442");
    assert.equal(url.pathname, "/saas04_acceptance");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "saas04-disposable-secret";
    process.env.SMTP_HOST = "";
    const { createApp } = await import("../app.js");
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { hashPassword } = await import("../lib/password.js");
    const { signAccessToken, createRefreshToken } = await import("../lib/tokens.js");
    const { changeCompanyLifecycle, recordCompanySubscription, changeCompanyModule } =
      await import("../services/company-administration.service.js");
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const suffix = String(Date.now());
    const now = Date.now(),
      day = 86400000;
    const password = "disposable-staff-passphrase";
    const period = {
      startDate: new Date(now - day).toISOString(),
      endDate: new Date(now + 30 * day).toISOString(),
      amount: "99.00",
      currency: "SGD",
      reason: "Manual contract",
    };
    const reason = "Operator account review";
    async function call(path: string, token?: string, body?: object) {
      const response = await fetch(base + path, {
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
      const hash = await hashPassword(password);
      const admin = await prisma.platformAdmin.create({
        data: { name: "Operator", email: `operator-${suffix}@saas04.test`, passwordHash: hash },
      });
      // Fixture a valid platform session; production middleware still verifies issuer,
      // audience, live session, operator status and versions on every HTTP request.
      const session = await prisma.platformSession.create({
        data: {
          adminId: admin.id,
          tokenHash: createRefreshToken().tokenHash,
          tokenVersion: 0,
          expiresAt: new Date(now + day),
        },
      });
      const operator = jwt.sign(
        { realm: "platform", sessionId: session.id, tokenVersion: 0 },
        process.env.JWT_SECRET,
        {
          algorithm: "HS256",
          issuer: "glampro-api",
          audience: "glampro-platform",
          subject: admin.id,
          expiresIn: "1h",
        },
      );
      const [a, b] = await Promise.all(
        ["a", "b"].map((letter) =>
          prisma.tenant.create({
            data: { name: `Company ${letter}`, slug: `saas04-${letter}-${suffix}` },
          }),
        ),
      );
      const [userA, userB] = await runAsPlatform(() =>
        Promise.all(
          [a, b].map((company) =>
            prisma.user.create({
              data: {
                tenantId: company.id,
                name: company.name,
                email: `${company.id}@saas04.test`,
                passwordHash: hash,
                globalRole: "STAFF",
              },
            }),
          ),
        ),
      );
      function tenantToken(user: typeof userA) {
        return signAccessToken({
          id: user.id,
          email: user.email!,
          globalRole: user.globalRole,
          tenantId: user.tenantId,
          realm: "web",
          tokenVersion: user.tokenVersion,
        }).token;
      }
      const tokenA = tenantToken(userA),
        tokenB = tenantToken(userB);
      const ownerToken = signAccessToken({
        id: userB.id,
        email: userB.email!,
        globalRole: "SUPER_ADMIN",
        tenantId: b.id,
        realm: "web",
        tokenVersion: 0,
      }).token;
      await prisma.module.upsert({
        where: { code: "customers" },
        update: { isCore: true },
        create: { code: "customers", name: "Customers", category: "Core", isCore: true },
      });
      await prisma.module.upsert({
        where: { code: "packages" },
        update: { isCore: false },
        create: { code: "packages", name: "Packages", category: "Add-on" },
      });
      const root = `/platform/companies/${a.id}`;
      const changes = [
        ["/lifecycle", { action: "suspend", reason }],
        ["/subscriptions", period],
        ["/modules", { code: "packages", enabled: true, expiresAt: null, reason }],
      ] as const;
      for (const token of [undefined, tokenA, ownerToken]) {
        for (const route of ["/administration", "/audit"])
          assert.equal((await call(root + route, token)).status, 401);
        for (const [route, body] of changes)
          assert.equal((await call(root + route, token, body)).status, 401);
      }
      assert.equal((await call("/customers", operator)).status, 403);
      assert.equal((await call(root + "/administration", operator)).status, 200);
      assert.equal(
        (await call(root + "/lifecycle", operator, { action: "delete", reason })).status,
        422,
      );
      assert.equal(
        (await call(root + "/lifecycle", operator, { action: "cancel", reason, tenantId: b.id }))
          .status,
        422,
      );
      assert.equal(
        (await call("/platform/companies/missing/administration", operator)).status,
        404,
      );
      assert.equal(
        (await call(root + "/subscriptions", operator, { ...period, amount: "1.234" })).status,
        422,
      );
      assert.equal(
        (
          await call(root + "/subscriptions", operator, {
            ...period,
            startDate: new Date(now + day).toISOString(),
          })
        ).status,
        400,
      );
      const recorded = await Promise.all([
        call(root + "/subscriptions", operator, period),
        call(root + "/subscriptions", operator, period),
      ]);
      assert.deepEqual(
        recorded.map((result) => result.status).sort(),
        [201, 409],
        "company lock serializes overlap checks",
      );
      assert.equal(await runAsTenant(a.id, () => prisma.subscription.count()), 1);
      assert.equal(await runAsTenant(b.id, () => prisma.subscription.count()), 0);
      assert.equal(
        (
          await call(root + "/modules", operator, {
            code: "customers",
            enabled: false,
            expiresAt: null,
            reason,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(root + "/modules", operator, {
            code: "unknown",
            enabled: true,
            expiresAt: null,
            reason,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await call(root + "/modules", operator, {
            code: "packages",
            enabled: true,
            expiresAt: new Date(now - day).toISOString(),
            reason,
          })
        ).status,
        400,
      );
      assert.equal((await call("/packages", tokenA)).status, 403);
      assert.equal(
        (
          await call(root + "/modules", operator, {
            code: "packages",
            enabled: true,
            expiresAt: null,
            reason,
          })
        ).status,
        200,
      );
      assert.equal((await call("/packages", tokenA)).status, 200);
      assert.equal((await call("/packages", tokenB)).status, 403);
      await runAsTenant(a.id, () =>
        prisma.tenantModule.updateMany({ data: { expiresAt: new Date(now - day) } }),
      );
      assert.equal(
        (await call("/packages", tokenA)).status,
        403,
        "lapsed add-ons fail on existing tokens",
      );
      assert.equal(
        (
          await call(root + "/modules", operator, {
            code: "packages",
            enabled: true,
            expiresAt: new Date(now + day).toISOString(),
            reason,
          })
        ).status,
        200,
      );
      assert.equal((await call("/packages", tokenA)).status, 200);
      assert.equal(
        (
          await call(root + "/modules", operator, {
            code: "packages",
            enabled: false,
            expiresAt: null,
            reason,
          })
        ).status,
        200,
      );
      assert.equal(
        (await call("/packages", tokenA)).status,
        403,
        "revocation applies to an existing session immediately",
      );
      await runAsTenant(a.id, () =>
        prisma.customer.create({ data: { tenantId: a.id, name: "Private A" } }),
      );
      await runAsTenant(b.id, () =>
        prisma.customer.create({ data: { tenantId: b.id, name: "Private B" } }),
      );
      const customersA = await call("/customers", tokenA);
      assert.equal(customersA.status, 200);
      assert.equal(JSON.stringify(customersA.body).includes("Private B"), false);
      const refresh = createRefreshToken();
      await prisma.refreshToken.create({
        data: { userId: userA.id, tokenHash: refresh.tokenHash, expiresAt: new Date(now + day) },
      });
      assert.equal(
        (await call(root + "/lifecycle", operator, { action: "suspend", reason })).status,
        200,
      );
      assert.equal((await call("/customers", tokenA)).status, 401);
      assert.equal(
        (await call("/auth/refresh", undefined, { refreshToken: refresh.token })).status,
        401,
      );
      assert.equal(
        (await call("/customers", tokenB)).status,
        200,
        "company B sessions are not revoked",
      );
      const suspendedLogin = await call("/auth/login", undefined, { email: userA.email, password });
      assert.equal(suspendedLogin.status, 200);
      const suspendedToken = suspendedLogin.body.data.accessToken;
      assert.equal((await call("/customers", suspendedToken)).status, 200);
      const deniedWrite = await call("/customers", suspendedToken, { name: "Blocked write" });
      assert.equal(deniedWrite.status, 403);
      assert.equal(deniedWrite.body.code, "TENANT_SUSPENDED");
      assert.equal(
        (await call(root + "/lifecycle", operator, { action: "reactivate", reason })).status,
        200,
      );
      assert.equal((await call("/customers", suspendedToken)).status, 401);
      const activeLogin = await call("/auth/login", undefined, { email: userA.email, password });
      assert.equal(activeLogin.status, 200);
      assert.equal(
        (await call("/customers", activeLogin.body.data.accessToken, { name: "Allowed write" }))
          .status,
        201,
      );
      assert.equal(
        (await call(root + "/lifecycle", operator, { action: "cancel", reason })).status,
        200,
      );
      assert.equal(
        (await call("/auth/login", undefined, { email: userA.email, password })).status,
        403,
      );
      assert.equal((await call("/customers", activeLogin.body.data.accessToken)).status, 401);
      assert.equal(
        (await call(root + "/lifecycle", operator, { action: "reactivate", reason })).status,
        200,
      );
      // An expired paid period cannot be hidden by a pending/cancelled future row.
      await runAsTenant(a.id, async () => {
        await prisma.subscription.updateMany({
          data: { startDate: new Date(now - 3 * day), endDate: new Date(now - day) },
        });
        for (const status of ["PENDING", "CANCELLED"] as const)
          await prisma.subscription.create({
            data: {
              tenantId: a.id,
              startDate: new Date(now - day),
              endDate: new Date(now + 60 * day),
              status,
              amount: "0.00",
              currency: "SGD",
            },
          });
      });
      const expired = await call("/auth/login", undefined, { email: userA.email, password });
      assert.equal(expired.status, 403);
      assert.equal(expired.body.code, "TENANT_EXPIRED");
      const currentUser = await runAsTenant(a.id, () =>
        prisma.user.findUniqueOrThrow({ where: { id: userA.id } }),
      );
      assert.equal(
        (await call("/customers", tenantToken(currentUser))).body.code,
        "TENANT_EXPIRED",
      );
      const expiredAdmin = await call(root + "/administration", operator);
      assert.equal(expiredAdmin.body.data.effectiveStatus, "EXPIRED");
      assert.equal(
        (await call(root + "/lifecycle", operator, { action: "suspend", reason })).status,
        200,
      );
      assert.equal(
        (await call(root + "/lifecycle", operator, { action: "reactivate", reason })).status,
        409,
      );
      assert.equal((await call(root + "/subscriptions", operator, period)).status, 201);
      assert.equal(
        (await call(root + "/lifecycle", operator, { action: "reactivate", reason })).status,
        200,
      );
      // Audit FK failure must roll back all lifecycle/user/session writes and grants/periods.
      const snapshot = await runAsTenant(b.id, async () => ({
        tenant: await prisma.tenant.findUniqueOrThrow({ where: { id: b.id } }),
        user: await prisma.user.findUniqueOrThrow({ where: { id: userB.id } }),
      }));
      const refreshB = createRefreshToken();
      const refreshRowB = await prisma.refreshToken.create({
        data: { userId: userB.id, tokenHash: refreshB.tokenHash, expiresAt: new Date(now + day) },
      });
      await assert.rejects(
        changeCompanyLifecycle(b.id, { action: "cancel", reason }, "missing-operator"),
      );
      const after = await runAsTenant(b.id, async () => ({
        tenant: await prisma.tenant.findUniqueOrThrow({ where: { id: b.id } }),
        user: await prisma.user.findUniqueOrThrow({ where: { id: userB.id } }),
      }));
      assert.equal(after.tenant.status, snapshot.tenant.status);
      assert.equal(after.user.tokenVersion, snapshot.user.tokenVersion);
      assert.equal(
        (await prisma.refreshToken.findUniqueOrThrow({ where: { id: refreshRowB.id } })).revokedAt,
        null,
      );
      await assert.rejects(recordCompanySubscription(b.id, period, "missing-operator"));
      await assert.rejects(
        changeCompanyModule(
          b.id,
          { code: "packages", enabled: true, expiresAt: null, reason },
          "missing-operator",
        ),
      );
      assert.equal(await runAsTenant(b.id, () => prisma.subscription.count()), 0);
      assert.equal(await runAsTenant(b.id, () => prisma.tenantModule.count()), 0);
      const auditA = await call(root + "/audit?pageSize=2", operator);
      assert.equal(auditA.status, 200);
      assert.equal(auditA.body.data.items.length, 2);
      assert.ok(auditA.body.data.total >= 8);
      assert.equal(auditA.body.data.items[0].actor.id, admin.id);
      assert.equal(auditA.body.data.items[0].metadata.reason, reason);
      assert.equal((await call(`/platform/companies/${b.id}/audit`, operator)).body.data.total, 0);
      assert.equal(JSON.stringify(auditA.body).includes("passwordHash"), false);
      assert.equal(JSON.stringify(auditA.body).includes("Private A"), false);
      assert.equal(
        (await call(root + "/audit?page=2&pageSize=2", operator)).body.data.items.length,
        2,
      );
      console.log(
        "SAAS-04 HTTP authorization, isolation, concurrent periods, lifecycle/session policy, entitlements and atomic audit verified.",
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await prisma.$disconnect();
    }
  },
);
