import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.JWT_SECRET = "platform-auth-unit-test";
// Empty prevents dotenv from restoring the developer's real SMTP setting.
process.env.SMTP_HOST = "";
const { prisma } = await import("../lib/prisma.js");
const { hashPassword } = await import("../lib/password.js");
const { HttpError } = await import("../lib/http-error.js");
const { platformLogin } = await import("./platform-auth.service.js");
const restore: Array<() => void> = [];
function replace(target: object, key: string, value: unknown) {
  const record = target as Record<string, unknown>;
  const original = record[key];
  record[key] = value;
  restore.push(() => {
    record[key] = original;
  });
}
afterEach(() =>
  restore
    .splice(0)
    .reverse()
    .forEach((undo) => undo()),
);

test("operator login fails closed without SMTP and does not issue a challenge", async () => {
  const password = "private-unit-passphrase";
  const passwordHash = await hashPassword(password);
  replace(prisma.platformAdmin, "findUnique", async () => ({
    id: "admin",
    status: "ACTIVE",
    passwordHash,
    // Verification on: this operator is the one the SMTP refusal protects.
    twoFactorEnabled: true,
  }));
  replace(prisma.platformAdmin, "update", () => {
    assert.fail("must not persist an unusable challenge");
  });
  await assert.rejects(
    platformLogin({ email: "admin@example.test", password }),
    (error: unknown) => error instanceof HttpError && error.code === "EMAIL_NOT_CONFIGURED",
  );
});

test("issues a session without any code when the operator turned verification off", async () => {
  const password = "private-unit-passphrase";
  const passwordHash = await hashPassword(password);
  const record = {
    id: "admin",
    email: "admin@example.test",
    name: "Admin",
    status: "ACTIVE",
    passwordHash,
    tokenVersion: 4,
    twoFactorEnabled: false,
  };
  replace(prisma.platformAdmin, "findUnique", async () => record);
  const audited: Array<{ data: { action: string } }> = [];
  const sessions: Array<{ data: { adminId: string } }> = [];
  replace(prisma, "$transaction", (callback: (tx: object) => Promise<unknown>) =>
    callback({
      platformAdmin: { update: async () => record },
      platformSession: {
        create: async (input: { data: { adminId: string } }) => {
          sessions.push(input);
          return { id: "session-one" };
        },
      },
      auditLog: {
        create: async (input: { data: { action: string } }) => {
          audited.push(input);
          return {};
        },
      },
    }),
  );
  const result = await platformLogin({ email: record.email, password });
  if ("requiresTwoFactor" in result)
    assert.fail("no code is emailed when the operator turned verification off");
  assert.equal(result.admin.twoFactorEnabled, false);
  assert.equal(sessions[0]?.data.adminId, "admin");
  // The same audit trail as a verified sign-in: the password check is the proof.
  assert.equal(audited[0]?.data.action, "platform.login");
});
test("unknown and disabled operators receive the same credentials error", async () => {
  const password = "private-unit-passphrase";
  const passwordHash = await hashPassword(password);
  for (const admin of [null, { id: "admin", status: "DISABLED", passwordHash }]) {
    replace(prisma.platformAdmin, "findUnique", async () => admin);
    await assert.rejects(
      platformLogin({ email: "admin@example.test", password }),
      (error: unknown) => error instanceof HttpError && error.code === "INVALID_CREDENTIALS",
    );
  }
});
