import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { payrollAdjustmentSchema, payrollPeriodKeySchema } from "@glampro_suite/shared";
import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { currentScope } from "../lib/tenant-context.js";
import { forbidden } from "../lib/http-error.js";
import {
  readStoredPayrollClose,
  readStoredPayrollStatement,
  calculateStoredPayrollClose,
  approveStoredPayrollClose,
  adjustStoredPayrollClose,
  confirmStoredPayrollPayout,
  readStoredPayrollCarry,
} from "../services/payroll-close-store.js";
import { authorizeStoredPayrollCarry } from "../services/payroll-close-authorizations.js";
import { payrollOpeningCarrySchema } from "../services/payroll-close-opening.js";
import { payrollCarrySettlementSchema } from "../services/payroll-close-settlements.js";

/** Not mounted until CP-005 lifecycle and HTTP acceptance are complete.
 * This boundary never accepts source records, a loader, or a calculation snapshot. */
export const payrollCloseRouter = Router();
payrollCloseRouter.use(auth, requireModule("staff"));
const period = (req: Parameters<RequestHandler>[0]) =>
  payrollPeriodKeySchema.parse(req.params.period);
const handle =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void fn(req)
      .then((data) => res.json({ data }))
      .catch(next);
  };
const management = requireRole("SUPER_ADMIN", "MANAGER");
const owner = requireRole("SUPER_ADMIN");
const writable = requireWritableTenant();
const revision = z.strictObject({ expectedRevision: z.number().int().safe().nonnegative() });
const reasoned = revision.extend({ reason: z.string().trim().min(3).max(1000) });
const adjustment = revision.extend({
  adjustment: z.strictObject({
    id: payrollAdjustmentSchema.shape.id,
    staffId: payrollAdjustmentSchema.shape.staffId,
    kind: payrollAdjustmentSchema.shape.kind,
    amount: payrollAdjustmentSchema.shape.amount,
    reason: payrollAdjustmentSchema.shape.reason,
  }),
});
const payout = reasoned.extend({ reference: z.string().trim().min(1).max(128) });
const opening = reasoned.extend(
  payrollOpeningCarrySchema.pick({ staff: true, evidence: true }).shape,
);
const settlement = reasoned.extend(
  payrollCarrySettlementSchema.pick({
    staffId: true,
    balanceHash: true,
    components: true,
    fallbackWriteOff: true,
    evidence: true,
  }).shape,
);

payrollCloseRouter.get(
  "/:period/statement",
  handle((req) => {
    const scope = currentScope();
    if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
    return readStoredPayrollStatement(period(req), scope.actorId);
  }),
);
payrollCloseRouter.get(
  "/:period/statements/:staffId",
  owner,
  handle((req) => readStoredPayrollStatement(period(req), String(req.params.staffId))),
);
payrollCloseRouter.get(
  "/:period",
  management,
  handle((req) => readStoredPayrollClose(period(req))),
);
payrollCloseRouter.get(
  "/:period/carry",
  owner,
  handle((req) => readStoredPayrollCarry(period(req))),
);
payrollCloseRouter.post(
  "/:period/calculate",
  management,
  writable,
  validate(revision),
  handle((req) =>
    calculateStoredPayrollClose(
      period(req),
      validated<z.infer<typeof revision>>(req, "body").expectedRevision,
    ),
  ),
);
payrollCloseRouter.post(
  "/:period/approve",
  owner,
  writable,
  validate(reasoned),
  handle((req) => {
    const input = validated<z.infer<typeof reasoned>>(req, "body");
    return approveStoredPayrollClose(period(req), input.expectedRevision, input.reason);
  }),
);
payrollCloseRouter.post(
  "/:period/adjustments",
  management,
  writable,
  validate(adjustment),
  handle((req) => {
    const input = validated<z.infer<typeof adjustment>>(req, "body");
    const scope = currentScope();
    if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
    return adjustStoredPayrollClose(period(req), input.expectedRevision, {
      ...input.adjustment,
      actorId: scope.actorId,
    });
  }),
);
payrollCloseRouter.post(
  "/:period/payout",
  owner,
  writable,
  validate(payout),
  handle((req) => {
    const input = validated<z.infer<typeof payout>>(req, "body");
    return confirmStoredPayrollPayout(
      period(req),
      input.expectedRevision,
      input.reference,
      input.reason,
    );
  }),
);
payrollCloseRouter.post(
  "/:period/opening",
  owner,
  writable,
  validate(opening),
  handle((req) => {
    const { expectedRevision, reason, ...request } = validated<z.infer<typeof opening>>(
      req,
      "body",
    );
    return authorizeStoredPayrollCarry("OPENING", period(req), expectedRevision, request, reason);
  }),
);
payrollCloseRouter.post(
  "/:period/settlements",
  owner,
  writable,
  validate(settlement),
  handle((req) => {
    const { expectedRevision, reason, ...request } = validated<z.infer<typeof settlement>>(
      req,
      "body",
    );
    return authorizeStoredPayrollCarry(
      "SETTLEMENT",
      period(req),
      expectedRevision,
      request,
      reason,
    );
  }),
);
