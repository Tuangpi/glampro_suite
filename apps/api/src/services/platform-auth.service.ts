import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  TWO_FACTOR_CODE_LENGTH,
  TWO_FACTOR_CODE_TTL_SECONDS,
  type PlatformAuthSession,
  type PlatformAdminProfile,
  type PlatformLoginInput,
  type PlatformLoginResult,
  type PlatformPasswordChangeInput,
  type PlatformTwoFactorDisableInput,
  type PlatformVerifyInput,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { conflict, HttpError, unauthorized } from "../lib/http-error.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { isSmtpConfigured, sendTwoFactorCode } from "../lib/email.js";
import { createRefreshToken, hashRefreshToken, refreshTokenExpiry } from "../lib/tokens.js";
import type { PlatformAdmin } from "../../generated/prisma/client.js";

const AUDIENCE = "glampro-platform";
const ISSUER = "glampro-api";
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const invalid = () =>
  unauthorized("Your platform session is no longer valid.", "SESSION_INVALIDATED");
const profile = (admin: PlatformAdmin): PlatformAdminProfile => ({
  id: admin.id,
  email: admin.email,
  name: admin.name,
  twoFactorEnabled: admin.twoFactorEnabled,
});
/** Enrolment codes are hashed under their own prefix so they can never be replayed at sign-in. */
const enrollCodeHash = (code: string) => hashRefreshToken(`platform-enroll:${code}`);

export async function platformLogin(input: PlatformLoginInput): Promise<PlatformLoginResult> {
  const admin = await prisma.platformAdmin.findUnique({ where: { email: input.email } });
  const matches = await verifyPassword(input.password, admin?.passwordHash ?? DUMMY_HASH);
  if (!admin || admin.status !== "ACTIVE" || !matches) {
    throw unauthorized("That email and password combination is not right.", "INVALID_CREDENTIALS");
  }
  // Email verification is off: issue the session in the same transaction that
  // clears any half-finished challenge, so an older code cannot be replayed later.
  if (!admin.twoFactorEnabled) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.platformAdmin.update({
        where: { id: admin.id },
        data: {
          lastLoginAt: new Date(),
          loginChallengeHash: null,
          loginCodeHash: null,
          loginChallengeExpiresAt: null,
          loginAttempts: 0,
        },
      });
      return issuePlatformSession(tx, current);
    });
  }
  // Never pretend an operator MFA code was delivered through the JSON transport.
  if (!isSmtpConfigured()) {
    throw new HttpError(503, "Configure SMTP before platform sign-in.", {
      code: "EMAIL_NOT_CONFIGURED",
    });
  }

  const challenge = randomBytes(32).toString("hex");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challengeHash = hashRefreshToken(challenge);
  await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: {
      loginChallengeHash: challengeHash,
      loginCodeHash: hashRefreshToken(`platform:${challenge}:${code}`),
      loginChallengeExpiresAt: new Date(Date.now() + 10 * 60_000),
      loginAttempts: 0,
    },
  });
  try {
    await sendTwoFactorCode(admin.email, code);
  } catch (error) {
    // Only clear this attempt: a newer login may already have replaced its challenge.
    await prisma.platformAdmin.updateMany({
      where: { id: admin.id, loginChallengeHash: challengeHash },
      data: { loginChallengeHash: null, loginCodeHash: null, loginChallengeExpiresAt: null },
    });
    throw new HttpError(
      503,
      "Verification email could not be sent. Check that the configured SMTP server is running, then try signing in again.",
      { code: "EMAIL_SEND_FAILED", cause: error },
    );
  }
  return { requiresTwoFactor: true as const, challenge };
}

function sessionPayload(
  admin: PlatformAdmin,
  sessionId: string,
  refreshToken: string,
): PlatformAuthSession {
  const accessToken = jwt.sign(
    { realm: "platform", sessionId, tokenVersion: admin.tokenVersion },
    env.jwtSecret,
    {
      algorithm: "HS256",
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: admin.id,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    },
  );
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, admin: profile(admin) };
}

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Creates the operator session row, records the sign-in and mints the tokens.
 *
 * Shared by the verified path and the no-verification path so both issue exactly
 * the same session, audit entry and token pair — only the proof of identity differs.
 */
async function issuePlatformSession(tx: Transaction, admin: PlatformAdmin) {
  const refresh = createRefreshToken();
  const session = await tx.platformSession.create({
    data: {
      adminId: admin.id,
      tokenHash: refresh.tokenHash,
      tokenVersion: admin.tokenVersion,
      expiresAt: refreshTokenExpiry(),
    },
  });
  await tx.auditLog.create({
    data: {
      actorPlatformAdminId: admin.id,
      action: "platform.login",
      targetType: "PlatformSession",
      targetId: session.id,
    },
  });
  return sessionPayload(admin, session.id, refresh.token);
}

