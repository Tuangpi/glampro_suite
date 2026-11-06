import assert from "node:assert/strict";
import { test } from "node:test";
import { add, exact, fixed, sum, ZERO } from "@glampro_suite/shared";
import {
  adjustPayrollClose,
  approvePayrollClose,
  calculatePayrollClose,
  openPayrollClose,
} from "./payroll-close-state.js";
import {
  approvedPayrollExportState,
  calculatedPayrollExportState,
  EXPORT_PERIOD,
  exportInputs,
  exportOwner,
} from "./payroll-export.test-helper.js";
import { frozenPayrollExportModel } from "./payroll-export-data.js";
import {
  attachPayrollLineSources,
  payrollLineSourceCandidates,
  payrollPeriodReport,
  payrollStatementLineQuerySchema,
  selectPayrollStatementLines,
} from "./payroll-report.js";

const state = approvedPayrollExportState();
const report = payrollPeriodReport(state);
const model = frozenPayrollExportModel(state);

test("the period report is refused for any month that is not an approved snapshot", () => {
  assert.throws(() => payrollPeriodReport(openPayrollClose("2026-09")), /Approve payroll/);
  assert.throws(() => payrollPeriodReport(calculatedPayrollExportState()), /Approve payroll/);
  assert.throws(
    () => selectPayrollStatementLines(calculatedPayrollExportState(), "staff-a"),
    /Approve payroll/,
  );
});

test("period totals are the frozen statement totals, never a recalculation", () => {
  assert.equal(report.periodKey, "2026-09");
  assert.equal(report.currency, "SGD");
  assert.equal(report.calculation.inputHash, model.calculation.inputHash);
  assert.deepEqual(
    report.staff.map((row) => row.staff.id),
    ["staff-a", "staff-b"],
  );
  assert.equal(report.totals.staff, 2);
  assert.equal(report.totals.lines, 3);
  assert.equal(report.totals.commission, model.totals.commission);
  assert.equal(report.totals.incentive, model.totals.incentive);
  assert.equal(report.totals.collection, model.totals.collection);
  assert.equal(report.totals.baseAmount, "2400.7500");
  assert.equal(report.totals.units, "6.0000");
  assert.equal(
    report.totals.baseAmount,
    fixed(sum(model.staff.flatMap((row) => row.lines).map((line) => exact(line.baseAmount))), 4),
  );
});

test("staff rows carry commission, incentives and bases but no salary", () => {
  const row = report.staff.find((item) => item.staff.id === "staff-a")!;
  assert.deepEqual(row.payroll, {
    commission: model.staff[0]!.payroll.commission,
    incentive: model.staff[0]!.payroll.incentive,
    collection: model.staff[0]!.payroll.collection,
  });
  assert.equal(row.lines, 2);
  assert.equal(row.baseAmount, "2150.5000");
  assert.equal(row.units, "3.0000");
  assert.deepEqual(row.outlets, ["outlet-a", "outlet-b"]);
  assert.deepEqual(row.commissionTypes, ["PRD", "SVC"]);
  assert.equal(row.firstBusinessDate, "2026-09-05");
  assert.equal(row.lastBusinessDate, "2026-09-28");
  const serialized = JSON.stringify(report);
  for (const field of ["basicSalary", "fixedOvertime", "takeHome", "levy"])
    assert.ok(!serialized.includes(field), `report must not expose ${field}`);
});

/** Approved snapshot with one manual commission adjustment, to prove the columns reconcile. */
function commissionAdjustedState() {
  const opened = adjustPayrollClose(
    openPayrollClose(EXPORT_PERIOD),
    0,
    {
      id: "adj-commission",
      staffId: "staff-a",
      kind: "COMMISSION_ADJ",
      amount: "12.50",
      reason: "Retrospective rate correction",
      actorId: "owner",
    },
    exportOwner,
  );
  const calculated = calculatePayrollClose(
    opened,
    opened.revision,
    exportInputs,
    exportOwner,
    "2026-10-01T00:10:00.000Z",
  );
  return approvePayrollClose(
    calculated,
    calculated.revision,
    exportInputs,
    exportOwner,
    "2026-10-02T02:00:00.000Z",
    "September payroll approved",
  );
}

const componentTotal = (row: { commissionComponents: { amount: string }[] }) =>
  row.commissionComponents.reduce((total, item) => add(total, exact(item.amount)), ZERO);

