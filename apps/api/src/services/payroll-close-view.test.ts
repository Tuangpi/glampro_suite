import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculatePayrollClose,
  openPayrollClose,
  payrollInputHash,
} from "./payroll-close-state.js";
import { payrollCloseView, payrollCommissionStatementView } from "./payroll-close-view.js";
import { approvedPayrollExportState } from "./payroll-export.test-helper.js";

test("close HTTP projections remove raw evidence and restrict manager/self salary fields without changing stored state", () => {
  const state = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    {
      periodKey: "2026-09",
      timeZone: "Asia/Singapore",
      startsAt: "2026-08-31T16:00:00.000Z",
      endsAt: "2026-09-30T16:00:00.000Z",
      currency: "SGD",
      evidence: { secretInventory: "not for HTTP" },
      staff: [
        {
          staff: { id: "staff", name: "Staff", disabled: false },
          profile: {
            basicSalary: "2345.67",
            fixedOvertime: "100",
            levy: "50",
            salesAlertPct: "50",
          },
          profileRevision: 1,
          adjustments: [],
          collection: "0",
          calculation: {
            staffId: "staff",
            periodKey: "2026-09",
            joinDate: null,
            plan: null,
            lines: [],
          },
        },
      ],
    },
    { id: "manager", role: "MANAGER", disabled: false, twoFactorEnabled: false },
    "2026-10-01T00:00:00.000Z",
  );
  const hash = payrollInputHash(state);
  const manager = JSON.stringify(payrollCloseView(state, false));
  const self = JSON.stringify(payrollCommissionStatementView(state.calculation!.statements[0]));
  for (const view of [manager, self]) {
    for (const field of [
      "inputs",
      "profile",
      "basicSalary",
      "fixedOvertime",
      "takeHome",
      "levy",
      "payrollSalesPct",
      "secretInventory",
      "2345.67",
    ])
      assert.ok(!view.includes(field), `redact ${field}`);
  }
  const owner = JSON.stringify(payrollCloseView(state, true));
  assert.ok(owner.includes("2345.67"));
  assert.ok(!owner.includes("inputs"));
  assert.ok(!owner.includes("secretInventory"));
  assert.equal(payrollInputHash(state), hash);
});

test("both roles read component columns and adjustments; only an owner reads the ratio", () => {
  const approved = approvedPayrollExportState();
  const manager = payrollCloseView(approved, false);
  const owner = payrollCloseView(approved, true);
  assert.deepEqual(manager.calculation!.commissionColumns, [
    { key: "svc", name: "Service commission" },
    { key: "flat_rules", name: "Flat rules" },
  ]);
  for (const view of [manager, owner]) {
    const serialized = JSON.stringify(view);
    assert.ok(serialized.includes("commissionAdjustments"), "the adjustments column is not salary");
    assert.ok(serialized.includes("Service commission"));
  }
  assert.ok(!JSON.stringify(manager).includes("payrollSalesPct"));
  assert.ok(!JSON.stringify(manager).includes("basicSalary"));
  assert.ok(JSON.stringify(owner).includes("payrollSalesPct"));
});
