import assert from "node:assert/strict";
import { test } from "node:test";
import { assemblePayrollStatement, type PayrollStatementInput } from "./statement.js";
import { hairPayrollExample } from "./examples.js";

function fixture(): PayrollStatementInput {
  return {
    staff: { id: "departed", name: "Departed staff", disabled: true },
    calculation: {
      staffId: "departed",
      periodKey: "2026-09",
      joinDate: null,
      plan: null,
      lines: [
        {
          id: "line",
          staffId: "departed",
          outletId: "branch",
          commissionType: "SVC",
          baseAmount: "1000.0000",
          units: "1.0000",
          businessDate: "2026-09-12",
          status: "EARNED",
          mode: "FOLLOW_PLAN",
          fallbackRatePct: "10",
        },
      ],
    },
    profile: { basicSalary: "2000", fixedOvertime: "100", levy: "150", salesAlertPct: "50" },
    profileRevision: 3,
    adjustments: [],
    collection: "1000.0000",
  };
}

test("statement reconciles all manual components and keeps departed staff", () => {
  const input = fixture();
  input.adjustments = [
    { kind: "UNPAID_LEAVE", amount: "50.00" },
    { kind: "OVERTIME", amount: "20.00" },
    { kind: "ADDITION", amount: "30.00" },
    { kind: "DEDUCTION", amount: "10.00" },
    { kind: "COMMISSION_ADJ", amount: "-5.00" },
  ].map((row, index) => ({
    ...row,
    kind: row.kind as PayrollStatementInput["adjustments"][number]["kind"],
    id: `adj-${index}`,
    staffId: "departed",
    actorId: "manager",
    reason: "Approved manual amount",
  }));
  const statement = assemblePayrollStatement(input);
  assert.equal(statement.staff.disabled, true);
  assert.deepEqual(statement.payroll, {
    basicSalary: "2000.00",
    fixedOvertime: "100.00",
    levy: "150.00",
    unpaidLeave: "50.00",
    commission: "95.00",
    incentive: "0.00",
    overtime: "20.00",
    additions: "30.00",
    deductions: "10.00",
    takeHome: "2185.00",
    collection: "1000.0000",
    payrollSalesPct: "233.50",
    alert: true,
  });
});

test("zero and negative collection have no ratio or alert", () => {
  for (const collection of ["0", "-12.0000"]) {
    const statement = assemblePayrollStatement({ ...fixture(), collection });
    assert.equal(statement.payroll.payrollSalesPct, null);
    assert.equal(statement.payroll.alert, false);
  }
});

test("salary component rounding reconciles displayed cents and compares unrounded KPI", () => {
  const input = fixture();
  input.calculation.lines = [];
  input.profile = { basicSalary: "0.005", fixedOvertime: "0.005", levy: "0", salesAlertPct: "0" };
  input.collection = "1000";
  const statement = assemblePayrollStatement(input);
  assert.equal(statement.payroll.basicSalary, "0.01");
  assert.equal(statement.payroll.fixedOvertime, "0.01");
  assert.equal(statement.payroll.takeHome, "0.02");
  assert.equal(statement.payroll.payrollSalesPct, "0.00");
  assert.equal(statement.payroll.alert, true);
});

test("statement owns a deep copy of profile, identity, inputs and results", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const statement = assemblePayrollStatement(input);
  assert.equal(JSON.stringify(input), before);
  input.staff.name = "Changed";
  input.profile.basicSalary = "9999";
  input.calculation.lines[0].baseAmount = "9999";
  assert.equal(statement.staff.name, "Departed staff");
  assert.equal(statement.inputs.profile.basicSalary, "2000");
  assert.equal(statement.inputs.calculation.lines[0].baseAmount, "1000.0000");
  assert.equal(statement.payroll.takeHome, "2200.00");
});

test("rejects cross-staff and duplicate adjustments, negative deductions and fractional cents", () => {
  const adjustment = {
    id: "adjustment",
    staffId: "departed",
    kind: "DEDUCTION" as const,
    amount: "10.00",
    actorId: "manager",
    reason: "Manual deduction",
  };
  for (const adjustments of [
    [{ ...adjustment, staffId: "someone-else" }],
    [adjustment, adjustment],
    [{ ...adjustment, amount: "-10.00" }],
    [{ ...adjustment, amount: "0.001" }],
  ])
    assert.throws(() => assemblePayrollStatement({ ...fixture(), adjustments }));
});

test("rejects mismatched staff, invalid revisions, profiles and collection evidence", () => {
  assert.throws(() =>
    assemblePayrollStatement({
      ...fixture(),
      staff: { id: "other", name: "Other", disabled: false },
    }),
  );
  assert.throws(() => assemblePayrollStatement({ ...fixture(), profileRevision: -1 }));
  assert.throws(() => assemblePayrollStatement({ ...fixture(), collection: "NaN" }));
  assert.throws(() =>
    assemblePayrollStatement({ ...fixture(), profile: { ...fixture().profile, levy: "-1" } }),
  );
});

test("negative source-rate commission debt survives a statement without salary deduction", () => {
  const input = fixture();
  input.calculation.lines[0].baseAmount = "-1000";
  const negative = assemblePayrollStatement(input);
  assert.equal(negative.result.fallbackCarryCommission, "-100.0000000000");
  assert.equal(negative.payroll.commission, "0.00");
  assert.equal(negative.payroll.takeHome, "2100.00");
  input.calculation.lines[0].baseAmount = "600";
  input.calculation.fallbackCarryCommission = negative.result.fallbackCarryCommission;
  const next = assemblePayrollStatement(input);
  assert.equal(next.payroll.commission, "0.00");
  assert.equal(next.result.fallbackCarryCommission, "-40.0000000000");
  input.calculation.fallbackCarryCommission = next.result.fallbackCarryCommission;
  assert.equal(assemblePayrollStatement(input).payroll.commission, "20.00");
});

test("plan switches cannot silently discard component or fallback debt", () => {
  const input = fixture();
  const definition = { ...hairPayrollExample(), incentives: [] };
  input.calculation.plan = { planId: "hair", versionId: "new-version", definition };
  input.calculation.joinDate = "2020-01-01";
  input.calculation.carryForward = [
    { componentKey: "removed-key", base: "-50.0000", units: "0.0000" },
  ];
  assert.throws(() => assemblePayrollStatement(input), /explicit mapping/);
  input.calculation.carryResolutions = [
    { fromKey: "removed-key", toKey: null, reason: "Owner approved write-off" },
  ];
  const statement = assemblePayrollStatement(input);
  assert.equal(statement.result.carryWriteOffs[0].base, "-50.0000");
  assert.equal(
    statement.inputs.calculation.carryResolutions![0].reason,
    "Owner approved write-off",
  );
  input.calculation.fallbackCarryCommission = "-1.0000000000";
  assert.throws(() => assemblePayrollStatement(input), /explicit settlement/);
});
