import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAYROLL_DEFAULT_SETTINGS,
  payrollSettingsWriteSchema,
  payrollAssignmentWriteSchema,
  payrollProfileWriteSchema,
  payrollStaffSettingsSchema,
  payrollCreatePlanSchema,
} from "./settings.js";
import { hairPayrollExample } from "./examples.js";

test("payroll settings enforce exact strings, bounded percentages, revisions and reasons", () => {
  const input = { ...PAYROLL_DEFAULT_SETTINGS, expectedRevision: 0, reason: "Initial defaults" };
  assert.deepEqual(payrollSettingsWriteSchema.parse(input), input);
  for (const patch of [
    { reason: " " },
    { minimumDepositPct: "101" },
    { refundAdminFee: "-1" },
    { expectedRevision: -1 },
    { joinAfterDay: 32 },
    { refundAdminFee: 100 },
    { extra: true },
  ])
    assert.equal(payrollSettingsWriteSchema.safeParse({ ...input, ...patch }).success, false);
});
test("salary profile changes require owner-service validation inputs without float money", () => {
  const input = {
    basicSalary: "2000.50",
    fixedOvertime: "50",
    levy: "250",
    salesAlertPct: "40",
    expectedRevision: 0,
    reason: "Employment agreement",
  };
  assert.equal(payrollProfileWriteSchema.safeParse(input).success, true);
  for (const patch of [
    { basicSalary: "-1" },
    { basicSalary: 2000.5 },
    { salesAlertPct: "100.0001" },
    { reason: "" },
  ])
    assert.equal(payrollProfileWriteSchema.safeParse({ ...input, ...patch }).success, false);
});
test("assignment requests reject duplicate staff, invalid dates and unknown fields", () => {
  const input = {
    staffIds: ["amy"],
    planId: "hair",
    fromDate: "2026-10-31",
    expectedRevision: 0,
    reason: "Monthly assignment",
  };
  assert.equal(payrollAssignmentWriteSchema.safeParse(input).success, true);
  for (const patch of [
    { staffIds: ["amy", "amy"] },
    { staffIds: [] },
    { fromDate: "2026-02-30" },
    { tenantId: "foreign" },
  ])
    assert.equal(payrollAssignmentWriteSchema.safeParse({ ...input, ...patch }).success, false);
});
test("staff settings require an evidenced date and bounded override", () => {
  const input = {
    joinDate: "2026-09-01",
    stageEndOverride: null,
    expectedRevision: 0,
    reason: "Employment date",
  };
  assert.equal(payrollStaffSettingsSchema.safeParse(input).success, true);
  assert.equal(
    payrollStaffSettingsSchema.safeParse({ ...input, stageEndOverride: -1 }).success,
    false,
  );
  assert.equal(payrollStaffSettingsSchema.safeParse({ ...input, joinDate: null }).success, false);
});
test("plan creation validates the complete definition, not only plan metadata", () => {
  const definition = hairPayrollExample();
  const input = {
    name: "Hair",
    description: "Sample",
    positions: [],
    outletIds: [],
    definition,
    reason: "New sample",
  };
  assert.equal(payrollCreatePlanSchema.safeParse(input).success, true);
  definition.stages[1]!.fromMonth = 3;
  assert.equal(payrollCreatePlanSchema.safeParse(input).success, false);
});
