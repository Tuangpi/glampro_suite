import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { frozenPayrollExportModel } from "./payroll-export-data.js";
import { renderPayrollWorkbook } from "./payroll-export-xlsx.js";
import { renderPayrollPayslips } from "./payroll-export-pdf.js";
import { approvedPayrollExportState } from "./payroll-export.test-helper.js";

const model = frozenPayrollExportModel(approvedPayrollExportState());

/**
 * ExcelJS bundles a legacy `Buffer extends ArrayBuffer` declaration that clashes with
 * Node's generic Buffer typings; the runtime accepts a Node Buffer as-is.
 */
function loadWorkbook(workbook: ExcelJS.Workbook, bytes: Buffer) {
  return workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
}

/** PDFKit writes kerned hex fragments; concatenate them to read the page text. */
function pdfText(pdf: Buffer): string {
  return pdf
    .toString("latin1")
    .replace(/\[([^\]]*)\]\s*TJ/g, (_match, body: string) =>
      [...body.matchAll(/<([0-9a-fA-F]*)>/g)]
        .map((hex) => Buffer.from(hex[1]!, "hex").toString("latin1"))
        .join(""),
    );
}

test("workbook adds a summary, one sheet per staff member and the full base ledger", async () => {
  const workbook = new ExcelJS.Workbook();
  await loadWorkbook(workbook, await renderPayrollWorkbook(model));
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["Summary", "Alice Tan staff-a", 'Bob "The Barber", Jr staff-b', "Base ledger"],
  );
  for (const sheet of workbook.worksheets) assert.ok(sheet.rowCount > 0, sheet.name);
});

test("summary totals are frozen numbers that match the approved statement", async () => {
  const workbook = new ExcelJS.Workbook();
  await loadWorkbook(workbook, await renderPayrollWorkbook(model));
  const summary = workbook.getWorksheet("Summary")!;
  const rows = summary.getRow(15);
  assert.equal(rows.getCell(1).value, "Staff");
  const total = [...Array(21).keys()]
    .map((index) => summary.getRow(index + 1))
    .find((row) => row.getCell(1).value === "TOTAL")!;
  assert.ok(total, "summary ends with a TOTAL row");
  assert.equal(total.getCell(8).value, Number(model.totals.basicSalary));
  assert.equal(total.getCell(12).value, Number(model.totals.commission));
  assert.equal(total.getCell(17).value, Number(model.totals.takeHome));
  assert.equal(typeof total.getCell(17).value, "number");
  const staff = [...Array(21).keys()]
    .map((index) => summary.getRow(index + 1))
    .find((row) => row.getCell(2).value === "staff-a")!;
  assert.equal(staff.getCell(17).value, Number(model.staff[0]!.payroll.takeHome));
});

test("staff sheets show commission, incentive, carry and base-line detail", async () => {
  const workbook = new ExcelJS.Workbook();
  await loadWorkbook(workbook, await renderPayrollWorkbook(model));
  const sheet = workbook.getWorksheet("Alice Tan staff-a")!;
  const labels = [...Array(sheet.rowCount).keys()].map((index) =>
    String(sheet.getRow(index + 1).getCell(1).value ?? ""),
  );
  for (const label of [
    "Statement",
    "Payroll (SGD)",
    "Commission components",
    "Incentives",
    "Carry write-offs",
    "Base lines",
    "line-a-1",
    "line-a-2",
  ])
    assert.ok(labels.includes(label), label);
  const component = [...Array(sheet.rowCount).keys()]
    .map((index) => sheet.getRow(index + 1))
    .find((row) => row.getCell(1).value === "svc")!;
  assert.equal(component.getCell(2).value, "Service commission");
  assert.equal(typeof component.getCell(9).value, "number");
});

test("workbook neutralises spreadsheet formulas in exported text", async () => {
  const hostile = frozenPayrollExportModel(approvedPayrollExportState());
  hostile.staff[0]!.staff.name = '=HYPERLINK("http://evil","x")';
  hostile.staff[0]!.lines[0]!.productCategory = "+cmd";
  const workbook = new ExcelJS.Workbook();
  await loadWorkbook(workbook, await renderPayrollWorkbook(hostile));
  const sheet = workbook.getWorksheet("Summary")!;
  const values = [...Array(sheet.rowCount).keys()].map(
    (index) => sheet.getRow(index + 1).getCell(1).value,
  );
  assert.ok(values.includes('\'=HYPERLINK("http://evil","x")'), "summary staff name is guarded");
  const staff = workbook.worksheets[1]!;
  assert.ok(
    [...Array(staff.rowCount).keys()].some(
      (index) => staff.getRow(index + 1).getCell(5).value === "'+cmd",
    ),
    "line category is guarded",
  );
});

test("payslips render one readable page per staff member", async () => {
  const pdf = await renderPayrollPayslips(model);
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  const text = pdfText(pdf);
  assert.match(text, /Payslip 2026-09/);
  assert.equal(text.match(/Payslip 2026-09/g)?.length, 2);
  for (const fragment of [
    "Alice Tan",
    "staff-a",
    'Bob "The Barber", Jr',
    "Take home",
    "Employer levy (not paid out)",
    "Commission components",
    "This payslip reproduces an approved payroll close",
    model.calculation.inputHash,
  ])
    assert.ok(text.includes(fragment), fragment);
  assert.ok(!text.includes("999999.99"), "no draft or foreign values leak in");
});

test("an approved close without statements still renders a valid PDF", async () => {
  const empty = frozenPayrollExportModel(approvedPayrollExportState());
  empty.staff = [];
  const pdf = await renderPayrollPayslips(empty);
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(pdfText(pdf).includes("No staff statements"));
});
