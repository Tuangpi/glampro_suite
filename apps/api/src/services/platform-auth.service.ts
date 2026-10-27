import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  type PlatformAuthSession,
  type PlatformLoginInput,
  type PlatformVerifyInput,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { HttpError, unauthorized } from "../lib/http-error.js";
import { verifyPassword } from "../lib/password.js";
import { isSmtpConfigured } from "../lib/email.js";
import { createRefreshToken, hashRefreshToken, refreshTokenExpiry } from "../lib/tokens.js";
import type { PlatformAdmin } from "../../generated/prisma/client.js";

const AUDIENCE = "glampro-platform";
const ISSUER = "glampro-api";
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const invalid = () =>
  unauthorized("Your platform session is no longer valid.", "SESSION_INVALIDATED");
const profile = (admin: PlatformAdmin) => ({ id: admin.id, email: admin.email, name: admin.name });

export async function platformLogin(input: PlatformLoginInput) {
  const admin = await prisma.platformAdmin.findUnique({ where: { email: input.email } });
  const matches = await verifyPassword(input.password, admin?.passwordHash ?? DUMMY_HASH);
  if (!admin || admin.status !== "ACTIVE" || !matches) {
    throw unauthorized("That email and password combination is not right.", "INVALID_CREDENTIALS");
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
  console.log(`Platform login code for ${admin.email}: ${code}`);
  // try {
  //   await sendTwoFactorCode(admin.email, code);
  // } catch (error) {
  //   await prisma.platformAdmin.updateMany({
  //     where: { id: admin.id, loginChallengeHash: challengeHash },
  //     data: { loginChallengeHash: null, loginCodeHash: null, loginChallengeExpiresAt: null },
  //   });
  //   throw new HttpError(
  //     503,
  //     "Verification email could not be sent. Check that the configured SMTP server is running, then try signing in again.",
  //     { code: "EMAIL_SEND_FAILED", cause: error },
  //   );
  // }
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
  const refresh = createRefreshToken();
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
    const session = await tx.platformSession.create({
      data: {
        adminId: candidate.id,
        tokenHash: refresh.tokenHash,
        tokenVersion: candidate.tokenVersion,
        expiresAt: refreshTokenExpiry(),
      },
    });
    await tx.auditLog.create({
      data: {
        actorPlatformAdminId: candidate.id,
        action: "platform.login",
        targetType: "PlatformSession",
        targetId: session.id,
      },
    });
    return sessionPayload(candidate, session.id, refresh.token);
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
  return profile(session.admin);
}
