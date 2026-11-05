import { Router } from "express";
import {
  companyListQuerySchema,
  createCompanySchema,
  updateCompanySchema,
  acceptOwnerInvitationSchema,
  idParamSchema,
  type CompanyListQuery,
  type CreateCompanyInput,
  type UpdateCompanyInput,
  type AcceptOwnerInvitationInput,
  companyLifecycleSchema,
  recordSubscriptionSchema,
  companyModuleSchema,
  companyModulesBulkSchema,
  companyAuditQuerySchema,
  companyPurgeSchema,
  type CompanyLifecycleInput,
  type RecordSubscriptionInput,
  type CompanyModuleInput,
  type CompanyModulesBulkInput,
  type CompanyAuditQuery,
  type CompanyPurgeInput,
} from "@glampro_suite/shared";
import { platformAuth } from "../middleware/platform-auth.js";
import { validate, validated } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimit.js";
import {
  listCompanies,
  companyDetail,
  createCompany,
  updateCompany,
  resendOwnerInvitation,
  acceptOwnerInvitation,
} from "../services/company.service.js";
import {
  companyAdministration,
  companyAudit,
  changeCompanyLifecycle,
  recordCompanySubscription,
  changeCompanyModule,
  changeCompanyModules,
} from "../services/company-administration.service.js";
import { purgeCompany } from "../services/company-purge.service.js";

export const companiesRouter = Router();
companiesRouter.use(platformAuth);
companiesRouter.get(
  "/:id/administration",
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      res.json({ data: await companyAdministration(validated<{ id: string }>(req, "params").id) });
    } catch (error) {
      next(error);
    }
  },
);
companiesRouter.get(
  "/:id/audit",
  validate(idParamSchema, "params"),
  validate(companyAuditQuerySchema, "query"),
  async (req, res, next) => {
    try {
      res.json({
        data: await companyAudit(
          validated<{ id: string }>(req, "params").id,
          validated<CompanyAuditQuery>(req, "query"),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
companiesRouter.post(
  "/:id/lifecycle",
  authLimiter,
  validate(idParamSchema, "params"),
  validate(companyLifecycleSchema),
  async (req, res, next) => {
    try {
      res.json({
        data: await changeCompanyLifecycle(
          validated<{ id: string }>(req, "params").id,
          validated<CompanyLifecycleInput>(req, "body"),
          res.locals.platformAdmin.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
companiesRouter.post(
  "/:id/subscriptions",
  authLimiter,
  validate(idParamSchema, "params"),
  validate(recordSubscriptionSchema),
  async (req, res, next) => {
    try {
      res.status(201).json({
        data: await recordCompanySubscription(
          validated<{ id: string }>(req, "params").id,
          validated<RecordSubscriptionInput>(req, "body"),
          res.locals.platformAdmin.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
companiesRouter.post(
  "/:id/modules",
  authLimiter,
  validate(idParamSchema, "params"),
  validate(companyModuleSchema),
  async (req, res, next) => {
    try {
      res.json({
        data: await changeCompanyModule(
          validated<{ id: string }>(req, "params").id,
          validated<CompanyModuleInput>(req, "body"),
          res.locals.platformAdmin.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
/**
 * Every add-on at once, under one reason.
 *
 * A `POST` beside `/:id/modules` rather than a flag on it: the body is a different
 * shape (no `code`), and the answer is a report of what moved rather than
 * `{ success: true }`. It is a path of its own so a client that sends a `code` here
 * gets a `422` instead of having the field ignored.
 */
companiesRouter.post(
  "/:id/modules/bulk",
  authLimiter,
  validate(idParamSchema, "params"),
  validate(companyModulesBulkSchema),
  async (req, res, next) => {
    try {
      res.json({
        data: await changeCompanyModules(
          validated<{ id: string }>(req, "params").id,
          validated<CompanyModulesBulkInput>(req, "body"),
          res.locals.platformAdmin.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
companiesRouter.get("/", validate(companyListQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json({ data: await listCompanies(validated<CompanyListQuery>(req, "query")) });
  } catch (error) {
    next(error);
  }
});
companiesRouter.get("/:id", validate(idParamSchema, "params"), async (req, res, next) => {
  try {
    res.json({ data: await companyDetail(validated<{ id: string }>(req, "params").id) });
  } catch (error) {
    next(error);
  }
});
/**
 * Correct a company's identity, or give it an owner it never had.
 *
 * A `PATCH` on the company itself, not a fourth lifecycle action: lifecycle
 * changes what the company may do, this changes what it *is*. Nothing about
 * access moves here — a rename cannot suspend a salon.
 */
companiesRouter.patch(
  "/:id",
  authLimiter,
  validate(idParamSchema, "params"),
  validate(updateCompanySchema),
  async (req, res, next) => {
    try {
      res.json({
        data: await updateCompany(
          validated<{ id: string }>(req, "params").id,
          validated<UpdateCompanyInput>(req, "body"),
          res.locals.platformAdmin.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
companiesRouter.post("/", authLimiter, validate(createCompanySchema), async (req, res, next) => {
  try {
    res.status(201).json({
      data: await createCompany(
        validated<CreateCompanyInput>(req, "body"),
        res.locals.platformAdmin.id,
      ),
    });
  } catch (error) {
    next(error);
  }
});
companiesRouter.post(
  "/:id/invitation",
  authLimiter,
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      res.json({
        data: await resendOwnerInvitation(
          validated<{ id: string }>(req, "params").id,
          res.locals.platformAdmin.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
/**
 * Permanent removal. Deliberately a `DELETE` and not a fourth lifecycle action:
 * suspend/reactivate/cancel keep the data, this does not, so the verb has to say so
 * and a client cannot reach it by mistyping a lifecycle action.
 */
companiesRouter.delete(
  "/:id",
  authLimiter,
  validate(idParamSchema, "params"),
  validate(companyPurgeSchema),
  async (req, res, next) => {
    try {
      res.json({
        data: await purgeCompany(
          validated<{ id: string }>(req, "params").id,
          validated<CompanyPurgeInput>(req, "body"),
          res.locals.platformAdmin.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
export const ownerInvitationRouter = Router();
ownerInvitationRouter.post(
  "/accept",
  authLimiter,
  validate(acceptOwnerInvitationSchema),
  async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json({
        data: await acceptOwnerInvitation(validated<AcceptOwnerInvitationInput>(req, "body")),
      });
    } catch (error) {
      next(error);
    }
  },
);
