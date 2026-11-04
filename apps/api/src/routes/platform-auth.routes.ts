import { Router } from "express";
import {
  platformLoginSchema,
  platformVerifySchema,
  platformPasswordChangeSchema,
  platformTwoFactorDisableSchema,
  twoFactorConfirmSchema,
  refreshSchema,
  type PlatformLoginInput,
  type PlatformPasswordChangeInput,
  type PlatformTwoFactorDisableInput,
  type PlatformVerifyInput,
  type RefreshInput,
  type TwoFactorConfirmInput,
} from "@glampro_suite/shared";
import { validate, validated } from "../middleware/validate.js";
import { platformAuth } from "../middleware/platform-auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { unauthorized } from "../lib/http-error.js";
import {
  authenticatePlatform,
  changePlatformPassword,
  confirmPlatformTwoFactor,
  disablePlatformTwoFactor,
  enrollPlatformTwoFactor,
  platformLogin,
  platformVerify,
  platformRefresh,
  platformLogout,
} from "../services/platform-auth.service.js";

export const platformAuthRouter = Router();
platformAuthRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
platformAuthRouter.post(
  "/login",
  authLimiter,
  validate(platformLoginSchema),
  async (req, res, next) => {
    try {
      res.json({ data: await platformLogin(validated<PlatformLoginInput>(req, "body")) });
    } catch (error) {
      next(error);
    }
  },
);
platformAuthRouter.post(
  "/verify",
  authLimiter,
  validate(platformVerifySchema),
  async (req, res, next) => {
    try {
      res.json({ data: await platformVerify(validated<PlatformVerifyInput>(req, "body")) });
    } catch (error) {
      next(error);
    }
  },
);
platformAuthRouter.post(
  "/refresh",
  authLimiter,
  validate(refreshSchema),
  async (req, res, next) => {
    try {
      res.json({ data: await platformRefresh(validated<RefreshInput>(req, "body").refreshToken) });
    } catch (error) {
      next(error);
    }
  },
);
platformAuthRouter.post("/logout", authLimiter, validate(refreshSchema), async (req, res, next) => {
  try {
    await platformLogout(validated<RefreshInput>(req, "body").refreshToken);
    res.json({ data: { success: true } });
  } catch (error) {
    next(error);
  }
});
platformAuthRouter.get("/me", async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ") || !header.slice(7).trim()) throw unauthorized();
    const { admin } = await authenticatePlatform(header.slice(7).trim());
    res.json({ data: admin });
  } catch (error) {
    next(error);
  }
});
platformAuthRouter.post(
  "/password",
  authLimiter,
  platformAuth,
  validate(platformPasswordChangeSchema),
  async (req, res, next) => {
    try {
      res.json({
        data: await changePlatformPassword(
          res.locals.platformAdmin.id,
          res.locals.platformSessionId,
          validated<PlatformPasswordChangeInput>(req, "body"),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
// Enrolment only sends the code; the toggle flips on confirmation, so a failed
// send or a typo can never lock the console out of its own sign-in.
platformAuthRouter.post(
  "/two-factor/enroll",
  authLimiter,
  platformAuth,
  async (_req, res, next) => {
    try {
      res.json({ data: await enrollPlatformTwoFactor(res.locals.platformAdmin.id) });
    } catch (error) {
      next(error);
    }
  },
);
platformAuthRouter.post(
  "/two-factor/confirm",
  authLimiter,
  platformAuth,
  validate(twoFactorConfirmSchema),
  async (req, res, next) => {
    try {
      res.json({
        data: await confirmPlatformTwoFactor(
          res.locals.platformAdmin.id,
          validated<TwoFactorConfirmInput>(req, "body").code,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
platformAuthRouter.post(
  "/two-factor/disable",
  authLimiter,
  platformAuth,
  validate(platformTwoFactorDisableSchema),
  async (req, res, next) => {
    try {
      res.json({
        data: await disablePlatformTwoFactor(
          res.locals.platformAdmin.id,
          validated<PlatformTwoFactorDisableInput>(req, "body"),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
