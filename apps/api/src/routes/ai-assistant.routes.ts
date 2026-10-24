/** Authenticated, tenant-scoped assistant previews and explicit draft actions. */
import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { aiAssistantService } from "../services/ai-assistant.service.js";
import { quietDayQuerySchema, type QuietDayQuery } from "@glampro_suite/shared";
import { quietDayOpportunities } from "../services/quiet-day.service.js";
import {
  assistantExplanationInputSchema,
  type AssistantExplanationInput,
} from "@glampro_suite/shared";
import { assistantExplanation } from "../services/assistant-explanation.service.js";
import { assistantExplanationLimiter } from "../middleware/rateLimit.js";
import {
  assistantDraftInputSchema,
  assistantDraftEditSchema,
  assistantDraftActionSchema,
  assistantDraftReviewSchema,
} from "@glampro_suite/shared";
import {
  listAssistantDrafts,
  saveAssistantDraft,
  actOnAssistantDraft,
  assistantDraftHistory,
  reviewAssistantDraft,
} from "../services/assistant-drafts.service.js";
import {
  assistantRangeSchema,
  rebookingQuerySchema,
  promoQuerySchema,
  type AssistantRange,
  type RebookingQuery,
  type PromoQuery,
} from "../schemas/ai-assistant.js";

const router = Router();
router.use(auth, requireRole("SUPER_ADMIN", "MANAGER"), requireModule("dashboard"));
router.post(
  "/explain",
  assistantExplanationLimiter,
  validate(assistantExplanationInputSchema),
  async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json({
        data: await assistantExplanation(validated<AssistantExplanationInput>(req, "body")),
      });
    } catch (error) {
      next(error);
    }
  },
);
router.use("/drafts", requireModule("customers"), requireModule("appointments"));
router.post(
  "/drafts/:id/retention-review",
  validate(assistantDraftReviewSchema),
  async (req, res, next) => {
    try {
      const input = assistantDraftReviewSchema.parse(req.body);
      res.json({
        data: await reviewAssistantDraft(
          String(req.params.id),
          input.expectedVersion,
          input.reason,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
router.get("/drafts", async (req, res, next) => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    res.json({ data: await listAssistantDrafts(cursor) });
  } catch (error) {
    next(error);
  }
});
router.get("/drafts/:id/history", async (req, res, next) => {
  try {
    res.json({
      data: await assistantDraftHistory(
        String(req.params.id),
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      ),
    });
  } catch (error) {
    next(error);
  }
});
router.post("/drafts", validate(assistantDraftInputSchema), async (req, res, next) => {
  try {
    res
      .status(201)
      .json({ data: await saveAssistantDraft(assistantDraftInputSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});
router.patch("/drafts/:id", validate(assistantDraftEditSchema), async (req, res, next) => {
  try {
    const { expectedVersion, ...input } = assistantDraftEditSchema.parse(req.body);
    res.json({ data: await saveAssistantDraft(input, String(req.params.id), expectedVersion) });
  } catch (error) {
    next(error);
  }
});
for (const action of ["approve", "queue"] as const)
  router.post(
    `/drafts/:id/${action}`,
    validate(assistantDraftActionSchema),
    async (req, res, next) => {
      try {
        res.json({
          data: await actOnAssistantDraft(
            String(req.params.id),
            assistantDraftActionSchema.parse(req.body).expectedVersion,
            action,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );
router.get(
  "/quiet-day-opportunities",
  requireModule("appointments"),
  requireModule("catalogue"),
  validate(quietDayQuerySchema, "query"),
  async (req, res, next) => {
    try {
      res.json({ data: await quietDayOpportunities(validated<QuietDayQuery>(req, "query")) });
    } catch (error) {
      next(error);
    }
  },
);
router.get("/owner-summary", validate(assistantRangeSchema, "query"), async (req, res, next) => {
  try {
    res.json({
      data: await aiAssistantService.ownerSummary(validated<AssistantRange>(req, "query")),
    });
  } catch (error) {
    next(error);
  }
});
router.get(
  "/rebooking-nudges",
  requireModule("customers"),
  requireModule("appointments"),
  validate(rebookingQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { nudges, requiresApproval } = await aiAssistantService.rebookingNudges(
        validated<RebookingQuery>(req, "query"),
      );
      res.json({ data: nudges, requiresApproval });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/slow-day-promos",
  requireModule("appointments"),
  requireModule("catalogue"),
  validate(promoQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const data = await aiAssistantService.slowDayPromos(validated<PromoQuery>(req, "query"));
      res.json({ data, requiresApproval: true });
    } catch (error) {
      next(error);
    }
  },
);
export default router;
