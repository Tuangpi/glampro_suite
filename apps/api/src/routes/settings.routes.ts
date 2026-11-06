import { Router } from "express";
import multer from "multer";
import {
  configurePrivacyNoticeSchema,
  type ConfigurePrivacyNoticeInput,
} from "@glampro_suite/shared";
import { configurePrivacyNotice, getPrivacyNotice } from "../services/consent.service.js";
import {
  updateSalonOperatingHoursSchema,
  updateSalonProfileSchema,
  updateSalonSecuritySchema,
  type UpdateSalonOperatingHoursInput,
  type UpdateSalonProfileInput,
  type UpdateSalonSecurityInput,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { validate, validated } from "../middleware/validate.js";
import { badRequest, unauthorized } from "../lib/http-error.js";
import {
  MAX_LOGO_BYTES,
  deleteSalonLogo,
  getSalonOperatingHours,
  getSalonProfile,
  listModules,
  saveSalonLogo,
  updateSalonOperatingHours,
  updateSalonProfile,
  updateSalonSecurityPolicy,
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

/**
 * The salon's logo: one image, replacing whatever was there.
 *
 * `multer` reads the bytes into memory under a size cap of its own, so an oversized
 * upload is refused before it is buffered; the service re-checks the length and
 * sniffs the magic bytes, because a client's `Content-Type` is a claim. `fields: 0`
 * says the body is the file and nothing else — a logo is not a JSON field.
 *
 * Same roles as the profile write: a manager may rebrand the salon, a stylist may
 * not, and a suspended salon may change nothing at all.
 */
const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 0 },
}).single("logo");

settingsRouter.post(
  "/logo",
  auth,
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  (req, res, next) =>
    uploadLogo(req, res, (error: unknown) => {
      if (error) return next(badRequest("Choose a JPEG or PNG image up to 512 KB."));
      next();
    }),
  async (req, res, next) => {
    try {
      if (!req.file) throw badRequest("Choose a JPEG or PNG image up to 512 KB.");
      res.status(201).json({ data: await saveSalonLogo(req.file.buffer) });
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.delete(
  "/logo",
  auth,
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  async (_req, res, next) => {
    try {
      res.status(200).json({ data: await deleteSalonLogo() });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The salon's staff sign-in policy. **Owner only**, unlike the profile: a manager
 * can rename the salon, but making two-factor mandatory for every colleague is
 * the owner's decision — and the same rule the platform console applies when a
 * manager's own account is concerned.
 *
 * Not tenant-write-blocked on its own either: `requireWritableTenant()` keeps a
 * suspended salon from changing the terms of its own sign-in.
 */
settingsRouter.patch(
  "/security",
  auth,
  requireWritableTenant(),
  requireRole("SUPER_ADMIN"),
  validate(updateSalonSecuritySchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<UpdateSalonSecurityInput>(req, "body");
      res.status(200).json({ data: await updateSalonSecurityPolicy(input, req.user.id) });
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
