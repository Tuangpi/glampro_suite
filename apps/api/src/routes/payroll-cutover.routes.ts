import { Router, type RequestHandler } from "express";
import {
  payrollCutoverActivateSchema,
  payrollCutoverInventoryQuerySchema,
  payrollCutoverRollbackSchema,
  type PayrollCutoverActivate,
  type PayrollCutoverInventoryQuery,
  type PayrollCutoverRollback,
} from "@glampro_suite/shared";
import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import {
  activatePayrollCutover,
  readPayrollCutover,
  readPayrollCutoverInventory,
  rollbackPayrollCutover,
} from "../services/payroll-cutover.js";

/**
 * CP-007. The dry run and the activation record are readable by management; the two
 * transitions are the owner's alone, and both are write actions against a salon.
 *
 * Nothing here accepts legacy earnings, a payroll figure, or a hash the server cannot
 * recompute: the inventory is derived from stored rows, and activation quotes back the
 * hash of exactly that derivation.
 */
export const payrollCutoverRouter = Router();
payrollCutoverRouter.use(auth, requireModule("staff"));
const management = requireRole("SUPER_ADMIN", "MANAGER");
const owner = requireRole("SUPER_ADMIN");
const writable = requireWritableTenant();
const handle =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void fn(req)
      .then((data) => res.json({ data }))
      .catch(next);
  };

payrollCutoverRouter.get(
  "/",
  management,
  handle(() => readPayrollCutover()),
);

/** Read-only by construction: this route classifies evidence and writes nothing. */
payrollCutoverRouter.get(
  "/inventory",
  management,
  validate(payrollCutoverInventoryQuerySchema, "query"),
  handle((req) =>
    readPayrollCutoverInventory(validated<PayrollCutoverInventoryQuery>(req, "query")),
  ),
);

payrollCutoverRouter.post(
  "/activate",
  owner,
  writable,
  validate(payrollCutoverActivateSchema),
  handle((req) => activatePayrollCutover(validated<PayrollCutoverActivate>(req, "body"))),
);

payrollCutoverRouter.post(
  "/rollback",
  owner,
  writable,
  validate(payrollCutoverRollbackSchema),
  handle((req) => rollbackPayrollCutover(validated<PayrollCutoverRollback>(req, "body"))),
);