test("commission is split by plan component and reconciles to the frozen total", () => {
  assert.deepEqual(report.commissionColumns, [
    { key: "svc", name: "Service commission" },
    { key: "flat_rules", name: "Flat rules" },
  ]);
  const row = report.staff.find((item) => item.staff.id === "staff-a")!;
  assert.deepEqual(row.commissionComponents, [
    { componentKey: "svc", componentName: "Service commission", amount: "200.00" },
  ]);
  assert.equal(row.commissionAdjustments, "0.00");
  for (const staffRow of report.staff)
    assert.equal(
      fixed(add(componentTotal(staffRow), exact(staffRow.commissionAdjustments)), 2),
      staffRow.payroll.commission,
      "components plus adjustments must equal the frozen commission",
    );
});

test("a manual commission adjustment keeps its own column and the total still reconciles", () => {
  const adjusted = payrollPeriodReport(commissionAdjustedState());
  const row = adjusted.staff.find((item) => item.staff.id === "staff-a")!;
  assert.equal(row.commissionAdjustments, "12.50");
  assert.equal(row.payroll.commission, "212.50");
  assert.equal(fixed(add(componentTotal(row), exact(row.commissionAdjustments)), 2), "212.50");
});

test("the salary-derived ratio is serialized for an owner reader only", () => {
  const owner = payrollPeriodReport(state, true);
  assert.equal(owner.staff[0]!.payrollSalesPct, model.staff[0]!.payroll.payrollSalesPct);
  assert.equal(owner.staff[0]!.alert, model.staff[0]!.payroll.alert);
  const manager = payrollPeriodReport(state);
  for (const row of manager.staff) {
    assert.ok(!("payrollSalesPct" in row), "a manager never reads the salary-derived ratio");
    assert.ok(!("alert" in row));
  }
  assert.ok(!JSON.stringify(manager).includes("payrollSalesPct"));
});

test("a statement with no frozen lines still appears with empty base aggregates", () => {
  const empty = report.staff.find((item) => item.staff.id === "staff-b")!;
  assert.equal(empty.baseAmount, "250.2500");
  assert.deepEqual(empty.outlets, ["outlet-a"]);
  const withoutLines = payrollPeriodReport({
    ...state,
    calculation: {
      ...state.calculation!,
      statements: state.calculation!.statements.map((statement) => ({
        ...statement,
        inputs: {
          ...statement.inputs,
          calculation: { ...statement.inputs.calculation, lines: [] },
        },
      })),
    },
  });
  assert.equal(withoutLines.totals.lines, 0);
  assert.equal(withoutLines.totals.baseAmount, "0.0000");
  assert.equal(withoutLines.staff[0]!.firstBusinessDate, null);
  assert.equal(withoutLines.staff[0]!.lastBusinessDate, null);
});

test("drill-down filters use the same rules as the base-ledger export", () => {
  const all = selectPayrollStatementLines(state, "staff-a");
  assert.equal(all.page.total, 2);
  assert.equal(all.page.pages, 1);
  assert.equal(all.page.limit, 100);
  assert.deepEqual(
    all.page.lines.map((row) => row.line.id),
    ["line-a-1", "line-a-2"],
  );
  assert.equal(all.page.staff.name, "Alice Tan");

  const byOutlet = selectPayrollStatementLines(state, "staff-a", { outletId: "outlet-b" });
  assert.deepEqual(
    byOutlet.page.lines.map((row) => row.line.id),
    ["line-a-2"],
  );
  const byType = selectPayrollStatementLines(state, "staff-b", { commissionType: "SVC" });
  assert.equal(byType.page.total, 1);
  const byStatus = selectPayrollStatementLines(state, "staff-a", { status: "REVERSED" });
  assert.deepEqual(
    byStatus.page.lines.map((row) => row.line.id),
    ["line-a-2"],
  );
  const byDate = selectPayrollStatementLines(state, "staff-a", {
    from: "2026-09-10",
    to: "2026-09-30",
  });
  assert.deepEqual(
    byDate.page.lines.map((row) => row.line.id),
    ["line-a-2"],
  );
  assert.equal(
    selectPayrollStatementLines(state, "staff-a", { outletId: "nowhere" }).page.total,
    0,
  );
});

test("drill-down rejects a reversed date range and an unknown staff member", () => {
  assert.throws(
    () => selectPayrollStatementLines(state, "staff-a", { from: "2026-09-30", to: "2026-09-01" }),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 400 && /must not be after/.test(error.message),
  );
  assert.throws(
    () => selectPayrollStatementLines(state, "staff-z"),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 404 && /No frozen statement/.test(error.message),
  );
});

