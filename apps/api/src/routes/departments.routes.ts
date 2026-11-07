import { Router } from "express";

import {
  idParamSchema,
  saveDepartmentSchema,
  type SaveDepartmentInput,
} from "@glampro_suite/shared";
import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import {
  createDepartment,
  deleteDepartment,
  getDepartmentDeletionImpact,
  listDepartments,
  renameDepartment,
} from "../services/department.service.js";
import { unauthorized } from "../lib/http-error.js";

/**
 * Departments — shared salon sections, not physical outlets.
 *
 * Picker reads serve every form. Management and deletion impact are manager/admin-only.
 *
 * Guarded by `catalogue` rather than a module of its own, because there is no
 * `departments` module code to guard it with. Both callers — the catalogue forms and
 * the staff form — are core modules, so what this really buys is the tenant context
 * `requireModule` insists on (a branch list is meaningless without a salon) plus the
 * same 403 shape as every other route. It is deliberately not `packages` or another
 * add-on: a picker that a form cannot load would be a worse failure than a shared
 * boundary.
 */
export const departmentsRouter = Router();

departmentsRouter.get(
  "/:id/deletion-impact",
  auth,
  requireModule("catalogue"),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.json({ data: await getDepartmentDeletionImpact(id) });
    } catch (error) {
      next(error);
    }
  },
);

departmentsRouter.delete(
  "/:id",
  auth,
  requireModule("catalogue"),
  requireRole("SUPER_ADMIN", "MANAGER"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const { id } = validated<{ id: string }>(req, "params");
      res.json({ data: await deleteDepartment(id, req.user.id) });
    } catch (error) {
      next(error);
    }
  },
);

departmentsRouter.get("/", auth, requireModule("catalogue"), async (_req, res, next) => {
  try {
    res.status(200).json({ data: await listDepartments() });
  } catch (error) {
    next(error);
  }
});

departmentsRouter.post(
  "/",
  auth,
  requireModule("catalogue"),
  requireRole("SUPER_ADMIN", "MANAGER"),
  requireWritableTenant(),
  validate(saveDepartmentSchema),
  async (req, res, next) => {
    try {
      res
        .status(201)
        .json({ data: await createDepartment(validated<SaveDepartmentInput>(req, "body")) });
    } catch (error) {
      next(error);
    }
  },
);

departmentsRouter.patch(
  "/:id",
  auth,
  requireModule("catalogue"),
  requireRole("SUPER_ADMIN", "MANAGER"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(saveDepartmentSchema),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res
        .status(200)
        .json({ data: await renameDepartment(id, validated<SaveDepartmentInput>(req, "body")) });
    } catch (error) {
      next(error);
    }
  },
);
