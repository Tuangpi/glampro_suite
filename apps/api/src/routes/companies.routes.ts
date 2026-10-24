import { Router } from "express";
import {
  companyListQuerySchema,
  createCompanySchema,
  acceptOwnerInvitationSchema,
  idParamSchema,
  type CompanyListQuery,
  type CreateCompanyInput,
  type AcceptOwnerInvitationInput,
  companyLifecycleSchema,
  recordSubscriptionSchema,
  companyModuleSchema,
  companyAuditQuerySchema,
  type CompanyLifecycleInput,
  type RecordSubscriptionInput,
  type CompanyModuleInput,
  type CompanyAuditQuery,
} from "@glampro_suite/shared";
import { platformAuth } from "../middleware/platform-auth.js";
import { validate, validated } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimit.js";
import {
  listCompanies,
  companyDetail,
  createCompany,
  resendOwnerInvitation,
  acceptOwnerInvitation,
} from "../services/company.service.js";
import {
  companyAdministration,
  companyAudit,
  changeCompanyLifecycle,
  recordCompanySubscription,
  changeCompanyModule,
} from "../services/company-administration.service.js";

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
