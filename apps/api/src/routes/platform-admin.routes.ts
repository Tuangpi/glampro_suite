import { Router } from "express";
import {
  createPlatformAdminSchema,
  platformAdminListQuerySchema,
  type CreatePlatformAdminInput,
  type PlatformAdminListQuery,
} from "@glampro_suite/shared";
import { platformAuth } from "../middleware/platform-auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { validate, validated } from "../middleware/validate.js";
import { createPlatformAdmin, listPlatformAdmins } from "../services/platform-admin.service.js";

export const platformAdminRouter = Router();
platformAdminRouter.use(platformAuth);
platformAdminRouter.get(
  "/",
  validate(platformAdminListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      res.json({ data: await listPlatformAdmins(validated<PlatformAdminListQuery>(req, "query")) });
    } catch (error) {
      next(error);
    }
  },
);
platformAdminRouter.post(
  "/",
  authLimiter,
  validate(createPlatformAdminSchema),
  async (req, res, next) => {
    try {
      const admin = await createPlatformAdmin(
        res.locals.platformAdmin.id,
        validated<CreatePlatformAdminInput>(req, "body"),
      );
      res.status(201).json({ data: admin });
    } catch (error) {
      next(error);
    }
  },
);