test("pagination reports totals over every match, not just the visible page", () => {
  const first = selectPayrollStatementLines(state, "staff-a", { limit: 1, page: 1 });
  assert.equal(first.page.total, 2);
  assert.equal(first.page.pages, 2);
  assert.deepEqual(
    first.page.lines.map((row) => row.line.id),
    ["line-a-1"],
  );
  assert.equal(first.page.matching.lines, 2);
  assert.equal(first.page.matching.baseAmount, "2150.5000");
  assert.equal(first.page.matching.units, "3.0000");

  const second = selectPayrollStatementLines(state, "staff-a", { limit: 1, page: 2 });
  assert.deepEqual(
    second.page.lines.map((row) => row.line.id),
    ["line-a-2"],
  );
  assert.equal(second.page.matching.baseAmount, "2150.5000");

  const past = selectPayrollStatementLines(state, "staff-a", { limit: 1, page: 3 });
  assert.equal(past.page.lines.length, 0);
  assert.equal(past.page.total, 2);
  assert.equal(past.sourceKeys.length, 0);
});

test("the drill-down query is strict and defaulted", () => {
  assert.deepEqual(payrollStatementLineQuerySchema.parse({}), { limit: 100, page: 1 });
  assert.deepEqual(payrollStatementLineQuerySchema.parse({ limit: "25", page: "2" }), {
    limit: 25,
    page: 2,
  });
  for (const query of [
    { limit: "0" },
    { limit: "501" },
    { page: "0" },
    { commissionType: "NOPE" },
    { status: "OPEN" },
    { from: "2026-09-31" },
    { staffId: "staff-a" },
    { actorId: "forged" },
  ])
    assert.equal(
      payrollStatementLineQuerySchema.safeParse(query).success,
      false,
      JSON.stringify(query),
    );
});

test("line source keys accept the posted staff suffix and a bare key", () => {
  assert.deepEqual(payrollLineSourceCandidates("sale-line:sale-1:staff-a", "staff-a"), [
    "sale-line:sale-1",
    "sale-line:sale-1:staff-a",
  ]);
  assert.deepEqual(payrollLineSourceCandidates("line-a-1", "staff-a"), ["line-a-1"]);
});

test("source references are attached without touching the frozen money", () => {
  const selection = selectPayrollStatementLines(state, "staff-a");
  assert.deepEqual(selection.sourceKeys, ["line-a-1", "line-a-2"]);
  assert.ok(selection.page.lines.every((row) => row.source === null));

  const page = attachPayrollLineSources(selection, [
    {
      sourceKey: "line-a-1",
      sourceType: "SALE_LINE",
      sourceId: "sale-line-1",
      saleId: "sale-1",
      occurredAt: new Date("2026-09-05T04:00:00.000Z"),
    },
    {
      sourceKey: "line-a-2",
      sourceType: "REVERSAL",
      sourceId: "void-1",
      saleId: "sale-2",
      occurredAt: new Date("2026-09-28T06:30:00.000Z"),
    },
    {
      sourceKey: "unrelated",
      sourceType: "SALE_LINE",
      sourceId: "sale-line-9",
      saleId: "sale-9",
      occurredAt: new Date("2026-09-09T00:00:00.000Z"),
    },
  ]);
  assert.deepEqual(page.lines[0]!.source, {
    sourceType: "SALE_LINE",
    sourceId: "sale-line-1",
    saleId: "sale-1",
    occurredAt: "2026-09-05T04:00:00.000Z",
  });
  assert.equal(page.lines[1]!.source?.sourceType, "REVERSAL");
  assert.deepEqual(
    page.lines.map((row) => row.line.baseAmount),
    ["2000", "150.50"],
    "sources never replace the frozen base",
  );
});

test("a missing or malformed source event leaves the frozen line readable", () => {
  const selection = selectPayrollStatementLines(state, "staff-a");
  const page = attachPayrollLineSources(selection, [
    {
      sourceKey: "line-a-1",
      sourceType: "SALE_LINE",
      sourceId: "sale-line-1",
      occurredAt: new Date("2026-09-05T04:00:00.000Z"),
    } as never,
  ]);
  assert.deepEqual(
    page.lines.map((row) => row.source),
    [null, null],
    "invalid evidence is ignored rather than surfaced or thrown",
  );
  assert.equal(page.total, 2);
});
