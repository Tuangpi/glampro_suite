import { Router, type RequestHandler } from "express";
import {
  payrollCreatePlanSchema,
  payrollSaveDraftSchema,
  payrollRevisionSchema,
  payrollAssignmentWriteSchema,
  payrollStaffSettingsSchema,
  payrollProfileWriteSchema,
  payrollSettingsWriteSchema,
  payrollPlanMetadataSchema,
  payrollComponentSchema,
  payrollDecimalSchema,
  calculatePayrollComponent,
  comparePayrollMethods,
  payrollCommissionCurve,
  validatePayrollPlan,
  hairPayrollExample,
  tpPayrollExample,
} from "@glampro_suite/shared";
import { z } from "zod";
import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import {
  readPayrollConfiguration,
  createPayrollPlan,
  savePayrollDraft,
  publishPayrollDraft,
  archivePayrollPlan,
  duplicatePayrollPlan,
  updatePayrollPlan,
  assignPayrollPlan,
  savePayrollStaffSettings,
  savePayrollProfile,
  savePayrollSettings,
  readPayrollHistoricalPreview,
} from "../services/payroll-configuration.service.js";

export const payrollConfigurationRouter = Router();
payrollConfigurationRouter.use(auth, requireModule("staff"), requireRole("SUPER_ADMIN", "MANAGER"));
const handle = (fn: Parameters<typeof handler>[0]): RequestHandler => handler(fn);
function handler(fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    void fn(req)
      .then((data) => res.json({ data }))
      .catch(next);
  };
}
payrollConfigurationRouter.get(
  "/",
  validate(
    z.strictObject({ historyPage: z.coerce.number().int().min(1).max(1000000).default(1) }),
    "query",
  ),
  handle((req) =>
    readPayrollConfiguration(validated<{ historyPage: number }>(req, "query").historyPage),
  ),
);
payrollConfigurationRouter.get(
  "/samples",
  handle(async () => [
    { name: "Hair", definition: hairPayrollExample() },
    { name: "TP", definition: tpPayrollExample() },
  ]),
);
const calculatorSchema = z.strictObject({
  component: payrollComponentSchema,
  base: payrollDecimalSchema,
  units: payrollDecimalSchema.default("0"),
  stageKey: z.string().min(1).max(128).default("std"),
});
payrollConfigurationRouter.post(
  "/calculator",
  validate(calculatorSchema),
  handle(async (req) => {
    const input = validated<z.infer<typeof calculatorSchema>>(req, "body");
    const options = { stageKey: input.stageKey, units: input.units };
    return {
      result: calculatePayrollComponent(input.component, input.base, options),
      comparison: input.component.bands.length
        ? comparePayrollMethods(input.component, input.base, options)
        : [],
      chart: input.component.method.startsWith("TIER_")
        ? payrollCommissionCurve(input.component, "30000", 60, options)
        : [],
      validation: validatePayrollPlan({
        stages: [],
        components: [input.component],
        incentives: [],
      }),
    };
  }),
);
const owner = requireRole("SUPER_ADMIN");
const writable = requireWritableTenant();
payrollConfigurationRouter.get(
  "/plans/:id/historical-preview",
  owner,
  validate(z.strictObject({ expectedRevision: z.coerce.number().int().min(1) }), "query"),
  handle((req) =>
    readPayrollHistoricalPreview(
      String(req.params.id),
      validated<{ expectedRevision: number }>(req, "query").expectedRevision,
    ),
  ),
);
payrollConfigurationRouter.post(
  "/plans",
  owner,
  writable,
  validate(payrollCreatePlanSchema),
  handle((req) => createPayrollPlan(validated(req, "body"))),
);
const metadataSchema = payrollPlanMetadataSchema.extend(payrollRevisionSchema.shape);
payrollConfigurationRouter.post(
  "/plans/:id/metadata",
  owner,
  writable,
  validate(metadataSchema),
  handle((req) => updatePayrollPlan(String(req.params.id), validated(req, "body"))),
);
payrollConfigurationRouter.post(
  "/plans/:id/duplicate",
  owner,
  writable,
  validate(metadataSchema),
  handle((req) => duplicatePayrollPlan(String(req.params.id), validated(req, "body"))),
);
payrollConfigurationRouter.post(
  "/plans/:id/draft",
  owner,
  writable,
  validate(payrollSaveDraftSchema),
  handle((req) => savePayrollDraft(String(req.params.id), validated(req, "body"))),
);
payrollConfigurationRouter.post(
  "/plans/:id/publish",
  owner,
  writable,
  validate(payrollRevisionSchema),
  handle((req) => publishPayrollDraft(String(req.params.id), validated(req, "body"))),
);
payrollConfigurationRouter.post(
  "/plans/:id/archive",
  owner,
  writable,
  validate(payrollRevisionSchema),
  handle((req) => archivePayrollPlan(String(req.params.id), validated(req, "body"))),
);
payrollConfigurationRouter.post(
  "/assignments",
  owner,
  writable,
  validate(payrollAssignmentWriteSchema),
  handle((req) => assignPayrollPlan(validated(req, "body"))),
);
payrollConfigurationRouter.post(
  "/staff/:id/settings",
  owner,
  writable,
  validate(payrollStaffSettingsSchema),
  handle((req) => savePayrollStaffSettings(String(req.params.id), validated(req, "body"))),
);
payrollConfigurationRouter.post(
  "/staff/:id/profile",
  owner,
  writable,
  validate(payrollProfileWriteSchema),
  handle((req) => savePayrollProfile(String(req.params.id), validated(req, "body"))),
);
payrollConfigurationRouter.post(
  "/settings",
  owner,
  writable,
  validate(payrollSettingsWriteSchema),
  handle((req) => savePayrollSettings(validated(req, "body"))),
);
