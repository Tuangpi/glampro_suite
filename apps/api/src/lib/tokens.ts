import crypto from "node:crypto";

import jwt from "jsonwebtoken";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  type AccessTokenClaims,
  type AuthRealm,
  type GlobalRole,
} from "@glampro_suite/shared";

import { env } from "./env.js";
import { unauthorized } from "./http-error.js";

const ISSUER = "glampro-api";
const ALGORITHM = "HS256";

export interface TokenSubject {
  id: string;
  email: string;
  globalRole: GlobalRole;
  realm: AuthRealm;
  /** Omitted for a platform session, which sits above every tenant. */
  tenantId?: string;
  tokenVersion: number;
}

/**
 * Short-lived, stateless access token. Every request re-checks `tokenVersion`
 * against the database (see `middleware/auth.ts`), so a password change or a
 * forced sign-out takes effect on the next request rather than at the token's
 * expiry. Logout deliberately does not move `tokenVersion`: it revokes the refresh
 * row, per `PROJECT.md#adr-0007`.
 */
export function signAccessToken(subject: TokenSubject): { token: string; expiresIn: number } {
  const token = jwt.sign(
    {
      email: subject.email,
      globalRole: subject.globalRole,
      realm: subject.realm,
      ...(subject.tenantId === undefined ? {} : { tenantId: subject.tenantId }),
      tokenVersion: subject.tokenVersion,
    },
    env.jwtSecret,
    {
      algorithm: ALGORITHM,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      issuer: ISSUER,
      subject: subject.id,
    },
  );

  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
    });

    if (typeof payload === "string" || !payload.sub) {
      throw unauthorized("Invalid or expired token", "SESSION_EXPIRED");
    }

    const tenantId = payload.tenantId;

    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      globalRole: payload.globalRole as GlobalRole,
      realm: payload.realm as AuthRealm,
      ...(typeof tenantId === "string" && tenantId !== "" ? { tenantId } : {}),
      tokenVersion: Number(payload.tokenVersion ?? 0),
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw unauthorized("Your session has expired. Please log in again.", "SESSION_EXPIRED");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw unauthorized("Invalid session token.", "SESSION_INVALIDATED");
    }
    throw error;
  }
}

/**
 * Refresh tokens are opaque random strings, not JWTs: the database row is the
 * source of truth, which makes rotation and revocation trivial. Only the
 * SHA-256 hash is persisted.
 */
export function createRefreshToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}
