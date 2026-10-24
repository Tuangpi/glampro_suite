import { Router } from "express";
import multer from "multer";
import {
  createPrepaidFamilySchema,
  changePrepaidMembershipSchema,
  sharePrepaidSchema,
  type SharePrepaidInput,
  type CreatePrepaidFamilyInput,
  type ChangePrepaidMembershipInput,
} from "@glampro_suite/shared";
import {
  getPrepaidFamily,
  createPrepaidFamily,
  changePrepaidMembership,
  listPrepaidFamilyEvents,
  sharePrepaid,
} from "../services/prepaid-family.service.js";
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
import {
  prepaidHoldingParamsSchema,
  transferPrepaidSchema,
  type TransferPrepaidInput,
} from "@glampro_suite/shared";
import {
  listOwnedPrepaid,
  listPrepaidTransfers,
  transferPrepaid,
  listPrepaidBalanceEvents,
} from "../services/prepaid.service.js";

import {
  sessionHoldingParamsSchema,
  transferSessionPackageSchema,
  type TransferSessionPackageInput,
} from "@glampro_suite/shared";
import {
  listOwnedSessionPackages,
  listSessionPackageTransfers,
  transferSessionPackage,
} from "../services/session-transfer.service.js";

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

for (const [path, list] of [
  ["session-packages", listOwnedSessionPackages],
  ["session-package-transfers", listSessionPackageTransfers],
] as const) {
  customersRouter.get(
    `/:id/${path}`,
    auth,
    requireModule("customers"),
    requireModule("packages"),
    validate(idParamSchema, "params"),
    validate(paginationQuerySchema, "query"),
    async (req, res, next) => {
      try {
        res.json({
          data: await list(
            validated<{ id: string }>(req, "params").id,
            validated<PaginationQuery>(req, "query"),
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );
}

customersRouter.post(
  "/:id/session-packages/:holdingId/transfer",
  auth,
  requireModule("customers"),
  requireModule("packages"),
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(sessionHoldingParamsSchema, "params"),
  validate(transferSessionPackageSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const { id, holdingId } = validated<{ id: string; holdingId: string }>(req, "params");
      res.status(201).json({
        data: await transferSessionPackage(
          id,
          holdingId,
          validated<TransferSessionPackageInput>(req, "body"),
          req.user.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/:id/prepaid-family",
  auth,
  requireModule("customers"),
  requireModule("packages"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      res.json({ data: await getPrepaidFamily(validated<{ id: string }>(req, "params").id) });
    } catch (error) {
      next(error);
    }
  },
);

for (const [path, schema, action] of [
  ["prepaid-family", createPrepaidFamilySchema, createPrepaidFamily],
  ["prepaid-family-membership", changePrepaidMembershipSchema, changePrepaidMembership],
] as const) {
  customersRouter.post(
    `/:id/${path}`,
    auth,
    requireModule("customers"),
    requireModule("packages"),
    requireWritableTenant(),
    requireRole("SUPER_ADMIN", "MANAGER"),
    validate(idParamSchema, "params"),
    validate<unknown>(schema),
    async (req, res, next) => {
      try {
        if (!req.user) throw unauthorized();
        const id = validated<{ id: string }>(req, "params").id;
        const data =
          action === createPrepaidFamily
            ? await createPrepaidFamily(
                id,
                validated<CreatePrepaidFamilyInput>(req, "body"),
                req.user.id,
              )
            : await changePrepaidMembership(
                id,
                validated<ChangePrepaidMembershipInput>(req, "body"),
                req.user.id,
              );
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );
}

for (const [path, list] of [
  ["prepaid", listOwnedPrepaid],
  ["prepaid-transfers", listPrepaidTransfers],
  ["prepaid-family-history", listPrepaidFamilyEvents],
  ["prepaid-balance-history", listPrepaidBalanceEvents],
] as const) {
  customersRouter.get(
    `/:id/${path}`,
    auth,
    requireModule("customers"),
    requireModule("packages"),
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

customersRouter.post(
  "/:id/prepaid/:holdingId/sharing",
  auth,
  requireModule("customers"),
  requireModule("packages"),
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(prepaidHoldingParamsSchema, "params"),
  validate(sharePrepaidSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const { id, holdingId } = validated<{ id: string; holdingId: string }>(req, "params");
      res.json({
        data: await sharePrepaid(
          id,
          holdingId,
          validated<SharePrepaidInput>(req, "body"),
          req.user.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.post(
  "/:id/prepaid/:holdingId/transfer",
  auth,
  requireModule("customers"),
  requireModule("packages"),
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(prepaidHoldingParamsSchema, "params"),
  validate(transferPrepaidSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const { id, holdingId } = validated<{ id: string; holdingId: string }>(req, "params");
      res.status(201).json({
        data: await transferPrepaid(
          id,
          holdingId,
          validated<TransferPrepaidInput>(req, "body"),
          req.user.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

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
