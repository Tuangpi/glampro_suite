import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { test } from "node:test";

// Explicit opt-in: ordinary test runs must never provision or use acceptance data.
test(
  "SEC-01 real database and loopback SMTP acceptance",
  {
    skip: process.env.SEC01_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55439");
    assert.equal(url.pathname, "/sec01_acceptance");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "sec01-disposable-acceptance-secret";
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_USER = "";
    process.env.SMTP_PASSWORD = "";
    process.env.MAIL_FROM = "acceptance@sec01.test";

    // Minimal capture-only SMTP server. No forwarding, external connections or files.
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
    const http = createApp().listen(0, "127.0.0.1");
    await once(http, "listening");
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api/auth`;
    const password = "disposable-acceptance-passphrase";
    const tenantId = "sec01-acceptance-tenant";
    const owner = "owner@sec01.test";
    const staff = "staff@sec01.test";
    async function post(path: string, body: object, token?: string) {
      const response = await fetch(`${base}/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    function code() {
      const captured = messages.at(-1)?.match(/verification code is (\d{6})/);
      assert.ok(captured, "a six-digit code must arrive through loopback SMTP");
      return captured[1];
    }
    async function me(token: string) {
      return fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } });
    }
    try {
      await runAsPlatform(async () => {
        await prisma.tenant.create({
          data: { id: tenantId, name: "SEC-01 acceptance", slug: tenantId },
        });
        const passwordHash = await hashPassword(password);
        for (const [email, globalRole] of [
          [owner, "SUPER_ADMIN"],
          [staff, "STAFF"],
        ] as const) {
          await prisma.user.create({
            data: { tenantId, email, name: globalRole, globalRole, passwordHash },
          });
        }
      });
      const challenge = await post("login", { email: owner, password });
      assert.equal(challenge.status, 200);
      assert.equal(challenge.body.data.requiresTwoFactor, true);
      assert.equal(challenge.body.data.accessToken, undefined);
      const verify = { email: owner, challenge: challenge.body.data.challenge, code: code() };
      const stored = await runAsPlatform(() =>
        prisma.user.findUniqueOrThrow({ where: { email: owner } }),
      );
      assert.notEqual(stored.twoFactorCode, verify.code, "codes must not be stored in plaintext");
      const verified = await post("two-factor/verify-login", verify);
      assert.equal(verified.status, 200);
      const token = verified.body.data.accessToken;
      assert.equal((await me(token)).status, 200);
      assert.equal((await post("two-factor/verify-login", verify)).status, 401);
      assert.equal((await post("two-factor/disable", {}, token)).status, 403);
      assert.equal(
        (
          await post(
            "change-password",
            { currentPassword: password, newPassword: "admin12345" },
            token,
          )
        ).status,
        422,
      );
      assert.equal(
        (
          await post(
            "change-password",
            { currentPassword: password, newPassword: "replacement-owner-passphrase" },
            token,
          )
        ).status,
        200,
      );
      assert.equal((await me(token)).status, 401);
      assert.equal(
        (await post("refresh", { refreshToken: verified.body.data.refreshToken })).status,
        401,
      );
      const session = await post("login", { email: staff, password });
      assert.equal(session.status, 200);
      const staffToken = session.body.data.accessToken;
      assert.ok(staffToken);
      assert.equal((await post("two-factor/enable", {}, staffToken)).status, 200);
      const enrollmentCode = code();
      assert.equal(
        (await post("two-factor/confirm", { code: enrollmentCode }, staffToken)).status,
        200,
      );
      assert.equal(
        (await post("two-factor/confirm", { code: enrollmentCode }, staffToken)).status,
        401,
      );
      const staffChallenge = await post("login", { email: staff, password });
      assert.equal(staffChallenge.body.data.requiresTwoFactor, true);
      assert.equal(
        (
          await post("two-factor/verify-login", {
            email: staff,
            challenge: staffChallenge.body.data.challenge,
            code: code(),
          })
        ).status,
        200,
      );
      assert.equal((await post("two-factor/disable", {}, staffToken)).status, 200);
      assert.equal(messages.length, 3);
    } finally {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await runAsPlatform(() => prisma.tenant.deleteMany({ where: { id: tenantId } }));
      await prisma.$disconnect();
      await new Promise<void>((resolve) => smtp.close(() => resolve()));
    }
  },
);
