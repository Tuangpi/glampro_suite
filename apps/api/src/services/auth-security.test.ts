import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import nodemailer from "nodemailer";

// No database or external mail: every persistence call used below is replaced.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.JWT_SECRET = "isolated-auth-security-unit-tests";
delete process.env.SMTP_HOST;
const { prisma } = await import("../lib/prisma.js");
const { hashPassword } = await import("../lib/password.js");
const { hashRefreshToken } = await import("../lib/tokens.js");
const {
  login,
  refresh,
  verifyTwoFactorForLogin,
  enableTwoFactor,
  confirmTwoFactor,
  disableTwoFactor,
  changePassword,
} = await import("./auth.service.js");
const password = "a-private-owner-passphrase";
const passwordHash = await hashPassword(password);
const user = {
  id: "security-owner",
  tenantId: "security-tenant",
  name: "Owner",
  email: "owner@studio.sg",
  globalRole: "SUPER_ADMIN" as string,
  passwordHash,
  disabled: false,
  tokenVersion: 0,
  twoFactorEnabled: false,
  twoFactorCode: null as string | null,
  twoFactorCodeExpiresAt: null as Date | null,
};
let mailText = "";
let consumed = false;
let sessionsIssued = 0;
let credentialWrites = 0;
let mailFails = false;
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
  user.globalRole = "SUPER_ADMIN";
  user.disabled = false;
  user.twoFactorEnabled = false;
  user.twoFactorCode = null;
  user.twoFactorCodeExpiresAt = null;
  consumed = false;
  sessionsIssued = 0;
  credentialWrites = 0;
  mailFails = false;
  mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (input: { text: string }) => {
      if (mailFails) throw new Error("Mail delivery failed");
      mailText = input.text;
      return { messageId: "unit-test" };
    },
  }));
  replace(prisma.user, "findUnique", async () => ({ ...user }));
  replace(prisma.user, "update", async ({ data }: { data: object }) => {
    credentialWrites++;
    Object.assign(user, data);
    return { ...user };
  });
  replace(prisma.user, "updateMany", async ({ data }: { data: object }) => {
    if (consumed) return { count: 0 };
    consumed = true;
    Object.assign(user, data);
    return { count: 1 };
  });
  replace(prisma.tenant, "findUnique", async () => ({ status: "ACTIVE", subscriptions: [] }));
  replace(prisma.refreshToken, "create", async () => {
    sessionsIssued++;
    return { id: "unit-refresh" };
  });
});
afterEach(() => {
  restore
    .splice(0)
    .reverse()
    .forEach((undo) => undo());
  mock.restoreAll();
});

async function challengeLogin() {
  const result = await login({ email: user.email, password, realm: "web" }, {});
  assert.ok("requiresTwoFactor" in result);
  const code = mailText.match(/code is (\d{6})/)?.[1];
  assert.ok(code);
  return { email: user.email, challenge: result.challenge, code };
}

describe("email-code authentication security", () => {
  it("issues no session when verification email fails", async () => {
    mailFails = true;
    await assert.rejects(
      login({ email: user.email, password, realm: "web" }, {}),
      /Mail delivery failed/,
    );
    assert.equal(sessionsIssued, 0);
  });

  it("requires owner verification before issuing tokens and enrolls on success", async () => {
    const input = await challengeLogin();
    assert.equal(sessionsIssued, 0);
    const result = await verifyTwoFactorForLogin(input, {});
    assert.ok(result.accessToken);
    assert.ok(result.refreshToken);
    assert.equal(user.twoFactorEnabled, true);
    assert.equal(user.twoFactorCode, null);
  });

  it("rejects a challenge from another password-verified attempt", async () => {
    const first = await challengeLogin();
    const second = await challengeLogin();
    await assert.rejects(
      verifyTwoFactorForLogin({ ...second, challenge: first.challenge }, {}),
      /not right/,
    );
  });

  it("rejects wrong, expired and disabled-account verification", async () => {
    const input = await challengeLogin();
    const wrong = input.code === "000000" ? "111111" : "000000";
    await assert.rejects(verifyTwoFactorForLogin({ ...input, code: wrong }, {}), /not right/);
    user.twoFactorCodeExpiresAt = new Date(0);
    await assert.rejects(verifyTwoFactorForLogin(input, {}), /expired/);
    user.disabled = true;
    await assert.rejects(verifyTwoFactorForLogin(input, {}), /no longer valid/);
  });

  it("issues only one session for concurrent verification of the same code", async () => {
    const input = await challengeLogin();
    const results = await Promise.allSettled([
      verifyTwoFactorForLogin(input, {}),
      verifyTwoFactorForLogin(input, {}),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(sessionsIssued, 1);
  });

  it("never accepts an enrollment code for login", async () => {
    user.twoFactorEnabled = true;
    await enableTwoFactor(user.id);
    const code = mailText.match(/code is (\d{6})/)![1];
    await assert.rejects(
      verifyTwoFactorForLogin({ email: user.email, challenge: "a".repeat(64), code }, {}),
      /not right/,
    );
    await confirmTwoFactor(user.id, { code });
    assert.equal(user.twoFactorEnabled, true);
  });

  it("does not allow owners to disable 2FA", async () => {
    await assert.rejects(disableTwoFactor(user.id), /must keep/);
  });

  it("does not renew an unenrolled owner's legacy session", async () => {
    replace(prisma.refreshToken, "findUnique", async () => ({
      userId: user.id,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    }));
    await assert.rejects(refresh("legacy-refresh-token", {}), /verify your owner account/);
    assert.equal(sessionsIssued, 0);
  });

  it("preserves password-only login for staff who have not opted in", async () => {
    user.globalRole = "STAFF";
    const result = await login({ email: user.email, password, realm: "web" }, {});
    assert.ok("accessToken" in result);
  });

  it("rejects weak owner password changes before writing credentials", async () => {
    await assert.rejects(
      changePassword(user.id, user.tenantId, {
        currentPassword: password,
        newPassword: "short123",
      }),
      /Validation failed/,
    );
    assert.equal(credentialWrites, 0);
  });

  it("stores purpose-bound hashes rather than email codes", async () => {
    const input = await challengeLogin();
    assert.equal(user.twoFactorCode, hashRefreshToken(`login:${input.challenge}:${input.code}`));
    assert.notEqual(user.twoFactorCode, input.code);
  });
});
