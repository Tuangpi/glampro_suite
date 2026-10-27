import { Router } from "express";
import {
  publishCommissionAttributionPolicySchema,
  type PublishCommissionAttributionPolicy,
} from "@glampro_suite/shared";
import {
  readCommissionAttributionPolicy,
  publishCommissionAttributionPolicy,
} from "../services/commission-attribution-policy.js";
import {
  commissionOptionsQuerySchema,
  commissionPreviewSchema,
  commissionQuerySchema,
  publishCommissionRuleSchema,
  bulkPublishCommissionRulesSchema,
  commissionMatrixQuerySchema,
  type CommissionKind,
  type BulkPublishCommissionRules,
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
  publishCommissionRules,
  commissionMatrix,
} from "../services/commission.service.js";

export const commissionsRouter = Router();
commissionsRouter.use(auth, requireModule("staff"), requireRole("SUPER_ADMIN", "MANAGER"));
commissionsRouter.get(
  "/matrix",
  validate(commissionMatrixQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<{ page: number; search: string }>(req, "query");
      res.json({ data: await commissionMatrix(query.page, query.search) });
    } catch (error) {
      next(error);
    }
  },
);
commissionsRouter.post(
  "/bulk",
  requireWritableTenant(),
  validate(bulkPublishCommissionRulesSchema),
  async (req, res, next) => {
    try {
      res.status(201).json({
        data: await publishCommissionRules(
          validated<BulkPublishCommissionRules>(req, "body"),
          req.user!.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
commissionsRouter.get("/attribution-policy", async (_req, res, next) => {
  try {
    res.json({ data: await readCommissionAttributionPolicy() });
  } catch (error) {
    next(error);
  }
});
commissionsRouter.post(
  "/attribution-policy",
  requireWritableTenant(),
  validate(publishCommissionAttributionPolicySchema),
  async (req, res, next) => {
    try {
      res.json({
        data: await publishCommissionAttributionPolicy(
          validated<PublishCommissionAttributionPolicy>(req, "body"),
          req.user!.id,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
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
      const query = validated<{ itemKind: CommissionKind; search: string }>(req, "query");
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
