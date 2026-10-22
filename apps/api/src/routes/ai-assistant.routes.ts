/** AI Assistant routes — `/api/ai-assistant`.
 *
 * All functions run inside the tenant scope `middleware/auth.ts` opened, so
 * none of them takes a tenant id.
 */

import { Router, type Request, type Response } from "express";
import { aiAssistantService, type OwnerSummary, type RebookingNudge, type SlowDayPromo } from "../services/ai-assistant.service.js";

const router = Router();

/** GET /api/ai-assistant/owner-summary — Daily owner summary. */
router.get("/owner-summary", async (req: Request, res: Response) => {
  try {
    const query = {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    };

    const summary: OwnerSummary = await aiAssistantService.ownerSummary(query);
    res.json({ data: summary });
  } catch (error) {
    console.error("AI Assistant owner-summary error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

/** GET /api/ai-assistant/rebooking-nudges — Rebooking nudges. */
router.get("/rebooking-nudges", async (req: Request, res: Response) => {
  try {
    const query = {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      daysThreshold: req.query.daysThreshold
        ? Number(req.query.daysThreshold)
        : undefined,
    };

    const { nudges, requiresApproval } = await aiAssistantService.rebookingNudges(query);
    res.json({ data: nudges, requiresApproval });
  } catch (error) {
    console.error("AI Assistant rebooking-nudges error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

/** GET /api/ai-assistant/slow-day-promos — Slow-day promotional offers. */
router.get("/slow-day-promos", async (req: Request, res: Response) => {
  try {
    const query = {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      discountPercentage: req.query.discountPercentage
        ? Number(req.query.discountPercentage)
        : undefined,
    };

    const promos: SlowDayPromo[] = await aiAssistantService.slowDayPromos(query);
    res.json({ data: promos });
  } catch (error) {
    console.error("AI Assistant slow-day-promos error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;