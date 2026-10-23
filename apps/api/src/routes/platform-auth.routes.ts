import { Router } from "express";
import {
  platformLoginSchema,
  platformVerifySchema,
  refreshSchema,
  type PlatformLoginInput,
  type PlatformVerifyInput,
  type RefreshInput,
} from "@glampro_suite/shared";
import { validate, validated } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { unauthorized } from "../lib/http-error.js";
import {
  authenticatePlatform,
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
    res.json({ data: await authenticatePlatform(header.slice(7).trim()) });
  } catch (error) {
    next(error);
  }
});
