import { Router } from "express";
import {
  companyListQuerySchema,
  createCompanySchema,
  acceptOwnerInvitationSchema,
  idParamSchema,
  type CompanyListQuery,
  type CreateCompanyInput,
  type AcceptOwnerInvitationInput,
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

export const companiesRouter = Router();
companiesRouter.use(platformAuth);
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
