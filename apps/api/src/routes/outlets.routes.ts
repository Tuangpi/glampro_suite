import { Router } from "express";
import {
  createOutletSchema,
  updateOutletSchema,
  outletAssignmentSchema,
  idParamSchema,
  type CreateOutletInput,
  type UpdateOutletInput,
  type OutletAssignmentInput,
} from "@glampro_suite/shared";
import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { validate, validated } from "../middleware/validate.js";
import {
  createOutlet,
  listOutlets,
  updateOutlet,
  assignOutlet,
} from "../services/outlet.service.js";

export const outletsRouter = Router();
outletsRouter.use(auth);
outletsRouter.get("/", async (_req, res, next) => {
  try {
    res.json({ data: await listOutlets() });
  } catch (error) {
    next(error);
  }
});
outletsRouter.use(requireRole("SUPER_ADMIN", "MANAGER"), requireWritableTenant());
outletsRouter.post("/", validate(createOutletSchema), async (req, res, next) => {
  try {
    res.status(201).json({ data: await createOutlet(validated<CreateOutletInput>(req, "body")) });
  } catch (error) {
    next(error);
  }
});
outletsRouter.post("/assign", validate(outletAssignmentSchema), async (req, res, next) => {
  try {
    res.json({ data: await assignOutlet(validated<OutletAssignmentInput>(req, "body")) });
  } catch (error) {
    next(error);
  }
});
outletsRouter.patch(
  "/:id",
  validate(idParamSchema, "params"),
  validate(updateOutletSchema),
  async (req, res, next) => {
    try {
      res.json({
        data: await updateOutlet(
          validated<{ id: string }>(req, "params").id,
          validated<UpdateOutletInput>(req, "body"),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
