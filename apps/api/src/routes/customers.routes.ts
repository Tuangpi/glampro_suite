import { Router } from "express";
import multer from "multer";
import { customerPhotoCaptionSchema, type PaginationQuery } from "@glampro_suite/shared";
import { badRequest } from "../lib/http-error.js";
import {
  addCustomerPhoto,
  deleteCustomerPhoto,
  getCustomerPhoto,
  listCustomerPhotos,
  listCustomerPurchases,
  listCustomerVisits,
} from "../services/customer-profile.service.js";
import {
  recordCustomerConsentSchema,
  paginationQuerySchema,
  type RecordCustomerConsentInput,
} from "@glampro_suite/shared";
import { getCustomerConsent, recordCustomerConsent } from "../services/consent.service.js";
import {
  createCustomerSchema,
  archiveCustomerSchema,
  type ArchiveCustomerInput,
  customerListQuerySchema,
  idParamSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type CustomerListQuery,
  type UpdateCustomerInput,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";
import {
  createCustomer,
  archiveCustomer,
  getCustomer,
  getCustomerHoldings,
  listCustomers,
  updateCustomer,
} from "../services/customer.service.js";

/**
 * Customers — handoff screen 07.
 *
 * Reads are open to every signed-in member of the salon; writes additionally
 * require a writable tenant, because a `SUSPENDED` salon may look at its data but
 * must not change it (`docs/saas/TENANCY.md` §6).
 *
 * `requireModule("customers")` is the entitlement boundary — hiding the rail entry
 * is a convenience, this is the rule. `customers` is a core module, so a tenant
 * that exists passes it.
 */
export const customersRouter = Router();

customersRouter.post(
  "/:id/archive",
  auth,
  requireModule("customers"),
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(idParamSchema, "params"),
  validate(archiveCustomerSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const { id } = validated<{ id: string }>(req, "params");
      res.json({
        data: await archiveCustomer(id, validated<ArchiveCustomerInput>(req, "body"), req.user.id),
      });
    } catch (error) {
      next(error);
    }
  },
);

for (const [path, list] of [
  ["visits", listCustomerVisits],
  ["purchases", listCustomerPurchases],
  ["photos", listCustomerPhotos],
] as const) {
  customersRouter.get(
    `/:id/${path}`,
    auth,
    requireModule("customers"),
    validate(idParamSchema, "params"),
    validate(paginationQuerySchema, "query"),
    async (req, res, next) => {
      try {
        const { id } = validated<{ id: string }>(req, "params");
        res.json({ data: await list(id, validated<PaginationQuery>(req, "query")) });
      } catch (error) {
        next(error);
      }
    },
  );
}

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, fieldSize: 2000 },
}).single("photo");

customersRouter.post(
  "/:id/photos",
  auth,
  requireModule("customers"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  (req, res, next) =>
    uploadPhoto(req, res, (error: unknown) => {
      if (error)
        return next(
          badRequest("Choose one JPEG or PNG photo up to 5 MB and a caption up to 500 characters."),
        );
      next();
    }),
  validate(customerPhotoCaptionSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      if (!req.file) throw badRequest("Choose a photo to upload.");
      const { id } = validated<{ id: string }>(req, "params");
      const { caption } = validated<{ caption: string }>(req, "body");
      res
        .status(201)
        .json({ data: await addCustomerPhoto(id, req.file.buffer, caption, req.user.id) });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/:id/photos/:photoId",
  auth,
  requireModule("customers"),
  async (req, res, next) => {
    try {
      const photo = await getCustomerPhoto(String(req.params.id), String(req.params.photoId));
      res.set({
        "Content-Type": photo.mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      });
      res.send(Buffer.from(photo.content));
    } catch (error) {
      next(error);
    }
  },
);
customersRouter.delete(
  "/:id/photos/:photoId",
  auth,
  requireModule("customers"),
  requireWritableTenant(),
  async (req, res, next) => {
    try {
      await deleteCustomerPhoto(String(req.params.id), String(req.params.photoId));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/:id/consent",
  auth,
  requireModule("customers"),
  validate(idParamSchema, "params"),
  validate(paginationQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      const { page, pageSize } = validated<{ page: number; pageSize: number }>(req, "query");
      res.json({ data: await getCustomerConsent(id, page, pageSize) });
    } catch (error) {
      next(error);
    }
  },
);
customersRouter.post(
  "/:id/consent",
  auth,
  requireModule("customers"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(recordCustomerConsentSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const { id } = validated<{ id: string }>(req, "params");
      res.json({
        data: await recordCustomerConsent(
          id,
          validated<RecordCustomerConsentInput>(req, "body"),
          req.user.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/",
  auth,
  requireModule("customers"),
  validate(customerListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<CustomerListQuery>(req, "query");
      res.status(200).json({ data: await listCustomers(query) });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/:id/holdings",
  auth,
  requireModule("customers"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.status(200).json({ data: await getCustomerHoldings(id) });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/:id",
  auth,
  requireModule("customers"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.status(200).json({ data: await getCustomer(id) });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.post(
  "/",
  auth,
  requireModule("customers"),
  requireWritableTenant(),
  validate(createCustomerSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<CreateCustomerInput>(req, "body");
      res.status(201).json({ data: await createCustomer(input) });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.patch(
  "/:id",
  auth,
  requireModule("customers"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(updateCustomerSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<UpdateCustomerInput>(req, "body");
      res.status(200).json({ data: await updateCustomer(id, input, req.user!.id) });
    } catch (error) {
      next(error);
    }
  },
);