export async function platformVerify(input: PlatformVerifyInput): Promise<PlatformAuthSession> {
  const challengeHash = hashRefreshToken(input.challenge);
  const candidate = await prisma.platformAdmin.findUnique({
    where: { loginChallengeHash: challengeHash },
  });
  const reject = () =>
    unauthorized("The code is invalid or expired. Sign in again.", "INVALID_TWO_FACTOR_CODE");
  if (!candidate) throw reject();
  // One atomic budget claim per attempt, including wrong codes. Concurrent attempts
  // cannot exceed five, and a completed/replaced challenge cannot be reused.
  const attempt = await prisma.platformAdmin.updateMany({
    where: {
      id: candidate.id,
      status: "ACTIVE",
      tokenVersion: candidate.tokenVersion,
      loginChallengeHash: challengeHash,
      loginChallengeExpiresAt: { gt: new Date() },
      loginAttempts: { lt: 5 },
    },
    data: { loginAttempts: { increment: 1 } },
  });
  if (attempt.count !== 1 || !candidate.loginCodeHash) throw reject();
  const actual = Buffer.from(hashRefreshToken(`platform:${input.challenge}:${input.code}`));
  const expected = Buffer.from(candidate.loginCodeHash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw reject();
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.platformAdmin.updateMany({
      where: {
        id: candidate.id,
        status: "ACTIVE",
        tokenVersion: candidate.tokenVersion,
        loginChallengeHash: challengeHash,
        loginChallengeExpiresAt: { gt: new Date() },
      },
      data: {
        loginChallengeHash: null,
        loginCodeHash: null,
        loginChallengeExpiresAt: null,
        loginAttempts: 0,
        lastLoginAt: new Date(),
      },
    });
    if (claimed.count !== 1) throw reject();
    return issuePlatformSession(tx, candidate);
  });
}

export async function platformRefresh(token: string): Promise<PlatformAuthSession> {
  const refresh = createRefreshToken();
  return prisma.$transaction(async (tx) => {
    const session = await tx.platformSession.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      include: { admin: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.admin.status !== "ACTIVE" ||
      session.tokenVersion !== session.admin.tokenVersion
    )
      throw invalid();
    // Rotate in place: old access tokens remain usable only while this session is
    // active. Logout revokes both access and refresh immediately.
    const claimed = await tx.platformSession.updateMany({
      where: {
        id: session.id,
        tokenHash: session.tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { tokenHash: refresh.tokenHash },
    });
    if (claimed.count !== 1) throw invalid();
    return sessionPayload(session.admin, session.id, refresh.token);
  });
}

export async function platformLogout(token: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const session = await tx.platformSession.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
    });
    if (!session || session.revokedAt) return;
    const changed = await tx.platformSession.updateMany({
      where: { id: session.id, tokenHash: session.tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (changed.count)
      await tx.auditLog.create({
        data: {
          actorPlatformAdminId: session.adminId,
          action: "platform.logout",
          targetType: "PlatformSession",
          targetId: session.id,
        },
      });
  });
}

export async function authenticatePlatform(token: string) {
  let claims: jwt.JwtPayload;
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      typeof payload === "string" ||
      payload.realm !== "platform" ||
      typeof payload.sub !== "string" ||
      typeof payload.sessionId !== "string" ||
      !Number.isInteger(payload.tokenVersion) ||
      payload.tenantId !== undefined
    )
      throw invalid();
    claims = payload;
  } catch {
    throw invalid();
  }
  const session = await prisma.platformSession.findUnique({
    where: { id: claims.sessionId as string },
    include: { admin: true },
  });
  if (
    !session ||
    session.adminId !== claims.sub ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.admin.status !== "ACTIVE" ||
    session.tokenVersion !== claims.tokenVersion ||
    session.admin.tokenVersion !== claims.tokenVersion
  )
    throw invalid();
  // The session id lets *Account & security* keep this one session while revoking
  // the others; it is returned here and deliberately dropped by the routes.
  return { admin: profile(session.admin), sessionId: session.id };
}

/**
 * Changes the operator's password.
 *
 * Other operator sessions are revoked in the same transaction: a password change is
 * what an operator does when a credential may have leaked, so leaving the other
 * sessions alive would defeat it. The session that made the change survives, or the
 * operator would be thrown out of the console they are standing in.
 */
export async function changePlatformPassword(
  adminId: string,
  sessionId: string,
  input: PlatformPasswordChangeInput,
) {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId } });
  if (!admin || admin.status !== "ACTIVE") throw invalid();
  if (!(await verifyPassword(input.currentPassword, admin.passwordHash)))
    throw unauthorized("Your current password is not right.", "INVALID_CREDENTIALS");
  const passwordHash = await hashPassword(input.newPassword);
  const revokedSessions = await prisma.$transaction(async (tx) => {
    await tx.platformAdmin.update({ where: { id: admin.id }, data: { passwordHash } });
    const revoked = await tx.platformSession.updateMany({
      where: { adminId: admin.id, id: { not: sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorPlatformAdminId: admin.id,
        action: "platform.password.change",
        targetType: "PlatformAdmin",
        targetId: admin.id,
        metadata: { revokedSessions: revoked.count },
      },
    });
    return revoked.count;
  });
  return { success: true as const, revokedSessions };
}

