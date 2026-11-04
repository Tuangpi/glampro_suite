import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  payrollAdjustmentSchema,
  payrollPeriodKeySchema,
  payrollProgressQuerySchema,
  payrollStatementHistoryQuerySchema,
} from "@glampro_suite/shared";
import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { currentScope } from "../lib/tenant-context.js";
import { forbidden } from "../lib/http-error.js";
import {
  readStoredPayrollClose,
  readStoredPayrollStatement,
  readStoredPayrollReport,
  readStoredPayrollStatementLines,
  readStoredPayrollProgress,
  readStoredPayrollStatements,
  calculateStoredPayrollClose,
  approveStoredPayrollClose,
  adjustStoredPayrollClose,
  confirmStoredPayrollPayout,
  readStoredPayrollCarry,
} from "../services/payroll-close-store.js";
import { authorizeStoredPayrollCarry } from "../services/payroll-close-authorizations.js";
import { payrollOpeningCarrySchema } from "../services/payroll-close-opening.js";
import { payrollCarrySettlementSchema } from "../services/payroll-close-settlements.js";
import {
  payrollCloseView,
  payrollCommissionStatementView,
} from "../services/payroll-close-view.js";
import {
  readPayrollLedgerExport,
  readPayrollPayslipsExport,
  readPayrollWorkbookExport,
  type PayrollExportFile,
} from "../services/payroll-export.service.js";
import {
  payrollLedgerQuerySchema,
  type PayrollLedgerQuery,
} from "../services/payroll-export-data.js";
import {
  payrollStatementLineQuerySchema,
  type PayrollStatementLineQuery,
} from "../services/payroll-report.js";

/** This boundary never accepts source records, a loader, or a calculation snapshot.
 * Response projections omit raw inputs and protect salary information. */
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
const download =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<PayrollExportFile>): RequestHandler =>
  (req, res, next) => {
    void fn(req)
      .then((file) => {
        // Salary exports must not be cached or sniffed by proxies/browsers.
        res.setHeader("Content-Type", file.contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(file.body);
      })
      .catch(next);
  };
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
  payrollOpeningCarrySchema.pick({ staff: true, evidence: true, coverage: true }).shape,
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
  requireRole("SUPER_ADMIN", "MANAGER", "STAFF"),
  handle(async (req) => {
    const scope = currentScope();
    if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
    return payrollCommissionStatementView(
      await readStoredPayrollStatement(period(req), scope.actorId),
    );
  }),
);
payrollCloseRouter.get(
  "/:period/statements/:staffId",
  owner,
  handle(async (req) => {
    const statement = await readStoredPayrollStatement(period(req), String(req.params.staffId));
    return { staff: statement.staff, result: statement.result, payroll: statement.payroll };
  }),
);
/**
 * CP-006 progress and self-service reads. Both paths are **single segments**, so they are
 * registered before `/:period` — otherwise "progress" or "statements" would be parsed as
 * a payroll month. Neither can return salary: the projections carry commission,
 * incentives, base amounts and collection only.
 */
payrollCloseRouter.get(
  "/progress",
  requireRole("SUPER_ADMIN", "MANAGER", "STAFF"),
  validate(payrollProgressQuerySchema, "query"),
  handle((req) =>
    readStoredPayrollProgress(
      validated<z.infer<typeof payrollProgressQuerySchema>>(req, "query").period,
    ),
  ),
);
payrollCloseRouter.get(
  "/statements",
  requireRole("SUPER_ADMIN", "MANAGER", "STAFF"),
  validate(payrollStatementHistoryQuerySchema, "query"),
  handle((req) =>
    readStoredPayrollStatements(
      validated<z.infer<typeof payrollStatementHistoryQuerySchema>>(req, "query").limit,
    ),
  ),
);
payrollCloseRouter.get(
  "/:period",
  management,
  handle(async (req) =>
    payrollCloseView(
      await readStoredPayrollClose(period(req)),
      req.user!.globalRole === "SUPER_ADMIN",
    ),
  ),
);
payrollCloseRouter.get(
  "/:period/carry",
  owner,
  handle((req) => readStoredPayrollCarry(period(req))),
);
/**
 * CP-006 report reads: management-visible frozen figures and a base-line drill-down.
 * Neither route can return salary, and both refuse a month that is not an approved
 * snapshot with the same 409 the exports use.
 */
payrollCloseRouter.get(
  "/:period/report",
  management,
  handle((req) => readStoredPayrollReport(period(req))),
);
payrollCloseRouter.get(
  "/:period/statements/:staffId/lines",
  management,
  validate(payrollStatementLineQuerySchema, "query"),
  handle((req) =>
    readStoredPayrollStatementLines(
      period(req),
      String(req.params.staffId),
      validated<PayrollStatementLineQuery>(req, "query"),
    ),
  ),
);

/** CP-006 frozen exports: owner-only, approved snapshots only, salon-wide. */
payrollCloseRouter.get(
  "/:period/exports/workbook.xlsx",
  owner,
  download((req) => readPayrollWorkbookExport(period(req))),
);
payrollCloseRouter.get(
  "/:period/exports/payslips.pdf",
  owner,
  download((req) => readPayrollPayslipsExport(period(req))),
);
payrollCloseRouter.get(
  "/:period/exports/ledger.csv",
  owner,
  validate(payrollLedgerQuerySchema, "query"),
  download((req) =>
    readPayrollLedgerExport(period(req), validated<PayrollLedgerQuery>(req, "query")),
  ),
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
    ).then((state) => payrollCloseView(state, req.user!.globalRole === "SUPER_ADMIN")),
  ),
);
payrollCloseRouter.post(
  "/:period/approve",
  owner,
  writable,
  validate(reasoned),
  handle((req) => {
    const input = validated<z.infer<typeof reasoned>>(req, "body");
    return approveStoredPayrollClose(period(req), input.expectedRevision, input.reason).then(
      (state) => payrollCloseView(state, true),
    );
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
    }).then((state) => payrollCloseView(state, req.user!.globalRole === "SUPER_ADMIN"));
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
    ).then((state) => payrollCloseView(state, true));
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
