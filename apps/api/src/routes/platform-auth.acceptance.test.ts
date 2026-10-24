import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { test } from "node:test";

test(
  "SAAS-02 real PostgreSQL, HTTP and loopback SMTP platform isolation",
  {
    skip: process.env.SAAS02_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/saas02_acceptance");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "saas02-disposable-secret";
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_USER = "";
    process.env.SMTP_PASSWORD = "";
    const messages: string[] = [];
    const smtp = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.write("220 localhost SEC-01 capture\r\n");
      let buffer = "";
      let data = false;
      socket.on("data", (chunk) => {
        buffer += chunk;
        for (;;) {
          const boundary = buffer.indexOf(data ? "\r\n.\r\n" : "\r\n");
          if (boundary < 0) return;
          const input = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + (data ? 5 : 2));
          if (data) {
            messages.push(input);
            data = false;
            socket.write("250 captured\r\n");
          } else if (/^(EHLO|HELO)/i.test(input)) {
            socket.write("250 localhost\r\n");
          } else if (/^DATA$/i.test(input)) {
            data = true;
            socket.write("354 End with dot\r\n");
          } else if (/^QUIT$/i.test(input)) {
            socket.end("221 bye\r\n");
          } else {
            socket.write("250 ok\r\n");
          }
        }
      });
    });
    smtp.listen(0, "127.0.0.1");
    await once(smtp, "listening");
    process.env.SMTP_PORT = String((smtp.address() as AddressInfo).port);
    const { createApp } = await import("../app.js");
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform } = await import("../lib/tenant-context.js");
    const { hashPassword } = await import("../lib/password.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const http = createApp().listen(0, "127.0.0.1");
    await once(http, "listening");
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api`;
    const password = "disposable-operator-passphrase";
    const email = `operator-${Date.now()}@saas02.test`;
    async function post(path: string, body: object) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    async function me(token: string, path = "/platform/auth/me") {
      return fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    }
    async function challenge() {
      const result = await post("/platform/auth/login", { email, password });
      assert.equal(result.status, 200);
      assert.equal(result.body.data.accessToken, undefined);
      const code = messages.at(-1)?.match(/verification code is (\d{6})/)?.[1];
      assert.ok(code);
      return { challenge: result.body.data.challenge as string, code };
    }
    async function signIn() {
      const result = await post("/platform/auth/verify", await challenge());
      assert.equal(result.status, 200);
      return result.body.data;
    }
    try {
      // These fixture ids exist only in the explicitly gated disposable database.
      await runAsPlatform(async () => {
        await prisma.user.deleteMany({ where: { id: "saas02-owner" } });
        await prisma.tenant.deleteMany({ where: { id: "saas02-company" } });
      });
      const passwordHash = await hashPassword(password);
      const admin = await prisma.platformAdmin.create({
        data: { email, name: "Operator", passwordHash },
      });
      await runAsPlatform(async () => {
        await prisma.tenant.create({
          data: { id: "saas02-company", name: "Company", slug: "saas02-company" },
        });
        await prisma.user.create({
          data: {
            id: "saas02-owner",
            tenantId: "saas02-company",
            name: "Owner",
            email: "owner@saas02.test",
            passwordHash,
            globalRole: "SUPER_ADMIN",
            twoFactorEnabled: true,
          },
        });
      });
      assert.equal((await post("/platform/auth/login", { email, password: "wrong" })).status, 401);
      assert.equal(
        (await post("/platform/auth/login", { email: "owner@saas02.test", password })).status,
        401,
      );
      assert.equal((await post("/auth/login", { email, password, realm: "platform" })).status, 403);
      assert.equal(
        (await post("/platform/auth/verify", { challenge: "x", code: "123456" })).status,
        422,
      );
      const input = await challenge();
      const stored = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
      assert.notEqual(stored.loginCodeHash, input.code);
      assert.notEqual(stored.loginChallengeHash, input.challenge);
      const results = await Promise.all([
        post("/platform/auth/verify", input),
        post("/platform/auth/verify", input),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
      const session = results.find((r) => r.status === 200)!.body.data;
      assert.equal((await me(session.accessToken)).status, 200);
      assert.equal((await me(session.accessToken, "/auth/me")).status, 403);
      const salonToken = signAccessToken({
        id: "saas02-owner",
        email: "owner@saas02.test",
        globalRole: "SUPER_ADMIN",
        realm: "web",
        tenantId: "saas02-company",
        tokenVersion: 0,
      }).token;
      assert.equal((await me(salonToken)).status, 401);
      const refresh = await post("/platform/auth/refresh", { refreshToken: session.refreshToken });
      assert.equal(refresh.status, 200);
      assert.equal(
        (await post("/platform/auth/refresh", { refreshToken: session.refreshToken })).status,
        401,
      );
      assert.equal(
        (await post("/auth/refresh", { refreshToken: refresh.body.data.refreshToken })).status,
        401,
      );
      assert.equal(
        (await post("/platform/auth/logout", { refreshToken: refresh.body.data.refreshToken }))
          .status,
        200,
      );
      assert.equal((await me(session.accessToken)).status, 401);
      assert.equal((await me(refresh.body.data.accessToken)).status, 401);
      assert.equal(
        (await post("/platform/auth/refresh", { refreshToken: refresh.body.data.refreshToken }))
          .status,
        401,
      );
      const disabledSession = await signIn();
      await prisma.platformAdmin.update({ where: { id: admin.id }, data: { status: "DISABLED" } });
      assert.equal((await me(disabledSession.accessToken)).status, 401);
      assert.equal(
        (await post("/platform/auth/refresh", { refreshToken: disabledSession.refreshToken }))
          .status,
        401,
      );
      await prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { status: "ACTIVE", tokenVersion: { increment: 1 } },
      });
      assert.equal((await me(disabledSession.accessToken)).status, 401);
      const budget = await challenge();
      const wrong = budget.code === "000000" ? "000001" : "000000";
      for (let i = 0; i < 5; i++)
        assert.equal((await post("/platform/auth/verify", { ...budget, code: wrong })).status, 401);
      assert.equal((await post("/platform/auth/verify", budget)).status, 401);
      const expired = await challenge();
      await prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { loginChallengeExpiresAt: new Date(0) },
      });
      assert.equal((await post("/platform/auth/verify", expired)).status, 401);
      const replaced = await challenge();
      await challenge();
      assert.equal((await post("/platform/auth/verify", replaced)).status, 401);
      const audit = await prisma.auditLog.findMany({ where: { actorPlatformAdminId: admin.id } });
      assert.ok(audit.some((entry) => entry.action === "platform.login"));
      assert.ok(audit.some((entry) => entry.action === "platform.logout"));
      const serialized = JSON.stringify(audit);
      assert.ok(!serialized.includes(session.refreshToken));
      assert.ok(!serialized.includes(input.challenge));

      // A configured but stopped inbox must fail closed with an actionable error.
      await new Promise<void>((resolve) => smtp.close(() => resolve()));
      const unavailable = await post("/platform/auth/login", { email, password });
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.body.code, "EMAIL_SEND_FAILED");
      assert.match(unavailable.body.message, /SMTP server is running/);
      assert.equal(unavailable.body.data, undefined);
      const failedLogin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
      assert.equal(failedLogin.loginChallengeHash, null);
      assert.equal(failedLogin.loginCodeHash, null);
      assert.equal(failedLogin.loginChallengeExpiresAt, null);
    } finally {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      if (smtp.listening) await new Promise<void>((resolve) => smtp.close(() => resolve()));
      await prisma.$disconnect();
    }
  },
);
