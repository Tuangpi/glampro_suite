import assert from "node:assert/strict";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "../types/index.js";

// `middleware/auth.ts` imports the token library, which fails fast on missing
// configuration at import time, so the required variables are provided first.
// No database is contacted: these guards only read `req.user`.
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "middleware-test-secret";
process.env.NODE_ENV = "test";

const { requireRole, requireWritableTenant } = await import("./auth.js");
const { HttpError } = await import("../lib/http-error.js");

/** Runs a guard and reports which way it went. */
function run(
  handler: RequestHandler,
  user?: AuthenticatedUser,
): { next: boolean; error?: unknown } {
  const req = { user } as unknown as Request;
  const res = {} as Response;
  let outcome: { next: boolean; error?: unknown } = { next: false };

  handler(req, res, ((error?: unknown) => {
    outcome = error === undefined ? { next: true } : { next: false, error };
  }) as NextFunction);

  return outcome;
}

function principal(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "user_1",
    tenantId: "tenant_1",
    email: "a@b.test",
    name: "A",
    globalRole: "STAFF",
    realm: "web",
    tokenVersion: 0,
    tenantStatus: "ACTIVE",
    twoFactorEnabled: false,
    ...overrides,
  };
}

describe("requireRole", () => {
  it("refuses an unauthenticated request", () => {
    const { next, error } = run(requireRole("MANAGER"), undefined);

    assert.equal(next, false);
    assert.ok(error instanceof HttpError && error.statusCode === 401);
  });

  it("refuses a role outside the list", () => {
    const { next, error } = run(requireRole("MANAGER"), principal({ globalRole: "STAFF" }));

    assert.equal(next, false);
    assert.ok(error instanceof HttpError && error.statusCode === 403);
  });

  it("admits a role in the list", () => {
    const { next, error } = run(
      requireRole("MANAGER", "STAFF"),
      principal({ globalRole: "STAFF" }),
    );

    assert.equal(next, true);
    assert.equal(error, undefined);
  });
});

describe("requireWritableTenant", () => {
  it("refuses an unauthenticated request", () => {
    const { next, error } = run(requireWritableTenant(), undefined);

    assert.equal(next, false);
    assert.ok(error instanceof HttpError && error.statusCode === 401);
  });

  it("admits an active salon", () => {
    const { next, error } = run(requireWritableTenant(), principal({ tenantStatus: "ACTIVE" }));

    assert.equal(next, true);
    assert.equal(error, undefined);
  });

  it("admits a principal with no status, which is a platform session", () => {
    const { next } = run(requireWritableTenant(), principal({ tenantStatus: undefined }));

    assert.equal(next, true);
  });

  it("refuses a suspended salon with the code the UI keys off", () => {
    const { next, error } = run(requireWritableTenant(), principal({ tenantStatus: "SUSPENDED" }));

    assert.equal(next, false);
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, "TENANT_SUSPENDED");
  });

  it("refuses an expired or cancelled salon outright", () => {
    for (const status of ["EXPIRED", "CANCELLED"] as const) {
      const { next, error } = run(requireWritableTenant(), principal({ tenantStatus: status }));

      assert.equal(next, false);
      assert.ok(error instanceof HttpError && error.statusCode === 403);
    }
  });
});
