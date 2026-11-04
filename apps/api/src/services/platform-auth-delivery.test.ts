import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import nodemailer from "nodemailer";

// No database and no mailbox: every persistence and transport call is replaced.
// SMTP is deliberately *configured* here, because that is the path that must send an
// email. `platform-auth.test.ts` covers the unconfigured refusal instead.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.JWT_SECRET = "isolated-platform-auth-delivery-tests";
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "1";
process.env.SMTP_SECURE = "false";
const { prisma } = await import("../lib/prisma.js");
const { hashPassword } = await import("../lib/password.js");
const { hashRefreshToken } = await import("../lib/tokens.js");
const { HttpError } = await import("../lib/http-error.js");
const { platformLogin } = await import("./platform-auth.service.js");

const password = "a-private-operator-passphrase";
const passwordHash = await hashPassword(password);
const admin = {
  id: "platform-admin-delivery",
  email: "operator@glampro.sg",
  status: "ACTIVE" as string,
  passwordHash,
};
let mailText = "";
let mailAttempts = 0;
let mailFails = false;
let persisted: Record<string, unknown> = {};
let cleared: Array<{ where: unknown; data: unknown }> = [];
const logs: string[] = [];
const restore: Array<() => void> = [];
// Prisma delegates are proxies without ordinary method descriptors.
function replace(target: object, key: string, implementation: unknown) {
  const record = target as Record<string, unknown>;
  const original = record[key];
  record[key] = implementation;
  restore.push(() => {
    record[key] = original;
  });
}

beforeEach(() => {
  mailText = "";
  mailAttempts = 0;
  mailFails = false;
  persisted = {};
  cleared = [];
  logs.length = 0;
  mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (input: { text: string }) => {
      mailAttempts++;
      if (mailFails) throw new Error("connect ECONNREFUSED 127.0.0.1:1025");
      mailText = input.text;
      return { messageId: "unit-test" };
    },
  }));
  // Capture stdout so a code printed for convenience on a laptop without SMTP fails here.
  mock.method(console, "log", (...args: unknown[]) => {
    logs.push(
      args.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join(" "),
    );
  });
  replace(prisma.platformAdmin, "findUnique", async () => ({ ...admin }));
  replace(prisma.platformAdmin, "update", async ({ data }: { data: object }) => {
    Object.assign(persisted, data);
    return { ...admin, ...persisted };
  });
  replace(prisma.platformAdmin, "updateMany", async (input: { where: unknown; data: object }) => {
    cleared.push(input);
    return { count: 1 };
  });
});
afterEach(() => {
  restore
    .splice(0)
    .reverse()
    .forEach((undo) => undo());
  mock.restoreAll();
});

describe("operator two-factor delivery", () => {
  it("emails the code and never writes it to application logs", async () => {
    const result = await platformLogin({ email: admin.email, password });

    assert.equal(result.requiresTwoFactor, true);
    assert.equal(mailAttempts, 1);
    const code = mailText.match(/verification code is (\d{6})/)?.[1];
    assert.ok(code, "the verification email must carry the six-digit code");
    // The persisted challenge is the hash of that exact email code, not the code itself.
    assert.equal(persisted.loginCodeHash, hashRefreshToken(`platform:${result.challenge}:${code}`));
    assert.notEqual(persisted.loginCodeHash, code);
    assert.equal(cleared.length, 0);

    const logged = logs.join("\n");
    assert.ok(
      !logged.includes(code),
      "a two-factor code must never be written to application logs",
    );
    assert.doesNotMatch(logged, /platform login code/i);
  });

  it("fails closed with EMAIL_SEND_FAILED and clears the challenge when delivery fails", async () => {
    mailFails = true;
    await assert.rejects(platformLogin({ email: admin.email, password }), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "EMAIL_SEND_FAILED");
      assert.match(error.message, /SMTP server is running/);
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /ECONNREFUSED/);
      return true;
    });

    assert.equal(mailAttempts, 1);
    assert.equal(cleared.length, 1);
    const [attempt] = cleared;
    // Only this attempt is cleared: a newer login may already have replaced it.
    assert.deepEqual(attempt?.where, {
      id: admin.id,
      loginChallengeHash: persisted.loginChallengeHash,
    });
    assert.deepEqual(attempt?.data, {
      loginChallengeHash: null,
      loginCodeHash: null,
      loginChallengeExpiresAt: null,
    });
    assert.doesNotMatch(logs.join("\n"), /platform login code/i);
  });
});
