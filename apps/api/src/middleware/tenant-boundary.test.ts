import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.JWT_SECRET = "tenant-boundary-unit-test-secret";
const { auth } = await import("./auth.js");
const { prisma } = await import("../lib/prisma.js");
const { signAccessToken } = await import("../lib/tokens.js");
const { currentScope } = await import("../lib/tenant-context.js");
const { HttpError } = await import("../lib/http-error.js");
const { forceSignOut } = await import("../services/auth.service.js");

const restores: Array<() => void> = [];
function replace(target: object, key: string, value: unknown) {
  const record = target as Record<string, unknown>;
  const original = record[key];
  record[key] = value;
  restores.push(() => {
    record[key] = original;
  });
}
afterEach(() =>
  restores
    .splice(0)
    .reverse()
    .forEach((restore) => restore()),
);

describe("tenant authentication boundary", () => {
  let userReads = 0;
  let tenantReads = 0;
  beforeEach(() => {
    userReads = 0;
    tenantReads = 0;
    replace(prisma.user, "findUnique", async () => {
      userReads++;
      return {
        id: "owner",
        tenantId: "company-a",
        email: "owner@example.test",
        name: "Owner",
        globalRole: "SUPER_ADMIN",
        tokenVersion: 0,
        disabled: false,
        twoFactorEnabled: true,
      };
    });
    replace(prisma.tenant, "findUnique", async () => {
      tenantReads++;
      return { id: "company-a", name: "A", slug: "a", status: "ACTIVE", subscriptions: [] };
    });
  });

  async function authenticate(tenantId?: string, realm = "web") {
    const { token } = signAccessToken({
      id: "owner",
      email: "owner@example.test",
      globalRole: "SUPER_ADMIN",
      realm: realm as "web",
      tokenVersion: 0,
      ...(tenantId === undefined ? {} : { tenantId }),
    });
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    let error: unknown;
    let scope: ReturnType<typeof currentScope>;
    await auth(
      req,
      {} as Response,
      ((value?: unknown) => {
        error = value;
        scope = currentScope();
      }) as NextFunction,
    );
    return { error, scope, user: req.user };
  }

  it("enters the matching company scope", async () => {
    const result = await authenticate("company-a");
    assert.equal(result.error, undefined);
    assert.equal(result.user?.tenantId, "company-a");
    assert.deepEqual(result.scope, { kind: "tenant", tenantId: "company-a", actorId: "owner" });
  });
  it("rejects a foreign company claim before reading its data", async () => {
    const result = await authenticate("company-b");
    assert.ok(result.error instanceof HttpError);
    assert.equal(result.error.code, "SESSION_INVALIDATED");
    assert.equal(tenantReads, 0);
    assert.equal(result.user, undefined);
  });
  it("keeps legacy tokens scoped to the user's own company", async () => {
    const result = await authenticate();
    assert.equal(result.error, undefined);
    assert.equal(result.user?.tenantId, "company-a");
  });
  it("rejects a platform realm before any user lookup", async () => {
    const result = await authenticate(undefined, "platform");
    assert.ok(result.error instanceof HttpError);
    assert.equal(result.error.code, "REALM_NOT_SUPPORTED");
    assert.equal(userReads, 0);
    assert.equal(tenantReads, 0);
  });
});

describe("company-owner session revocation", () => {
  let refreshWrites = 0;
  let userWrites = 0;
  beforeEach(() => {
    refreshWrites = 0;
    userWrites = 0;
    const tx = {
      user: {
        updateMany: async ({ where }: { where: { id: string; tenantId: string } }) => {
          assert.equal(currentScope()?.kind, "tenant");
          assert.equal(where.tenantId, "company-a");
          if (where.id !== "own-user") return { count: 0 };
          userWrites++;
          return { count: 1 };
        },
      },
      refreshToken: {
        updateMany: async ({
          where,
        }: {
          where: { userId: string; user: { tenantId: string }; revokedAt: null };
        }) => {
          assert.deepEqual(where, {
            userId: "own-user",
            user: { tenantId: "company-a" },
            revokedAt: null,
          });
          refreshWrites++;
          return { count: 1 };
        },
      },
    };
    replace(prisma, "$transaction", async (callback: (client: typeof tx) => Promise<void>) =>
      callback(tx),
    );
  });
  it("revokes an own-company user within a transaction", async () => {
    await forceSignOut({ userId: "own-user" }, "company-a");
    assert.equal(userWrites, 1);
    assert.equal(refreshWrites, 1);
  });
  it("does not mutate a foreign or missing user or their refresh tokens", async () => {
    for (const userId of ["foreign-user", "missing-user"]) {
      await assert.rejects(
        forceSignOut({ userId }, "company-a"),
        (error: unknown) => error instanceof HttpError && error.statusCode === 404,
      );
    }
    assert.equal(userWrites, 0);
    assert.equal(refreshWrites, 0);
  });
  it("requires an explicit company context", async () => {
    await assert.rejects(
      forceSignOut({ userId: "own-user" }, ""),
      (error: unknown) => error instanceof HttpError && error.code === "TENANT_CONTEXT_REQUIRED",
    );
    assert.equal(userWrites, 0);
    assert.equal(refreshWrites, 0);
  });
});
