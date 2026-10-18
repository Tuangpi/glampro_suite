import { Router } from "express";
import {
  catalogueListQuerySchema,
  createServiceSchema,
  idParamSchema,
  updateServiceSchema,
  type CatalogueListQuery,
  type CreateServiceInput,
  type UpdateServiceInput,
} from "@glampro_suite/shared";

import { auth, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";
import {
  createService,
  getService,
  listServices,
  updateService,
} from "../services/catalogue.service.js";

/**
 * Services — the second tab of handoff screen 08.
 *
 * A separate mount rather than `?type=` on `/products`, because the two are separate
 * resources with separate columns: a service has no `quantity` and is never
 * "low stock". They share the `catalogue` module and the `catalogueListQuerySchema`
 * filter set, so the two tabs behave alike without pretending to be one table.
 *
 * There is no Services entry on the rail and no screen of its own
 * ([ADR 0005](../../../../PROJECT.md#adr-0005));
 * this mount exists so the tab, the sale flow and the appointment flow all reach the
 * same rule.
 */
export const servicesRouter = Router();

servicesRouter.get(
  "/",
  auth,
  requireModule("catalogue"),
  validate(catalogueListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<CatalogueListQuery>(req, "query");
      res.status(200).json({ data: await listServices(query) });
    } catch (error) {
      next(error);
    }
  },
);

servicesRouter.get(
  "/:id",
  auth,
  requireModule("catalogue"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.status(200).json({ data: await getService(id) });
    } catch (error) {
      next(error);
    }
  },
);

servicesRouter.post(
  "/",
  auth,
  requireModule("catalogue"),
  requireWritableTenant(),
  validate(createServiceSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<CreateServiceInput>(req, "body");
      res.status(201).json({ data: await createService(input) });
    } catch (error) {
      next(error);
    }
  },
);

servicesRouter.patch(
  "/:id",
  auth,
  requireModule("catalogue"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(updateServiceSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<UpdateServiceInput>(req, "body");
      res.status(200).json({ data: await updateService(id, input) });
    } catch (error) {
      next(error);
    }
  },
);
