import { Router } from "express";
import {
  configurePrivacyNoticeSchema,
  type ConfigurePrivacyNoticeInput,
} from "@glampro_suite/shared";
import { configurePrivacyNotice, getPrivacyNotice } from "../services/consent.service.js";
import {
  updateSalonOperatingHoursSchema,
  updateSalonProfileSchema,
  type UpdateSalonOperatingHoursInput,
  type UpdateSalonProfileInput,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";
import {
  getSalonOperatingHours,
  getSalonProfile,
  listModules,
  updateSalonOperatingHours,
  updateSalonProfile,
} from "../services/settings.service.js";

/**
 * Settings — handoff screen 11 (`/api/settings`).
 *
 * Reads are open to every signed-in member of the salon (the page is role-gated
 * in the rail, but a stylist reaching `/settings` directly should read the same
 * truth rather than a 401). The **write is `SUPER_ADMIN` or `MANAGER`** on top
 * of a writable tenant: a stylist cannot rename the salon or move its stock
 * threshold, exactly as Q26's role rule works on staff.
 *
 * `requireModule` has no settings code and deliberately none is invented: the
 * salon's own configuration is not a switchable feature, so it is never hidden
 * for entitlement reasons — the rail entry's `module` field says the same.
 */
export const settingsRouter = Router();

settingsRouter.get("/privacy-notice", auth, async (_req, res, next) => {
  try {
    res.json({ data: await getPrivacyNotice() });
  } catch (error) {
    next(error);
  }
});
settingsRouter.post(
  "/privacy-notice",
  auth,
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(configurePrivacyNoticeSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      res.status(201).json({
        data: await configurePrivacyNotice(
          validated<ConfigurePrivacyNoticeInput>(req, "body"),
          req.user.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.get("/profile", auth, async (_req, res, next) => {
  try {
    res.status(200).json({ data: await getSalonProfile() });
  } catch (error) {
    next(error);
  }
});

settingsRouter.patch(
  "/profile",
  auth,
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(updateSalonProfileSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<UpdateSalonProfileInput>(req, "body");
      res.status(200).json({ data: await updateSalonProfile(input) });
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.get("/modules", auth, async (_req, res, next) => {
  try {
    res.status(200).json({ data: await listModules() });
  } catch (error) {
    next(error);
  }
});

/** The salon's published operating hours — readable by anyone signed in. */
settingsRouter.get("/hours", auth, async (_req, res, next) => {
  try {
    res.status(200).json({ data: await getSalonOperatingHours() });
  } catch (error) {
    next(error);
  }
});

settingsRouter.patch(
  "/hours",
  auth,
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(updateSalonOperatingHoursSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<UpdateSalonOperatingHoursInput>(req, "body");
      res.status(200).json({ data: await updateSalonOperatingHours(input) });
    } catch (error) {
      next(error);
    }
  },
);
