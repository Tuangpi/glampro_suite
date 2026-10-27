import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { verifyPosPin } from "../services/pos-pin.service.js";
import {
  createStaffSchema,
  idParamSchema,
  staffListQuerySchema,
  updateStaffSchema,
  type CreateStaffInput,
  type StaffListQuery,
  type UpdateStaffInput,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";
import { createStaff, getStaff, listStaff, updateStaff } from "../services/staff.service.js";

/**
 * Staff — handoff screen 09.
 *
 * **The first router in the app to mount `requireRole`**, which is what Q26 said was
 * implemented and unit-tested but exercised by nothing: reads are open to every
 * signed-in member of the salon (the rail entry is unrestricted — a stylist needs to
 * see the team). Profile edits allow `SUPER_ADMIN` or `MANAGER`; creation requires
 * `SUPER_ADMIN` because it includes audited payroll classification. A staff member
 * cannot create a colleague, rename a job title or disable an account with this API,
 * and the rule now has an integration test rather than an assertion in a doc.
 *
 * `requireModule("staff")` is the entitlement boundary; `requireWritableTenant()`
 * keeps a `SUSPENDED` salon read-only (`docs/saas/TENANCY.md` §6). The order matters
 * in one direction only: the role check runs after `auth`, because it reads
 * `req.user`, which is what `auth` sets.
 *
 * There is no delete. `disabled` **is** the archive: a disabled user keeps their
 * appointments and their commission history, which is why the Phase 4 criterion's
 * third verb exists here and not on customers (Q28).
 */
export const staffRouter = Router();

const pinInput = z.object({ staffId: z.string().min(1).max(64), pin: z.string().regex(/^\d{6}$/) });
staffRouter.post(
  "/pos-pin/verify",
  auth,
  requireModule("sales"),
  requireWritableTenant(),
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  validate(pinInput),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const input = validated<z.infer<typeof pinInput>>(req, "body");
      res.json({
        data: await verifyPosPin(input.staffId, input.pin, req.user.id, req.get("authorization")!),
      });
    } catch (error) {
      next(error);
    }
  },
);

staffRouter.get(
  "/",
  auth,
  requireModule("staff"),
  validate(staffListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<StaffListQuery>(req, "query");
      res.status(200).json({ data: await listStaff(query) });
    } catch (error) {
      next(error);
    }
  },
);

staffRouter.get(
  "/:id",
  auth,
  requireModule("staff"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.status(200).json({ data: await getStaff(id) });
    } catch (error) {
      next(error);
    }
  },
);

staffRouter.post(
  "/",
  auth,
  requireModule("staff"),
  requireWritableTenant(),
  // Creation includes owner-audited payroll classification in the same transaction.
  requireRole("SUPER_ADMIN"),
  validate(createStaffSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<CreateStaffInput>(req, "body");
      res.status(201).json({ data: await createStaff(input) });
    } catch (error) {
      next(error);
    }
  },
);

staffRouter.patch(
  "/:id",
  auth,
  requireModule("staff"),
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(idParamSchema, "params"),
  validate(updateStaffSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<UpdateStaffInput>(req, "body");
      res.status(200).json({ data: await updateStaff(id, input) });
    } catch (error) {
      next(error);
    }
  },
);
