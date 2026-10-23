import { Router } from "express";
import {
  commissionOptionsQuerySchema,
  commissionPreviewSchema,
  commissionQuerySchema,
  publishCommissionRuleSchema,
  type PublishCommissionRule,
} from "@glampro_suite/shared";
import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import {
  commissionConfiguration,
  commissionOptions,
  previewCommission,
  publishCommissionRule,
} from "../services/commission.service.js";

export const commissionsRouter = Router();
commissionsRouter.use(auth, requireModule("staff"), requireRole("SUPER_ADMIN", "MANAGER"));
commissionsRouter.get("/", validate(commissionQuerySchema, "query"), async (req, res, next) => {
  try {
    const query = validated<{ staffId?: string; page: number }>(req, "query");
    res.json({ data: await commissionConfiguration(query.staffId, query.page) });
  } catch (error) {
    next(error);
  }
});
commissionsRouter.get(
  "/options",
  validate(commissionOptionsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<{ itemKind: "SERVICE" | "PRODUCT"; search: string }>(req, "query");
      res.json({ data: await commissionOptions(query.itemKind, query.search) });
    } catch (error) {
      next(error);
    }
  },
);
commissionsRouter.post("/preview", validate(commissionPreviewSchema), async (req, res, next) => {
  try {
    res.json({ data: await previewCommission(validated(req, "body")) });
  } catch (error) {
    next(error);
  }
});
commissionsRouter.post(
  "/",
  requireWritableTenant(),
  validate(publishCommissionRuleSchema),
  async (req, res, next) => {
    try {
      res.status(201).json({
        data: await publishCommissionRule(
          validated<PublishCommissionRule>(req, "body"),
          req.user!.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
