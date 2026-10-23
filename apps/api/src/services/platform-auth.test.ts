import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
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
  }));
  replace(prisma.platformAdmin, "update", () => {
    assert.fail("must not persist an unusable challenge");
  });
  await assert.rejects(
    platformLogin({ email: "admin@example.test", password }),
    (error: unknown) => error instanceof HttpError && error.code === "EMAIL_NOT_CONFIGURED",
  );
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
