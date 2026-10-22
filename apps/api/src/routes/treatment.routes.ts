import { Router } from "express";
import {
  createTreatmentConsentEventSchema,
  createTreatmentConsentFormSchema,
  createTreatmentPhotoSchema,
  createTreatmentRecordSchema,
  idParamSchema,
  treatmentRecordListQuerySchema,
  treatmentRedemptionQuerySchema,
  treatmentConsentTypeParamsSchema,
  treatmentConsentFormListQuerySchema,
  type TreatmentConsentFormListQuery,
  type TreatmentRedemptionQuery,
  type CreateTreatmentConsentEventInput,
  type CreateTreatmentConsentFormInput,
  type CreateTreatmentPhotoInput,
  type CreateTreatmentRecordInput,
  type TreatmentRecordListQuery,
} from "@glampro_suite/shared";
import {
  addTreatmentPhoto,
  createTreatmentConsentForm,
  createTreatmentRecord,
  deleteTreatmentRecord,
  getActiveConsentForm,
  getTreatmentRecord,
  listConsentEvents,
  listTreatmentConsentForms,
  listTreatmentRecords,
  listTreatmentRedemptions,
  removeTreatmentPhoto,
  recordTreatmentConsentEvent,
  updateTreatmentRecord,
} from "../services/treatment.service.js";
import { auth, requireWritableTenant } from "../middleware/auth.js";
import {
  updateTreatmentRecordSchema,
  type UpdateTreatmentRecordInput,
} from "@glampro_suite/shared";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";

/**
 * Aesthetics module — treatment records, before/after photos, treatment consent.
 *
 * Reads are open to every signed-in member of the salon; writes additionally
 * require a writable tenant. `requireModule("treatments")` is the entitlement
 * boundary.
 */
export const treatmentRouter = Router();

/** GET /api/treatments — list treatment records with optional filters. */
treatmentRouter.get(
  "/",
  auth,
  requireModule("treatments"),
  validate(treatmentRecordListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<TreatmentRecordListQuery>(req, "query");
      res.json({ data: await listTreatmentRecords(query) });
    } catch (error) {
      next(error);
    }
  },
);

/** Read-only, customer-scoped eligible POS evidence. Must precede /:id. */
treatmentRouter.get(
  "/redemptions",
  auth,
  requireModule("treatments"),
  validate(treatmentRedemptionQuerySchema, "query"),
  async (req, res, next) => {
    try {
      res.json({
        data: await listTreatmentRedemptions(validated<TreatmentRedemptionQuery>(req, "query")),
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/treatments/:id — get one treatment record with photos and consent events. */
treatmentRouter.get(
  "/:id",
  auth,
  requireModule("treatments"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.json({ data: await getTreatmentRecord(id) });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/treatments — create a treatment record. */
treatmentRouter.post(
  "/",
  auth,
  requireModule("treatments"),
  requireWritableTenant(),
  validate(createTreatmentRecordSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const input = validated<CreateTreatmentRecordInput>(req, "body");
      res.status(201).json({
        data: await createTreatmentRecord(input),
      });
    } catch (error) {
      next(error);
    }
  },
);

/** PATCH /api/treatments/:id — update a treatment record. */
treatmentRouter.patch(
  "/:id",
  auth,
  requireModule("treatments"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(updateTreatmentRecordSchema),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<UpdateTreatmentRecordInput>(req, "body");
      res.json({ data: await updateTreatmentRecord(id, input) });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /api/treatments/:id — delete a treatment record. */
treatmentRouter.delete(
  "/:id",
  auth,
  requireModule("treatments"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      await deleteTreatmentRecord(id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/treatments/:id/photos — link a before/after photo. */
treatmentRouter.post(
  "/:id/photos",
  auth,
  requireModule("treatments"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(createTreatmentPhotoSchema),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<CreateTreatmentPhotoInput>(req, "body");
      res.status(201).json({ data: await addTreatmentPhoto({ ...input, treatmentRecordId: id }) });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/treatments/consent/forms — list active consent forms. */
treatmentRouter.get(
  "/consent/forms",
  auth,
  requireModule("treatments"),
  validate(treatmentConsentFormListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      res.json({
        data: await listTreatmentConsentForms(
          validated<TreatmentConsentFormListQuery>(req, "query"),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/treatments/consent/forms/active/:treatmentType — latest active form for a type. */
treatmentRouter.get(
  "/consent/forms/active/:treatmentType",
  auth,
  requireModule("treatments"),
  validate(treatmentConsentTypeParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const { treatmentType } = validated<{ treatmentType: string }>(req, "params");
      const form = await getActiveConsentForm(treatmentType);
      res.json({ data: form });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/treatments/consent/forms — create a new consent form version. */
treatmentRouter.post(
  "/consent/forms",
  auth,
  requireModule("treatments"),
  requireWritableTenant(),
  validate(createTreatmentConsentFormSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const input = validated<CreateTreatmentConsentFormInput>(req, "body");
      res.status(201).json({
        data: await createTreatmentConsentForm(input),
      });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/treatments/:id/consent — record a consent event. */
treatmentRouter.post(
  "/:id/consent",
  auth,
  requireModule("treatments"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(createTreatmentConsentEventSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<CreateTreatmentConsentEventInput>(req, "body");
      res.status(201).json({
        data: await recordTreatmentConsentEvent({ ...input, treatmentRecordId: id }, req.user.id),
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/treatments/:id/consent — list consent events for a record. */
treatmentRouter.get(
  "/:id/consent",
  auth,
  requireModule("treatments"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.json({ data: await listConsentEvents(id) });
    } catch (error) {
      next(error);
    }
  },
);
/** DELETE /api/treatments/:id/photos/:photoId — remove a photo link. */
treatmentRouter.delete(
  "/:id/photos/:photoId",
  auth,
  requireModule("treatments"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      await removeTreatmentPhoto(String(req.params.id), String(req.params.photoId));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
