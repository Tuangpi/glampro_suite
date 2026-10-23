/** Authenticated, tenant-scoped read-only assistant drafts. */
import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { aiAssistantService } from "../services/ai-assistant.service.js";
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
