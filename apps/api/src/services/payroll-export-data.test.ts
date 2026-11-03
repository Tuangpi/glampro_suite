import assert from "node:assert/strict";
import { test } from "node:test";
import { exact, fixed, neg, sum } from "@glampro_suite/shared";
import {
  PAYROLL_EXPORT_MONEY_FIELDS,
  csvDecimal,
  csvText,
  frozenPayrollExportModel,
  payrollExportFilename,
  payrollExportLedger,
  payrollPayslipLines,
  payrollLedgerCsv,
  payrollLedgerQuerySchema,
  spreadsheetText,
} from "./payroll-export-data.js";
import { openPayrollClose } from "./payroll-close-state.js";
import {
  approvedPayrollExportState,
  calculatedPayrollExportState,
} from "./payroll-export.test-helper.js";

const model = frozenPayrollExportModel(approvedPayrollExportState());

test("only an approved, hash-verified close is exportable", () => {
  assert.throws(() => frozenPayrollExportModel(openPayrollClose("2026-09")), /Approve payroll/);
  assert.throws(() => frozenPayrollExportModel(calculatedPayrollExportState()), /Approve payroll/);
  assert.equal(model.periodKey, "2026-09");
  assert.equal(model.staff.length, 2);
});

test("frozen model keeps statement money and totals that reconcile to the cent", () => {
  assert.equal(model.currency, "SGD");
  assert.deepEqual(
    model.staff.map((row) => row.staff.id),
    ["staff-a", "staff-b"],
  );
  for (const field of PAYROLL_EXPORT_MONEY_FIELDS) {
    assert.equal(
      model.totals[field],
      fixed(sum(model.staff.map((row) => exact(row.payroll[field]))), 2),
      `total ${field}`,
    );
    assert.match(model.totals[field], /^-?(0|[1-9]\d*)\.\d{2}$/);
  }
  assert.equal(
    model.totals.collection,
    fixed(sum(model.staff.map((row) => exact(row.payroll.collection))), 4),
  );
  for (const row of model.staff)
    assert.equal(
      row.payroll.takeHome,
      fixed(
        sum([
          exact(row.payroll.basicSalary),
          exact(row.payroll.fixedOvertime),
          exact(row.payroll.commission),
          exact(row.payroll.incentive),
          exact(row.payroll.overtime),
          exact(row.payroll.additions),
          neg(exact(row.payroll.unpaidLeave)),
          neg(exact(row.payroll.deductions)),
        ]),
        2,
      ),
      `statement ${row.staff.id} reconciles`,
    );
});

test("frozen totals and lines cannot be mutated back into the approved close", () => {
  const state = approvedPayrollExportState();
  const frozen = frozenPayrollExportModel(state);
  frozen.staff[0]!.payroll.takeHome = "999999.99";
  frozen.totals.commission = "999999.99";
  frozen.staff[0]!.lines[0]!.baseAmount = "999999.99";
  assert.notEqual(state.calculation!.statements[0]!.payroll.takeHome, "999999.99");
  assert.notEqual(
    state.calculation!.statements[0]!.inputs.calculation.lines[0]!.baseAmount,
    "999999.99",
  );
  assert.notEqual(frozenPayrollExportModel(state).totals.commission, "999999.99");
});

test("payslip lines expose every frozen payroll component", () => {
  const [alice, bob] = model.staff;
  const lines = payrollPayslipLines(alice!);
  assert.deepEqual(
    lines.map((line) => line.label),
    [
      "Basic salary",
      "Fixed overtime",
      "Commission",
      "Incentive",
      "Overtime",
      "Additions",
      "Less unpaid leave",
      "Less deductions",
      "Take home",
    ],
  );
  assert.equal(lines.find((line) => line.label === "Take home")!.amount, alice!.payroll.takeHome);
  assert.ok(
    lines.some((line) => line.amount === "45.50"),
    "overtime adjustment is shown",
  );
  assert.ok(
    lines.some((line) => line.amount === "100.00"),
    "unpaid leave is shown",
  );
  assert.equal(
    payrollPayslipLines(bob!).find((line) => line.label === "Take home")!.amount,
    bob!.payroll.takeHome,
  );
});