/**
 * Emails a code that, once confirmed, turns verification back on.
 *
 * Only reachable while verification is off, so a console without SMTP can still be
 * entered and the operator can restore the check once mail is configured.
 */
export async function enrollPlatformTwoFactor(adminId: string) {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId } });
  if (!admin || admin.status !== "ACTIVE") throw invalid();
  if (admin.twoFactorEnabled)
    throw conflict("Email verification is already on.", "TWO_FACTOR_ALREADY_ENABLED");
  if (!isSmtpConfigured())
    throw new HttpError(503, "Configure SMTP before enabling email verification.", {
      code: "EMAIL_NOT_CONFIGURED",
    });
  const code = String(randomInt(0, 10 ** TWO_FACTOR_CODE_LENGTH)).padStart(
    TWO_FACTOR_CODE_LENGTH,
    "0",
  );
  const codeHash = enrollCodeHash(code);
  await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: {
      twoFactorCodeHash: codeHash,
      twoFactorCodeExpiresAt: new Date(Date.now() + TWO_FACTOR_CODE_TTL_SECONDS * 1000),
    },
  });
  try {
    await sendTwoFactorCode(admin.email, code);
  } catch (error) {
    // A code the operator never received must not stay usable.
    await prisma.platformAdmin.updateMany({
      where: { id: admin.id, twoFactorCodeHash: codeHash },
      data: { twoFactorCodeHash: null, twoFactorCodeExpiresAt: null },
    });
    throw new HttpError(
      503,
      "Verification email could not be sent. Check the SMTP server, then try again.",
      { code: "EMAIL_SEND_FAILED", cause: error },
    );
  }
  return { sent: true as const };
}

/** Consumes the pending enrolment code and switches verification on. */
export async function confirmPlatformTwoFactor(
  adminId: string,
  code: string,
): Promise<PlatformAdminProfile> {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId } });
  if (!admin || admin.status !== "ACTIVE") throw invalid();
  if (!admin.twoFactorCodeHash || !admin.twoFactorCodeExpiresAt)
    throw conflict("No verification code is pending. Enable it again.", "TWO_FACTOR_NOT_PENDING");
  if (admin.twoFactorCodeExpiresAt <= new Date())
    throw conflict("That code has expired. Enable it again.", "TWO_FACTOR_EXPIRED");
  const actual = Buffer.from(enrollCodeHash(code));
  const expected = Buffer.from(admin.twoFactorCodeHash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw unauthorized("That verification code is not right.", "INVALID_TWO_FACTOR_CODE");
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.platformAdmin.updateMany({
      where: {
        id: admin.id,
        twoFactorCodeHash: admin.twoFactorCodeHash,
        twoFactorCodeExpiresAt: { gt: new Date() },
      },
      data: { twoFactorEnabled: true, twoFactorCodeHash: null, twoFactorCodeExpiresAt: null },
    });
    if (consumed.count !== 1)
      throw conflict(
        "That code has already been used. Enable it again.",
        "INVALID_TWO_FACTOR_CODE",
      );
    await tx.auditLog.create({
      data: {
        actorPlatformAdminId: admin.id,
        action: "platform.two_factor.enable",
        targetType: "PlatformAdmin",
        targetId: admin.id,
      },
    });
  });
  return profile({ ...admin, twoFactorEnabled: true });
}

/** Turns verification off. Re-proves the password because it weakens sign-in. */
export async function disablePlatformTwoFactor(
  adminId: string,
  input: PlatformTwoFactorDisableInput,
): Promise<PlatformAdminProfile> {
  const admin = await prisma.platformAdmin.findUnique({ where: { id: adminId } });
  if (!admin || admin.status !== "ACTIVE") throw invalid();
  if (!admin.twoFactorEnabled)
    throw conflict("Email verification is already off.", "TWO_FACTOR_ALREADY_DISABLED");
  if (!(await verifyPassword(input.currentPassword, admin.passwordHash)))
    throw unauthorized("Your password is not right.", "INVALID_CREDENTIALS");
  await prisma.$transaction(async (tx) => {
    await tx.platformAdmin.update({
      where: { id: admin.id },
      data: { twoFactorEnabled: false, twoFactorCodeHash: null, twoFactorCodeExpiresAt: null },
    });
    await tx.auditLog.create({
      data: {
        actorPlatformAdminId: admin.id,
        action: "platform.two_factor.disable",
        targetType: "PlatformAdmin",
        targetId: admin.id,
      },
    });
  });
  return profile({ ...admin, twoFactorEnabled: false });
}
