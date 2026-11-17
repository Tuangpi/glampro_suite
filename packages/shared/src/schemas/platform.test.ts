import assert from "node:assert/strict";
import { test } from "node:test";
import {
  platformLoginSchema,
  platformVerifySchema,
  platformAdminSchema,
  platformLoginResultSchema,
  platformPasswordChangeSchema,
  platformTwoFactorDisableSchema,
  createPlatformAdminSchema,
  platformAdminListQuerySchema,
} from "./platform.js";

test("admin creation validates and normalizes public input without accepting privileges", () => {
  const input = {
    name: " Operator ",
    email: " ADMIN@example.test ",
    password: "unique-private-passphrase",
    reason: " Support team ",
  };
  assert.deepEqual(createPlatformAdminSchema.parse(input), {
    ...input,
    name: "Operator",
    email: "admin@example.test",
    reason: "Support team",
  });
  for (const change of [
    { name: " " },
    { email: "invalid" },
    { password: "short" },
    { password: "password12345" },
    { password: "a".repeat(73) },
    { password: "é".repeat(37) },
    { reason: " " },
    { status: "ACTIVE" },
    { twoFactorEnabled: false },
    { actorPlatformAdminId: "other" },
  ])
    assert.equal(createPlatformAdminSchema.safeParse({ ...input, ...change }).success, false);
  assert.deepEqual(platformAdminListQuerySchema.parse({}), { page: 1, pageSize: 20 });
  assert.equal(platformAdminListQuerySchema.safeParse({ page: 0 }).success, false);
});

test("platform credentials and code contracts reject malformed input", () => {
  assert.equal(platformLoginSchema.safeParse({ email: "invalid", password: "" }).success, false);
  assert.equal(
    platformVerifySchema.safeParse({ challenge: "short", code: "123456" }).success,
    false,
  );
  assert.equal(
    platformVerifySchema.safeParse({ challenge: "a".repeat(64), code: "abc123" }).success,
    false,
  );
  assert.equal(
    platformVerifySchema.safeParse({ challenge: "a".repeat(64), code: "123456" }).success,
    true,
  );
});
test("platform public profiles omit credentials and tenant privileges", () => {
  assert.deepEqual(
    platformAdminSchema.parse({
      id: "admin",
      email: "admin@example.test",
      name: "Admin",
      // The sign-in verification state *is* part of the profile: the console needs
      // it to offer the right account control.
      twoFactorEnabled: true,
      passwordHash: "private",
      globalRole: "SUPER_ADMIN",
      tenantId: "foreign",
    }),
    { id: "admin", email: "admin@example.test", name: "Admin", twoFactorEnabled: true },
  );
});
test("sign-in answers with either a challenge or a session, and nothing else", () => {
  const session = {
    accessToken: "token",
    refreshToken: "refresh",
    expiresIn: 900,
    admin: { id: "admin", email: "admin@example.test", name: "Admin", twoFactorEnabled: false },
  };
  assert.equal(platformLoginResultSchema.safeParse(session).success, true);
  assert.equal(
    platformLoginResultSchema.safeParse({ requiresTwoFactor: true, challenge: "a".repeat(64) })
      .success,
    true,
  );
  // A challenge cannot smuggle a session, and a session cannot fake a challenge.
  assert.equal(
    platformLoginResultSchema.safeParse({ requiresTwoFactor: true, accessToken: "token" }).success,
    false,
  );
  assert.equal(platformLoginResultSchema.safeParse({ accessToken: "token" }).success, false);
});
test("operator account contracts demand a strong new password and re-proved fields", () => {
  assert.equal(
    platformPasswordChangeSchema.safeParse({
      currentPassword: "current-passphrase",
      newPassword: "short",
    }).success,
    false,
  );
  assert.equal(
    platformPasswordChangeSchema.safeParse({
      currentPassword: "current-passphrase",
      newPassword: "a-much-longer-operator-passphrase",
    }).success,
    true,
  );
  // Turning verification off must carry the password that guards it.
  assert.equal(platformTwoFactorDisableSchema.safeParse({}).success, false);
  assert.equal(
    platformTwoFactorDisableSchema.safeParse({ currentPassword: "current-passphrase" }).success,
    true,
  );
});
