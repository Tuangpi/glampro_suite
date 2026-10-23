import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { test } from "node:test";

test(
  "SAAS-03 real company onboarding and isolation",
  {
    skip: process.env.SAAS03_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55441");
    assert.equal(url.pathname, "/saas03_acceptance");
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
    process.env.SALON_PORTAL_ORIGIN = "http://localhost:5173";
    const { createApp } = await import("../app.js");
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform } = await import("../lib/tenant-context.js");
    const { hashPassword } = await import("../lib/password.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createCompany } = await import("../services/company.service.js");
    const http = createApp().listen(0, "127.0.0.1");
    await once(http, "listening");
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api`;
    const suffix = String(Date.now());
    const password = "disposable-owner-passphrase";
    async function call(path: string, body?: object, token?: string) {
      const response = await fetch(`${base}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    function inviteToken() {
      // MIME HTML/plain text may soft-wrap; the plain link is short enough here.
      const match = messages
        .at(-1)
        ?.replace(/=\r\n/g, "")
        .match(/accept-invitation#([A-Za-z0-9_-]{43})/);
      assert.ok(match, "capture-only SMTP must receive invitation link");
      return match[1];
    }
    try {
      await prisma.module.upsert({
        where: { code: "customers" },
        update: { isCore: true },
        create: { code: "customers", name: "Customers", category: "Core", isCore: true },
      });
      const hash = await hashPassword(password);
      const operatorEmail = `operator-${suffix}@saas03.test`;
      await prisma.platformAdmin.create({
        data: { email: operatorEmail, name: "Operator", passwordHash: hash },
      });
      const challenge = await call("/platform/auth/login", { email: operatorEmail, password });
      const code = messages.at(-1)?.match(/verification code is (\d{6})/)?.[1];
      const verified = await call("/platform/auth/verify", {
        challenge: challenge.body.data.challenge,
        code,
      });
      assert.equal(verified.status, 200);
      const platformToken = verified.body.data.accessToken;
      const a = {
        name: "Company A",
        slug: `company-a-${suffix}`,
        ownerName: "Owner A",
        ownerEmail: `owner-a-${suffix}@saas03.test`,
      };
      const b = {
        name: "Company B",
        slug: `company-b-${suffix}`,
        ownerName: "Owner B",
        ownerEmail: `owner-b-${suffix}@saas03.test`,
      };
      assert.equal((await call("/platform/companies")).status, 401);
      assert.equal(
        (await call("/platform/companies", { ...a, globalRole: "SUPER_ADMIN" }, platformToken))
          .status,
        422,
      );
      const createdA = await call("/platform/companies", a, platformToken);
      assert.equal(createdA.status, 201);
      assert.equal(createdA.body.data.invitationDelivery, "sent");
      const tokenA = inviteToken();
      const companyA = createdA.body.data.company;
      assert.equal(companyA.owner.disabled, true);
      assert.equal(JSON.stringify(createdA.body).includes(tokenA), false);
      assert.equal((await call("/auth/login", { email: a.ownerEmail, password })).status, 401);
      const createdB = await call("/platform/companies", b, platformToken);
      assert.equal(createdB.status, 201);
      const tokenB = inviteToken();
      const companyB = createdB.body.data.company;
      const before = await prisma.tenant.count();
      assert.equal(
        (
          await call(
            "/platform/companies",
            { ...a, ownerEmail: `other-${suffix}@saas03.test` },
            platformToken,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await call(
            "/platform/companies",
            { ...b, slug: `duplicate-email-${suffix}` },
            platformToken,
          )
        ).status,
        409,
      );
      assert.equal(
        await prisma.tenant.count(),
        before,
        "duplicate owner must roll back inserted company",
      );
      await assert.rejects(
        createCompany(
          { ...a, slug: `rollback-${suffix}`, ownerEmail: `rollback-${suffix}@saas03.test` },
          "missing-operator",
        ),
      );
      assert.equal(
        await prisma.tenant.count(),
        before,
        "audit failure must roll back company/user/invitation",
      );
      assert.equal(
        await runAsPlatform(() =>
          prisma.user.count({ where: { email: `rollback-${suffix}@saas03.test` } }),
        ),
        0,
      );
      const listed = await call(
        `/platform/companies?search=${suffix}&pageSize=1`,
        undefined,
        platformToken,
      );
      assert.equal(listed.status, 200);
      assert.equal(listed.body.data.total, 2);
      assert.equal(listed.body.data.items.length, 1);
      const detail = await call(`/platform/companies/${companyA.id}`, undefined, platformToken);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.data.owner.email, a.ownerEmail);
      assert.equal(JSON.stringify(detail.body).includes("tokenHash"), false);
      const resend = await call(`/platform/companies/${companyA.id}/invitation`, {}, platformToken);
      assert.equal(resend.status, 200);
      const replacement = inviteToken();
      assert.notEqual(replacement, tokenA);
      assert.equal(
        (await call("/owner-invitations/accept", { token: tokenA, password })).status,
        400,
      );
      assert.equal(
        (await call("/owner-invitations/accept", { token: replacement, password: "short" })).status,
        422,
      );
      const accepted = await Promise.all([
        call("/owner-invitations/accept", { token: replacement, password }),
        call("/owner-invitations/accept", { token: replacement, password }),
      ]);
      assert.deepEqual(accepted.map((r) => r.status).sort(), [200, 400]);
      assert.equal(
        (await call("/owner-invitations/accept", { token: replacement, password })).status,
        400,
      );
      assert.equal(
        (await call(`/platform/companies/${companyA.id}/invitation`, {}, platformToken)).status,
        409,
      );
      const login = await call("/auth/login", { email: a.ownerEmail, password });
      assert.equal(login.status, 200);
      assert.equal(login.body.data.requiresTwoFactor, true);
      const ownerCode = messages.at(-1)?.match(/verification code is (\d{6})/)?.[1];
      const ownerSession = await call("/auth/two-factor/verify-login", {
        email: a.ownerEmail,
        challenge: login.body.data.challenge,
        code: ownerCode,
      });
      assert.equal(ownerSession.status, 200);
      const ownerToken = ownerSession.body.data.accessToken;
      assert.equal((await call("/platform/companies", undefined, ownerToken)).status, 401);
      assert.equal(
        (await call(`/platform/companies/${companyB.id}`, undefined, ownerToken)).status,
        401,
      );
      await runAsPlatform(async () => {
        await prisma.customer.create({
          data: { tenantId: companyA.id, name: "A private customer" },
        });
        await prisma.customer.create({
          data: { tenantId: companyB.id, name: "B private customer" },
        });
      });
      const customers = await call("/customers", undefined, ownerToken);
      assert.equal(customers.status, 200);
      assert.ok(JSON.stringify(customers.body).includes("A private customer"));
      assert.ok(!JSON.stringify(customers.body).includes("B private customer"));
      const foreignToken = signAccessToken({
        id: companyA.owner.id,
        email: a.ownerEmail,
        globalRole: "SUPER_ADMIN",
        realm: "web",
        tenantId: companyB.id,
        tokenVersion: 1,
      }).token;
      assert.equal((await call("/customers", undefined, foreignToken)).status, 401);
      await runAsPlatform(() =>
        prisma.ownerInvitation.updateMany({
          where: { tenantId: companyB.id },
          data: { expiresAt: new Date(0) },
        }),
      );
      assert.equal(
        (await call("/owner-invitations/accept", { token: tokenB, password })).status,
        400,
      );
      assert.equal(
        (await call("/owner-invitations/accept", { token: "z".repeat(43), password })).status,
        400,
      );
      const pending = await runAsPlatform(() =>
        prisma.user.findUniqueOrThrow({ where: { id: companyB.owner.id } }),
      );
      assert.equal(pending.disabled, true);
      const audit = await prisma.auditLog.findMany({ where: { tenantId: companyA.id } });
      assert.ok(audit.some((row) => row.action === "company.owner_invitation.accept"));
      assert.ok(!JSON.stringify(audit).includes(replacement));
      // SMTP failure is a delivery failure, not a rollback or duplicate-create instruction.
      await new Promise<void>((resolve) => smtp.close(() => resolve()));
      const failed = await call(
        "/platform/companies",
        { ...a, slug: `mail-failed-${suffix}`, ownerEmail: `mail-failed-${suffix}@saas03.test` },
        platformToken,
      );
      assert.equal(failed.status, 201);
      assert.equal(failed.body.data.invitationDelivery, "failed");
      assert.equal(failed.body.data.company.owner.disabled, true);
    } finally {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      if (smtp.listening) await new Promise<void>((resolve) => smtp.close(() => resolve()));
      await prisma.$disconnect();
    }
  },
);
