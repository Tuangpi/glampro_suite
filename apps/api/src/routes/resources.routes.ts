import { Router } from "express";
import {
  createResourceSchema,
  idParamSchema,
  resourceListQuerySchema,
  updateResourceSchema,
  type CreateResourceInput,
  type ResourceListQuery,
  type UpdateResourceInput,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";
import {
  createResource,
  getResource,
  listResources,
  updateResource,
} from "../services/resource.service.js";

/**
 * Rooms and equipment — TK2610-0020 phase D (`/api/resources`).
 *
 * Guarded by the `appointments` module rather than a module of its own: a
 * resource exists to be booked, `appointments` is core, and a second entitlement
 * code would be a switch no salon could ever turn off. The settings card that
 * edits this list is the same rule the staff screen keeps — **reads for every
 * signed-in member** (a stylist has to know which room they are in) and **writes
 * for `SUPER_ADMIN`/`MANAGER`**, because describing the salon's rooms is
 * configuration, not booking.
 *
 * There is deliberately no `DELETE`: `status: INACTIVE` is the archive, so a room
 * that is being redecorated stops taking new bookings without erasing the ones
 * already taken in it (the same exit services and staff have).
 */
export const resourcesRouter = Router();

resourcesRouter.get(
  "/",
  auth,
  requireModule("appointments"),
  validate(resourceListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<ResourceListQuery>(req, "query");
      res.status(200).json({ data: await listResources(query) });
    } catch (error) {
      next(error);
    }
  },
);

resourcesRouter.get(
  "/:id",
  auth,
  requireModule("appointments"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.status(200).json({ data: await getResource(id) });
    } catch (error) {
      next(error);
    }
  },
);

resourcesRouter.post(
  "/",
  auth,
  requireModule("appointments"),
  requireRole("SUPER_ADMIN", "MANAGER"),
  requireWritableTenant(),
  validate(createResourceSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<CreateResourceInput>(req, "body");
      res.status(201).json({ data: await createResource(input) });
    } catch (error) {
      next(error);
    }
  },
);

resourcesRouter.patch(
  "/:id",
  auth,
  requireModule("appointments"),
  requireRole("SUPER_ADMIN", "MANAGER"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(updateResourceSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<UpdateResourceInput>(req, "body");
      res.status(200).json({ data: await updateResource(id, input) });
    } catch (error) {
      next(error);
    }
  },
);
