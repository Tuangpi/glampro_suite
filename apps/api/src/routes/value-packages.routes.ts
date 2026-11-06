import { Router } from "express";
import {
  catalogueListQuerySchema,
  createValuePackageSchema,
  idParamSchema,
  updateValuePackageSchema,
  type CatalogueListQuery,
  type CreateValuePackageInput,
  type UpdateValuePackageInput,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";
import {
  createValuePackage,
  getValuePackage,
  listValuePackages,
  updateValuePackage,
} from "../services/value-package.service.js";

/**
 * Value packages — prepaid credit, the fifth tab of handoff screen 08.
 *
 * A separate mount from `/packages` for two reasons: the row is a different resource
 * (money rather than sessions), and the existing `/packages/prepaid/:id/validity`
 * route would otherwise collide with a `GET /prepaid/:id`. It shares the `packages`
 * **add-on** entitlement, so a salon that has not bought the add-on is refused with
 * `MODULE_NOT_ENTITLED` rather than shown an empty tab.
 *
 * Reads are open to the salon — describing the shelf is not an admin act, the same
 * rule `gift-cards.routes.ts` follows. **Writes are manager-only**, which is stricter
 * than the gift-card mount and deliberately so: this route sets a price and the
 * credit that price buys, and `PATCH /api/packages/prepaid/:id/validity` already
 * guards the same money with `requireRole`. A staff-level editor here would undo that
 * guard by another door.
 *
 * There is no `DELETE`. `ValuePackageService` and `CustomerValuePackageHolding`
 * cascade from the row, so a delete would erase purchase history; `status: INACTIVE`
 * retires it from the till instead.
 */
export const valuePackagesRouter = Router();

valuePackagesRouter.get(
  "/",
  auth,
  requireModule("packages"),
  validate(catalogueListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<CatalogueListQuery>(req, "query");
      res.status(200).json({ data: await listValuePackages(query) });
    } catch (error) {
      next(error);
    }
  },
);

valuePackagesRouter.get(
  "/:id",
  auth,
  requireModule("packages"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.status(200).json({ data: await getValuePackage(id) });
    } catch (error) {
      next(error);
    }
  },
);

valuePackagesRouter.post(
  "/",
  auth,
  requireRole("SUPER_ADMIN", "MANAGER"),
  requireModule("packages"),
  requireWritableTenant(),
  validate(createValuePackageSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<CreateValuePackageInput>(req, "body");
      res.status(201).json({ data: await createValuePackage(input) });
    } catch (error) {
      next(error);
    }
  },
);

valuePackagesRouter.patch(
  "/:id",
  auth,
  requireRole("SUPER_ADMIN", "MANAGER"),
  requireModule("packages"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(updateValuePackageSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<UpdateValuePackageInput>(req, "body");
      res.status(200).json({ data: await updateValuePackage(id, input) });
    } catch (error) {
      next(error);
    }
  },
);
