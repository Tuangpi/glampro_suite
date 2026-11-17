import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import jwt from "jsonwebtoken";
import express from "express";

process.env.JWT_SECRET = "platform-admin-test-secret";
const { prisma } = await import("../lib/prisma.js");
const { platformAdminRouter } = await import("./platform-admin.routes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { verifyPassword } = await import("../lib/password.js");
const app = express();
app.use(express.json());
app.use("/api/platform/admins", platformAdminRouter);
app.use(errorHandler);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
after(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/platform/admins`;
const input = {
  name: "New admin",
  email: "NEW@example.test",
  password: "unique-private-passphrase",
  reason: "Support coverage",
};
const directory = {
  id: "new-admin",
  name: input.name,
  email: "new@example.test",
  status: "ACTIVE",
  twoFactorEnabled: true,
  createdAt: new Date(),
  lastLoginAt: null,
};
const token = jwt.sign(
  { realm: "platform", sessionId: "session", tokenVersion: 0 },
  process.env.JWT_SECRET,
  {
    algorithm: "HS256",
    issuer: "glampro-api",
    audience: "glampro-platform",
    subject: "actor",
    expiresIn: 300,
  },
);
async function call(method = "GET", body?: object, bearer: string | null = token, suffix = "") {
  return fetch(`${base}${suffix}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("platform admin HTTP authorization, validation, creation, projection and audit", async () => {
  const savedSession = prisma.platformSession.findUnique;
  const savedTransaction = prisma.$transaction;
  const savedMany = prisma.platformAdmin.findMany;
  const savedCount = prisma.platformAdmin.count;
  let status = "ACTIVE";
  let duplicate = false;
  let actorActive = true;
  let auditFails = false;
  let uniqueFails = false;
  let created = 0;
  let audited = 0;
  try {
    Object.assign(prisma.platformSession, {
      findUnique: async () => ({
        id: "session",
        adminId: "actor",
        tokenVersion: 0,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        admin: {
          id: "actor",
          email: "actor@example.test",
          name: "Actor",
          status,
          tokenVersion: 0,
          twoFactorEnabled: true,
        },
      }),
    });
    Object.assign(prisma.platformAdmin, {
      findMany: async (args: { select: Record<string, boolean>; skip: number }) => {
        assert.equal(args.select.passwordHash, undefined);
        assert.equal(args.select.loginCodeHash, undefined);
        assert.equal(args.skip, 20);
        return [directory];
      },
      count: async () => 21,
    });
    Object.assign(prisma, {
      $transaction: async (operation: unknown) => {
        if (Array.isArray(operation)) return Promise.all(operation);
        return (operation as (tx: object) => Promise<unknown>)({
          $queryRaw: async () => [],
          platformAdmin: {
            findUnique: async () => ({ status: actorActive ? "ACTIVE" : "DISABLED" }),
            findFirst: async () => (duplicate ? { id: "existing" } : null),
            create: async (args: {
              data: { passwordHash: string; email: string; twoFactorEnabled: boolean };
              select: Record<string, boolean>;
            }) => {
              if (uniqueFails) throw { code: "P2002" };
              assert.equal(args.data.email, "new@example.test");
              assert.equal(args.data.twoFactorEnabled, true);
              assert.equal(await verifyPassword(input.password, args.data.passwordHash), true);
              assert.equal(args.select.passwordHash, undefined);
              created++;
              return directory;
            },
          },
          auditLog: {
            create: async (args: { data: Record<string, unknown> }) => {
              if (auditFails) throw new Error("audit unavailable");
              assert.deepEqual(args.data, {
                actorPlatformAdminId: "actor",
                action: "platform.admin.create",
                targetType: "PlatformAdmin",
                targetId: "new-admin",
                metadata: { reason: input.reason, source: "platform-console" },
              });
              assert.equal(JSON.stringify(args).includes(input.password), false);
              audited++;
            },
          },
        });
      },
    });
    for (const method of ["GET", "POST"]) {
      assert.equal((await call(method, method === "POST" ? input : undefined, null)).status, 401);
      assert.equal(
        (
          await call(
            method,
            method === "POST" ? input : undefined,
            jwt.sign({ realm: "web" }, process.env.JWT_SECRET!),
          )
        ).status,
        401,
      );
    }
    status = "DISABLED";
    assert.equal((await call()).status, 401);
    status = "ACTIVE";
    assert.equal((await call("GET", undefined, token, "?page=0")).status, 422);
    const list = await call("GET", undefined, token, "?page=2&pageSize=20&search=new");
    assert.equal(list.status, 200);
    assert.match(list.headers.get("cache-control") ?? "", /no-store/);
    const payload = await list.json();
    assert.equal(payload.data.total, 21);
    assert.equal(payload.data.items[0].passwordHash, undefined);
    assert.equal((await call("POST", { ...input, twoFactorEnabled: false })).status, 422);
    assert.equal((await call("POST", { ...input, password: "short" })).status, 422);
    const response = await call("POST", input);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.data.email, "new@example.test");
    assert.equal(body.data.passwordHash, undefined);
    assert.equal(created, 1);
    assert.equal(audited, 1);
    duplicate = true;
    assert.equal((await call("POST", input)).status, 409);
    assert.equal(created, 1);
    duplicate = false;
    actorActive = false;
    assert.equal((await call("POST", input)).status, 401);
    actorActive = true;
    uniqueFails = true;
    assert.equal((await call("POST", input)).status, 409);
    uniqueFails = false;
    auditFails = true;
    assert.equal((await call("POST", input)).status, 500);
    assert.equal(audited, 1, "audit failure must fail the request, not return successful creation");
  } finally {
    prisma.platformSession.findUnique = savedSession;
    prisma.$transaction = savedTransaction;
    prisma.platformAdmin.findMany = savedMany;
    prisma.platformAdmin.count = savedCount;
  }
});