test("base ledger is filtered by staff, outlet, type, status and business date", () => {
  assert.deepEqual(
    payrollExportLedger(model).map((row) => row.line.id),
    ["line-a-1", "line-b-1", "line-a-2"],
  );
  assert.deepEqual(
    payrollExportLedger(model, { staffId: "staff-a" }).map((row) => row.line.id),
    ["line-a-1", "line-a-2"],
  );
  assert.deepEqual(
    payrollExportLedger(model, { outletId: "outlet-a" }).map((row) => row.line.id),
    ["line-a-1", "line-b-1"],
  );
  assert.deepEqual(
    payrollExportLedger(model, { commissionType: "PRD" }).map((row) => row.line.id),
    ["line-a-2"],
  );
  assert.deepEqual(
    payrollExportLedger(model, { status: "REVERSED" }).map((row) => row.line.id),
    ["line-a-2"],
  );
  assert.deepEqual(
    payrollExportLedger(model, { from: "2026-09-10", to: "2026-09-30" }).map((row) => row.line.id),
    ["line-b-1", "line-a-2"],
  );
  assert.throws(
    () => payrollExportLedger(model, { from: "2026-09-30", to: "2026-09-01" }),
    /must not be after/,
  );
});

test("ledger query schema rejects unknown keys and malformed filters", () => {
  assert.equal(payrollLedgerQuerySchema.safeParse({}).success, true);
  assert.equal(payrollLedgerQuerySchema.safeParse({ staffId: "staff-a" }).success, true);
  assert.equal(payrollLedgerQuerySchema.safeParse({ staffId: "" }).success, false);
  assert.equal(payrollLedgerQuerySchema.safeParse({ unknown: "x" }).success, false);
  assert.equal(payrollLedgerQuerySchema.safeParse({ commissionType: "CASH" }).success, false);
  assert.equal(payrollLedgerQuerySchema.safeParse({ from: "09-2026" }).success, false);
});

test("spreadsheet cells and CSV fields cannot smuggle formulas", () => {
  assert.equal(spreadsheetText("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(spreadsheetText("+1"), "'+1");
  assert.equal(spreadsheetText("-1"), "'-1");
  assert.equal(spreadsheetText("@cmd"), "'@cmd");
  assert.equal(spreadsheetText("Alice Tan"), "Alice Tan");
  assert.equal(csvText('Bob "The Barber", Jr'), '"Bob ""The Barber"", Jr"');
  assert.equal(csvText("line\nbreak"), '"line\nbreak"');
  assert.equal(csvText("=1+1"), "'=1+1");
  assert.equal(csvText(null), "");
  assert.equal(csvDecimal("1234.5"), "1234.5");
  assert.throws(() => csvDecimal("1e3"), /non-decimal/);
  assert.throws(() => csvDecimal("=1"), /non-decimal/);
});

test("ledger CSV keeps UTF-8 BOM, CRLF rows and one header line", () => {
  const csv = payrollLedgerCsv(model);
  assert.ok(csv.startsWith("\uFEFFPeriod,Staff ID,Staff,"));
  assert.ok(csv.endsWith("\r\n"));
  const rows = csv.slice(1).split("\r\n").slice(0, -1);
  assert.equal(rows.length, 4);
  assert.ok(rows[0]!.includes("Business date"));
  assert.ok(rows.some((row) => row.includes('"Bob ""The Barber"", Jr"')));
  assert.ok(rows.some((row) => row.includes("2026-09-28")));
  const filtered = payrollLedgerCsv(model, { status: "EARNED" });
  assert.equal(filtered.slice(1).split("\r\n").length - 2, 2);
});

test("export filenames are stable and period-scoped", () => {
  assert.equal(payrollExportFilename("workbook.xlsx", "2026-09"), "payroll-2026-09.xlsx");
  assert.equal(payrollExportFilename("payslips.pdf", "2026-09"), "payroll-payslips-2026-09.pdf");
  assert.equal(payrollExportFilename("ledger.csv", "2026-09"), "payroll-base-ledger-2026-09.csv");
  for (const kind of ["workbook.xlsx", "payslips.pdf", "ledger.csv"] as const)
    assert.doesNotMatch(payrollExportFilename(kind, "2026-09"), /[^a-z0-9.-]/);
});
