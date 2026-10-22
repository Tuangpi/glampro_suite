import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adminPasswordSchema, loginResultSchema, twoFactorVerifySchema } from "./auth.js";
import { createStaffSchema } from "./staff.js";

describe("authentication security contracts", () => {
  it("distinguishes a challenge from a session and rejects the old empty-token payload", () => {
    assert.equal(
      loginResultSchema.safeParse({ requiresTwoFactor: true, challenge: "a".repeat(64) }).success,
      true,
    );
    assert.equal(
      loginResultSchema.safeParse({ accessToken: "", refreshToken: "", expiresIn: 0 }).success,
      false,
    );
  });
  it("requires a password-bound challenge and numeric code", () => {
    const input = { email: "owner@studio.sg", challenge: "a".repeat(64), code: "012345" };
    assert.equal(twoFactorVerifySchema.safeParse(input).success, true);
    assert.equal(
      twoFactorVerifySchema.safeParse({ ...input, challenge: undefined }).success,
      false,
    );
    assert.equal(twoFactorVerifySchema.safeParse({ ...input, code: "abcdef" }).success, false);
  });
  it("requires stronger credentials for new owners without changing staff policy", () => {
    const input = {
      name: "Owner",
      email: "owner@studio.sg",
      password: "secret123",
      globalRole: "SUPER_ADMIN",
    };
    assert.equal(createStaffSchema.safeParse(input).success, false);
    assert.equal(
      createStaffSchema.safeParse({ ...input, password: "a-private-long-passphrase" }).success,
      true,
    );
    assert.equal(createStaffSchema.safeParse({ ...input, globalRole: "STAFF" }).success, true);
    assert.equal(adminPasswordSchema.safeParse("password12345").success, false);
  });
});
