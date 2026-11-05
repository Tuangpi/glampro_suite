import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACCESS_TOKEN_TTL_SECONDS, MAX_PAGE_SIZE } from "../constants.js";
import { paginationQuerySchema } from "./common.js";
import { authSessionSchema, loginSchema } from "./auth.js";

describe("loginSchema", () => {
  it("defaults the realm to the web portal", () => {
    const parsed = loginSchema.parse({ email: "owner@glampro.test", password: "secret" });
    assert.equal(parsed.realm, "web");
  });

  it("rejects malformed email addresses", () => {
    assert.equal(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success, false);
  });

  it("rejects unknown realms", () => {
    const result = loginSchema.safeParse({
      email: "owner@glampro.test",
      password: "x",
      realm: "fax",
    });
    assert.equal(result.success, false);
  });
});

describe("paginationQuerySchema", () => {
  it("coerces query-string values and applies defaults", () => {
    assert.deepEqual(paginationQuerySchema.parse({}), { page: 1, pageSize: 20 });
    assert.deepEqual(paginationQuerySchema.parse({ page: "3", pageSize: "50" }), {
      page: 3,
      pageSize: 50,
    });
  });

  it("caps pageSize", () => {
    assert.equal(paginationQuerySchema.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success, false);
  });
});

describe("authSessionSchema", () => {
  it("accepts a session payload", () => {
    const session = {
      accessToken: "a",
      refreshToken: "r",
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: {
        id: "u1",
        name: "Ava Owner",
        email: "owner@glampro.test",
        globalRole: "MANAGER",
        twoFactorEnabled: true,
      },
    };
    assert.deepEqual(authSessionSchema.parse(session), session);
  });

  it("requires the second-factor flag, so a screen cannot guess it", () => {
    const result = authSessionSchema.safeParse({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: { id: "u1", name: "Ava Owner", email: "owner@glampro.test", globalRole: "MANAGER" },
    });
    assert.equal(result.success, false);
  });
});
