import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { GlobalRole } from "@glampro_suite/shared";

import { forbidden, unauthorized } from "../lib/http-error.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { prisma } from "../lib/prisma.js";
import { canWrite, resolveTenantStatus } from "../lib/tenant-status.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { logger } from "../lib/logger.js";
import type { AuthenticatedUser } from "../types/index.js";

/** Realms whose subject is a `User` belonging to a tenant. */
const TENANT_REALMS = new Set(["web", "pos", "mobile"]);

/**
 * Verifies the bearer access token and re-validates the session against the
 * database on every request, so disabled accounts, sessions ended by a password
 * change or a forced sign-out, and role changes all apply immediately instead of
 * waiting for the token to expire. Logging out of one client is not one of those
 * events — it revokes that client's refresh token and leaves `tokenVersion` where
 * it is (`PROJECT.md#adr-0007`).
 *
 * On success the rest of the request is entered through `runAsTenant`, which is
 * what makes the Prisma extension scope every tenant-scoped query that follows.
 * The lookups this middleware performs itself run through `runAsPlatform`: they are
 * keyed on the verified token's subject and happen before a tenant is trusted, so
 * they read one row by primary key and cannot cross tenants.
 */
export async function auth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(unauthorized("Missing bearer token"));
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    next(unauthorized("Missing bearer token"));
    return;
  }

  try {
    const claims = verifyAccessToken(token);

    // Reject other surfaces before looking up a tenant user with the same id.
    if (!TENANT_REALMS.has(claims.realm)) {
      next(forbidden("This token is not valid for a tenant realm.", "REALM_NOT_SUPPORTED"));
      return;
    }

    // `User` is tenant-scoped, but this lookup happens before any tenant is
    // known: it is keyed on the verified token's `sub`, not on anything the
    // request supplied. `runAsPlatform` is the explicit opt-out the extension
    // requires, and reading it here cannot cross tenants — it selects one row by
    // primary key. Phase 3 replaces this with the token's `tenantId` claim and
    // wraps the rest of the request in `runAsTenant`.
    const user = await runAsPlatform(() =>
      prisma.user.findUnique({
        where: { id: claims.sub },
        select: {
          id: true,
          tenantId: true,
          email: true,
          name: true,
          globalRole: true,
          tokenVersion: true,
          disabled: true,
          twoFactorEnabled: true,
        },
      }),
    );

    if (!user || !user.email || user.disabled) {
      res.status(401).json({
        statusCode: 401,
        message: "Your session is no longer valid. Please log in again.",
        code: "SESSION_INVALIDATED",
      });
      return;
    }

    if (claims.tokenVersion !== user.tokenVersion) {
      res.status(401).json({
        statusCode: 401,
        message: "Your session has been revoked. Please log in again.",
        code: "SESSION_INVALIDATED",
      });
      return;
    }

    if (user.globalRole === "SUPER_ADMIN" && !user.twoFactorEnabled) {
      next(unauthorized("Sign in again to verify your owner account.", "TWO_FACTOR_REQUIRED"));
      return;
    }

    // A signed claim is not permission to enter a different company. This also
    // invalidates old tokens after an account is reassigned to another tenant.
    if (claims.tenantId !== undefined && claims.tenantId !== user.tenantId) {
      next(
        unauthorized(
          "Your session is no longer valid. Please log in again.",
          "SESSION_INVALIDATED",
        ),
      );
      return;
    }

    // The tenant comes from the token, never from the request. Fall back to the
    // user's own row only for tokens minted before the claim existed.
    const tenantId = claims.tenantId ?? user.tenantId;

    const tenant = await runAsPlatform(() =>
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          subscriptions: {
            orderBy: { endDate: "desc" },
            take: 1,
            select: { endDate: true },
          },
        },
      }),
    );

    if (!tenant) {
      next(unauthorized("Your salon is no longer available.", "TENANT_NOT_FOUND"));
      return;
    }

    const status = resolveTenantStatus(tenant.status, tenant.subscriptions[0]?.endDate ?? null);

    if (status === "CANCELLED" || status === "EXPIRED") {
      next(
        forbidden(
          status === "CANCELLED"
            ? "This account is closed. Please contact your provider."
            : "This salon's subscription has ended. Please contact your provider.",
          status === "CANCELLED" ? "TENANT_CANCELLED" : "TENANT_EXPIRED",
        ),
      );
      return;
    }

    const principal: AuthenticatedUser = {
      id: user.id,
      tenantId: tenant.id,
      email: user.email,
      name: user.name,
      globalRole: user.globalRole,
      realm: claims.realm,
      tokenVersion: user.tokenVersion,
      tenantStatus: status,
    };

    req.user = principal;

    // Enter the tenant scope for everything downstream. `next()` runs inside
    // `runAsTenant` so the route handlers and their continuations inherit it.
    runAsTenant(tenant.id, next, user.id);
  } catch (error) {
    logger.debug("Rejected request during authentication", { error });
    next(error);
  }
}

/** Restricts a route to the listed roles. Must run after `auth`. */
export function requireRole(...roles: GlobalRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.globalRole)) {
      next(forbidden("Your role does not permit this action."));
      return;
    }
    next();
  };
}

/**
 * Refuses writes for a salon that is suspended.
 *
 * `SUSPENDED` still signs in — the owner can look at their data and see why — but
 * nothing may change until it is settled, so every write route carries this. It is
 * separate from `auth` because a route mounted with `auth` alone is readable by a
 * suspended tenant by design, as `docs/saas/TENANCY.md` §6 requires.
 */
export function requireWritableTenant(): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }

    if (req.user.tenantStatus !== undefined && !canWrite(req.user.tenantStatus)) {
      next(
        forbidden(
          "Your salon's subscription is suspended, so changes are disabled. Please contact your provider.",
          "TENANT_SUSPENDED",
        ),
      );
      return;
    }

    next();
  };
}
