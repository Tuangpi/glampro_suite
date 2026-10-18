import { Router, type Request } from "express";
import {
  changePasswordSchema,
  forceSignOutSchema,
  loginSchema,
  refreshSchema,
  twoFactorConfirmSchema,
  twoFactorVerifySchema,
  type ChangePasswordInput,
  type ForceSignOutInput,
  type LoginInput,
  type RefreshInput,
  type TwoFactorConfirmInput,
  type TwoFactorVerifyInput,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { validate, validated } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { unauthorized } from "../lib/http-error.js";
import {
  changePassword,
  confirmTwoFactor,
  disableTwoFactor,
  enableTwoFactor,
  forceSignOut,
  loadProfile,
  login,
  logout,
  refresh,
  verifyTwoFactorForLogin,
} from "../services/auth.service.js";
import type { SessionMeta } from "../services/auth.service.js";

/**
 * Session endpoints for the web portal.
 *
 * `POST /api/mobile/*` is a frozen contract and is **not** served from here; the
 * mobile auth routes land with the phase that owns that surface. Nothing in this
 * router changes their paths or payloads.
 */
export const authRouter = Router();

/** Records where a session was opened, for support and revocation. */
function sessionMeta(req: Request): SessionMeta {
  // nginx terminates TLS and the app trusts one proxy hop, so `req.ip` is the client.
  return {
    userAgent: req.get("user-agent") ?? undefined,
    ipAddress: req.ip ?? undefined,
  };
}

/**
 * The signed-in user, their salon, and the salon's effective entitlements.
 *
 * This is what the browser calls on load to restore a session, so it is the one
 * endpoint that must answer correctly on a cold start with only a stored token.
 */
authRouter.get("/me", auth, async (req, res, next) => {
  try {
    if (!req.user) {
      throw unauthorized();
    }
    res.status(200).json({ data: await loadProfile(req.user) });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const input = validated<LoginInput>(req, "body");
    res.status(200).json({ data: await login(input, sessionMeta(req)) });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/refresh", authLimiter, validate(refreshSchema), async (req, res, next) => {
  try {
    const { refreshToken } = validated<RefreshInput>(req, "body");
    res.status(200).json({ data: await refresh(refreshToken, sessionMeta(req)) });
  } catch (error) {
    next(error);
  }
});

/**
 * Revokes the presented refresh token. Deliberately unauthenticated: a client whose
 * access token has already expired must still be able to end its session. It revokes
 * that row and nothing else — no other session for the user is touched, and
 * `tokenVersion` is left alone
 * (`PROJECT.md#adr-0007`).
 */
authRouter.post("/logout", validate(refreshSchema), async (req, res, next) => {
  try {
    const { refreshToken } = validated<RefreshInput>(req, "body");
    await logout(refreshToken);
    res.status(200).json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
});

authRouter.post(
  "/change-password",
  auth,
  requireWritableTenant(),
  authLimiter,
  validate(changePasswordSchema),
  async (req, res, next) => {
    try {
      if (!req.user?.tenantId) {
        throw unauthorized();
      }

      const input = validated<ChangePasswordInput>(req, "body");
      await changePassword(req.user.id, req.user.tenantId, input);

      // Every session for this user is now revoked, including this one, so the
      // client is told to sign in again rather than left holding a dead token.
      res.status(200).json({
        data: { success: true },
        message: "Password changed. Please sign in again.",
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Platform forced sign-out. Bumps the user's `tokenVersion` and revokes all
 * their refresh tokens in one atomic write. SUPER_ADMIN only — this is the
 * platform escape hatch for a compromised account (`PROJECT.md#adr-0007`).
 */
authRouter.post(
  "/force-sign-out",
  auth,
  requireRole("SUPER_ADMIN"),
  authLimiter,
  validate(forceSignOutSchema),
  async (req, res, next) => {
    try {
      const input = validated<ForceSignOutInput>(req, "body");
      await forceSignOut(input);
      res.status(200).json({ data: { success: true } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Starts email-based two-factor enrollment for the authenticated user. Sends a
 * six-digit code by email; the caller must confirm it with
 * `POST /api/auth/two-factor/confirm` to finish enabling.
 */
authRouter.post(
  "/two-factor/enable",
  auth,
  authLimiter,
  async (req, res, next) => {
    try {
      if (!req.user) {
        throw unauthorized();
      }
      await enableTwoFactor(req.user.id);
      res.status(200).json({ data: { sent: true } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Confirms email-based two-factor enrollment for the authenticated user.
 * Verifies the six-digit code and enables 2FA.
 */
authRouter.post(
  "/two-factor/confirm",
  auth,
  authLimiter,
  validate(twoFactorConfirmSchema),
  async (req, res, next) => {
    try {
      if (!req.user) {
        throw unauthorized();
      }
      const input = validated<TwoFactorConfirmInput>(req, "body");
      await confirmTwoFactor(req.user.id, input);
      res.status(200).json({ data: { success: true } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Disables two-factor authentication for the authenticated user.
 */
authRouter.post(
  "/two-factor/disable",
  auth,
  authLimiter,
  async (req, res, next) => {
    try {
      if (!req.user) {
        throw unauthorized();
      }
      await disableTwoFactor(req.user.id);
      res.status(200).json({ data: { success: true } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Verifies a two-factor code for login and issues a full access/refresh session.
 * Used after `POST /api/auth/login` returns `requiresTwoFactor` (empty tokens,
 * `expiresIn: 0`). Deliberately unauthenticated: there is no session yet.
 */
authRouter.post(
  "/two-factor/verify-login",
  authLimiter,
  validate(twoFactorVerifySchema),
  async (req, res, next) => {
    try {
      const input = validated<TwoFactorVerifyInput>(req, "body");
      const session = await verifyTwoFactorForLogin(input, sessionMeta(req));
      res.status(200).json({ data: session });
    } catch (error) {
      next(error);
    }
  },
);
