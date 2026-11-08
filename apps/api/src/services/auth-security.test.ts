import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import nodemailer from "nodemailer";

// No database or external mail: every persistence call used below is replaced.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.JWT_SECRET = "isolated-auth-security-unit-tests";
process.env.SMTP_HOST = "";
const { prisma } = await import("../lib/prisma.js");
const { hashPassword } = await import("../lib/password.js");
const { hashRefreshToken } = await import("../lib/tokens.js");
const { HttpError } = await import("../lib/http-error.js");
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
/** The salon's staff sign-in policy, as `assertTenantMaySignIn` reports it. */
let salonRequiresStaffTwoFactor = false;
let sessionsIssued = 0;
let credentialWrites = 0;
let mailFails = false;
let beforeMailFailure: (() => Promise<void>) | undefined;
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
  // The owner starts enrolled: the challenge tests are about a person who has a
  // second factor, and the ones that prove password-only sign-in set this false.
  user.twoFactorEnabled = true;
  user.twoFactorCode = null;
  user.twoFactorCodeExpiresAt = null;
  consumed = false;
  sessionsIssued = 0;
  credentialWrites = 0;
  mailFails = false;
  salonRequiresStaffTwoFactor = false;
  beforeMailFailure = undefined;
  mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (input: { text: string }) => {
      if (mailFails) {
        await beforeMailFailure?.();
        throw new Error("connect ECONNREFUSED 127.0.0.1:1025");
      }
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
  replace(
    prisma.user,
    "updateMany",
    async ({ where, data }: { where: { id?: string; twoFactorCode?: string }; data: object }) => {
      if (where.twoFactorCode !== undefined && where.twoFactorCode !== user.twoFactorCode) {
        return { count: 0 };
      }
      if (consumed) return { count: 0 };
      consumed = true;
      Object.assign(user, data);
      return { count: 1 };
    },
  );
  replace(prisma.tenant, "findUnique", async () => ({
    status: "ACTIVE",
    subscriptions: [],
    requireStaffTwoFactor: salonRequiresStaffTwoFactor,
  }));
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
  it("returns a service-unavailable error and clears the code when verification email fails", async () => {
    mailFails = true;
    await assert.rejects(
      login({ email: user.email, password, realm: "web" }, {}),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, "EMAIL_SEND_FAILED");
        assert.match(error.message, /SMTP server is running/);
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, /ECONNREFUSED/);
        return true;
      },
    );
    assert.equal(user.twoFactorCode, null);
    assert.equal(user.twoFactorCodeExpiresAt, null);
    assert.equal(sessionsIssued, 0);
  });

  it("preserves a newer login code when an older email attempt fails", async () => {
    let newer: Awaited<ReturnType<typeof challengeLogin>> | undefined;
    mailFails = true;
    beforeMailFailure = async () => {
      mailFails = false;
      newer = await challengeLogin();
    };
    await assert.rejects(
      login({ email: user.email, password, realm: "web" }, {}),
      (error: unknown) => error instanceof HttpError && error.code === "EMAIL_SEND_FAILED",
    );
    assert.ok(newer);
    assert.equal(user.twoFactorCode, hashRefreshToken(`login:${newer.challenge}:${newer.code}`));
    assert.equal(sessionsIssued, 0);
    const result = await verifyTwoFactorForLogin(newer, {});
    assert.ok(result.accessToken);
    assert.equal(sessionsIssued, 1);
  });

  it("allows login to be retried after email delivery is restored", async () => {
    mailFails = true;
    await assert.rejects(login({ email: user.email, password, realm: "web" }, {}));
    // The next attempt is a fresh persistence operation, not a consumed verification.
    consumed = false;
    mailFails = false;
    const input = await challengeLogin();
    const result = await verifyTwoFactorForLogin(input, {});
    assert.ok(result.accessToken);
    assert.equal(sessionsIssued, 1);
  });

  it("returns a safe 503 response from POST /api/auth/login when email delivery fails", async () => {
    const { createApp } = await import("../app.js");
    mailFails = true;
    const server = createApp().listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email, password, realm: "web" }),
        },
      );
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.code, "EMAIL_SEND_FAILED");
      assert.match(body.message, /SMTP server is running/);
      assert.equal(body.data, undefined);
      assert.equal(body.stack, undefined);
      assert.doesNotMatch(JSON.stringify(body), /ECONNREFUSED|127\.0\.0\.1/);
      assert.equal(user.twoFactorCode, null);
      assert.equal(user.twoFactorCodeExpiresAt, null);
      assert.equal(sessionsIssued, 0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("challenges staff covered by the salon's policy and enrolls them on success", async () => {
    user.globalRole = "STAFF";
    user.twoFactorEnabled = false;
    salonRequiresStaffTwoFactor = true;
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

  it("lets an owner turn their own factor off", async () => {
    user.twoFactorCode = "stale-code-hash";
    user.twoFactorCodeExpiresAt = new Date(Date.now() + 60_000);
    await disableTwoFactor(user.id);
    assert.equal(user.twoFactorEnabled, false);
    assert.equal(user.twoFactorCode, null);
    assert.equal(user.twoFactorCodeExpiresAt, null);
  });

  it("does not let the salon's policy trap the owner's own switch", async () => {
    salonRequiresStaffTwoFactor = true;
    await disableTwoFactor(user.id);
    assert.equal(user.twoFactorEnabled, false);
  });

  it("refuses a staff member's opt-out while the salon requires it", async () => {
    user.globalRole = "STAFF";
    salonRequiresStaffTwoFactor = true;
    await assert.rejects(
      disableTwoFactor(user.id),
      /Your salon requires two-factor authentication/,
    );
    assert.equal(user.twoFactorEnabled, true);
  });

  it("renews a password-only owner's session instead of demanding a factor", async () => {
    user.twoFactorEnabled = false;
    // The salon requires a factor of its staff, and the owner is still renewed: the
    // policy is a staff rule, so it must not undo the switch the owner just turned off.
    salonRequiresStaffTwoFactor = true;
    replace(prisma.refreshToken, "findUnique", async () => ({
      userId: user.id,
      realm: "web",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    }));
    replace(prisma.refreshToken, "updateMany", async () => ({ count: 1 }));
    const result = await refresh("password-only-refresh-token", {});
    assert.ok(result.accessToken);
    assert.equal(sessionsIssued, 1);
  });

  it("refuses a staff member's renewal while the salon requires a factor", async () => {
    user.globalRole = "STAFF";
    user.twoFactorEnabled = false;
    salonRequiresStaffTwoFactor = true;
    replace(prisma.refreshToken, "findUnique", async () => ({
      userId: user.id,
      realm: "web",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    }));
    await assert.rejects(
      refresh("staff-refresh-token", {}),
      (error: { statusCode?: number; code?: string }) =>
        error.statusCode === 401 && error.code === "TWO_FACTOR_REQUIRED",
    );
    assert.equal(sessionsIssued, 0);
  });

  it("preserves password-only login for staff who have not opted in", async () => {
    user.globalRole = "STAFF";
    user.twoFactorEnabled = false;
    const result = await login({ email: user.email, password, realm: "web" }, {});
    assert.ok("accessToken" in result);
  });

  it("signs an owner in with a password once they turn their factor off", async () => {
    user.twoFactorEnabled = false;
    const result = await login({ email: user.email, password, realm: "web" }, {});
    assert.ok("accessToken" in result);
    assert.equal(sessionsIssued, 1);
  });

  it("still challenges a staff member the salon's policy covers", async () => {
    user.globalRole = "STAFF";
    user.twoFactorEnabled = false;
    salonRequiresStaffTwoFactor = true;
    const result = await login({ email: user.email, password, realm: "web" }, {});
    assert.ok("requiresTwoFactor" in result);
    assert.equal(sessionsIssued, 0);
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
