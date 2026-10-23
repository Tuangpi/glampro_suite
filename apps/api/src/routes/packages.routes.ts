import { Router } from "express";
import {
  catalogueListQuerySchema,
  createPackageSchema,
  idParamSchema,
  updatePackageSchema,
  updatePrepaidValiditySchema,
  type UpdatePrepaidValidityInput,
  type CatalogueListQuery,
  type CreatePackageInput,
  type UpdatePackageInput,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { forbidden, unauthorized } from "../lib/http-error.js";
import {
  createPackage,
  getPackage,
  listPackages,
  updatePackage,
  updatePrepaidValidity,
} from "../services/package.service.js";

/**
 * Packages — the third tab of handoff screen 08.
 *
 * A separate mount rather than another `/products` query, because a package is a
 * separate resource with its own entitlement: `packages` is an **add-on** module, so
 * a salon that has not bought it is refused by `requireModule` with
 * `MODULE_NOT_ENTITLED` instead of being shown an empty tab. That refusal is the
 * first time this route family exercises the add-on branch of the guard — the
 * catalogue's own `requireModule("catalogue")` is core and always passes.
 *
 * The query schema is the catalogue's own, so all four tabs share one toolbar; the
 * filters a package has nothing for are ignored rather than rejected (see
 * `packageWhere`).
 */
export const packagesRouter = Router();

packagesRouter.patch(
  "/prepaid/:id/validity",
  auth,
  requireRole("SUPER_ADMIN", "MANAGER"),
  requireModule("packages"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(updatePrepaidValiditySchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const { id } = validated<{ id: string }>(req, "params");
      const { validityDays } = validated<UpdatePrepaidValidityInput>(req, "body");
      res.status(200).json({ data: await updatePrepaidValidity(id, validityDays) });
    } catch (error) {
      next(error);
    }
  },
);

packagesRouter.get(
  "/",
  auth,
  requireModule("packages"),
  validate(catalogueListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<CatalogueListQuery>(req, "query");
      res.status(200).json({ data: await listPackages(query) });
    } catch (error) {
      next(error);
    }
  },
);

packagesRouter.get(
  "/:id",
  auth,
  requireModule("packages"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.status(200).json({ data: await getPackage(id) });
    } catch (error) {
      next(error);
    }
  },
);

packagesRouter.post(
  "/",
  auth,
  requireModule("packages"),
  requireWritableTenant(),
  validate(createPackageSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<CreatePackageInput>(req, "body");
      if (
        (input.redemptionMode === "SERVICE_SET" || input.serviceSet !== undefined) &&
        !["SUPER_ADMIN", "MANAGER"].includes(req.user.globalRole)
      )
        throw forbidden("Only an owner or manager can configure service sets.");
      res.status(201).json({ data: await createPackage(input) });
    } catch (error) {
      next(error);
    }
  },
);

packagesRouter.patch(
  "/:id",
  auth,
  requireModule("packages"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(updatePackageSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<UpdatePackageInput>(req, "body");
      if (
        (input.redemptionMode !== undefined ||
          input.serviceSet !== undefined ||
          (await getPackage(id)).redemptionMode === "SERVICE_SET") &&
        !["SUPER_ADMIN", "MANAGER"].includes(req.user.globalRole)
      )
        throw forbidden("Only an owner or manager can configure service sets.");
      res.status(200).json({ data: await updatePackage(id, input) });
    } catch (error) {
      next(error);
    }
  },
);
