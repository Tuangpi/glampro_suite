import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { verifyPosPin } from "../services/pos-pin.service.js";
import {
  createStaffSchema,
  idParamSchema,
  resetStaffPasswordSchema,
  staffListQuerySchema,
  updateStaffSchema,
  type CreateStaffInput,
  type ResetStaffPasswordInput,
  type StaffListQuery,
  type UpdateStaffInput,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";
import {
  createStaff,
  getStaff,
  listStaff,
  resetStaffPassword,
  updateStaff,
} from "../services/staff.service.js";

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
 * `POST /:id/password` is the one credential route, and the one place a manager may
 * touch a login: recovering a forgotten password is a front-desk problem, so
 * `MANAGER` is admitted — but only against `STAFF` and `CASHIER` rows, never a peer
 * manager and never an owner. That limit lives in the service, where the target's
 * role is known.
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

/**
 * Setting another person's password — the recovery path for a forgotten login.
 *
 * `SUPER_ADMIN` **and** `MANAGER`, unlike creation: a manager already edits profiles
 * here, and "the new stylist cannot sign in" is a front-desk problem that should not
 * wait for the owner. The limits that make that safe live in the service rather than
 * in the role list: a manager may recover `STAFF` and `CASHIER` accounts only, never
 * a peer manager's and never an owner's, because a credential write is a takeover
 * primitive rather than an edit.
 *
 * `POST` rather than a `PATCH` field because it is a command with session semantics —
 * it bumps `tokenVersion` and revokes the target's refresh tokens, which is why
 * `updateStaffSchema` still has no `password` at all. The response mirrors
 * `/api/auth/change-password`, in the third person: the caller keeps their session,
 * the target loses theirs.
 */
staffRouter.post(
  "/:id/password",
  auth,
  requireModule("staff"),
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(idParamSchema, "params"),
  validate(resetStaffPasswordSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<ResetStaffPasswordInput>(req, "body");
      await resetStaffPassword(id, input, req.user.globalRole);

      res.status(200).json({
        data: { success: true },
        message: "Password set. They were signed out on every device.",
      });
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
