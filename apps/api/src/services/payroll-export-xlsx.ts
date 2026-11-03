import ExcelJS from "exceljs";
import {
  payrollExportLedger,
  payrollPayslipLines,
  spreadsheetText,
  type PayrollExportModel,
  type PayrollExportStaff,
} from "./payroll-export-data.js";

const MONEY = "#,##0.00";
const BASE = "#,##0.0000";
const PERCENT = "0.00";

/** Money stays numeric so an owner can pivot, but frozen totals are written by us rather
 * than re-added by Excel, so the workbook reconciles to the statement to the cent. */
function money(cell: ExcelJS.Cell, value: string) {
  cell.value = Number(value);
  cell.numFmt = MONEY;
}
function base(cell: ExcelJS.Cell, value: string) {
  cell.value = Number(value);
  cell.numFmt = BASE;
}
function text(cell: ExcelJS.Cell, value: string | null | undefined) {
  cell.value = value === null || value === undefined ? "" : spreadsheetText(value);
}
function bold(row: ExcelJS.Row) {
  row.font = { bold: true };
}
function heading(sheet: ExcelJS.Worksheet, title: string) {
  bold(sheet.addRow([title]));
}
function yesNo(value: boolean) {
  return value ? "YES" : "NO";
}
/** Excel forbids []:*?/\ in sheet names, which also caps the usable length at 31. */
function sheetName(staff: PayrollExportStaff, used: Set<string>) {
  const cleaned = `${staff.staff.name} ${staff.staff.id}`
    .replace(/[[\\\]/:*?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const root = (cleaned || "Staff").slice(0, 28);
  let name = root;
  let suffix = 2;
  while (used.has(name.toLowerCase())) name = `${root.slice(0, 26)} ${suffix++}`;
  used.add(name.toLowerCase());
  return name;
}

function summarySheet(workbook: ExcelJS.Workbook, model: PayrollExportModel) {
  const sheet = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 15 }] });
  sheet.columns = [{ width: 28 }, ...Array.from({ length: 20 }, () => ({ width: 16 }))];
  const title = sheet.addRow(["Approved payroll statement"]);
  title.font = { bold: true, size: 14 };
  for (const [label, value] of [
    ["Period", model.periodKey],
    ["Status", "APPROVED"],
    ["Currency", model.currency],
    ["Salon time zone", model.timeZone],
    ["Period window", `${model.startsAt} to ${model.endsAt}`],
    ["Calculation version", model.calculation.version],
    ["Calculation input hash", model.calculation.inputHash],
    ["Calculated at", model.calculation.calculatedAt],
    ["Calculated by", model.calculation.calculatedBy],
    ["Approved at", model.approval.at],
    ["Approved by", model.approval.actorId],
    ["Approval reason", model.approval.reason],
  ])
    sheet.addRow([label, spreadsheetText(String(value))]);
  sheet.addRow([]);
  const header = sheet.addRow([
    "Staff",
    "Staff ID",
    "Left salon",
    "Plan",
    "Plan version",
    "Stage",
    "Tenure month",
    "Basic salary",
    "Fixed overtime",
    "Levy",
    "Unpaid leave",
    "Commission",
    "Incentive",
    "Overtime",
    "Additions",
    "Deductions",
    "Take home",
    "Collection",
    "Payroll / sales %",
    "Sales alert",
  ]);
  bold(header);
  for (const row of model.staff) {
    const line = sheet.addRow([]);
    text(line.getCell(1), row.staff.name);
    text(line.getCell(2), row.staff.id);
    line.getCell(3).value = yesNo(row.staff.disabled);
    text(line.getCell(4), row.plan?.planId ?? "No plan");
    text(line.getCell(5), row.plan?.versionId ?? "");
    text(line.getCell(6), row.result.stageKey);
    line.getCell(7).value = row.result.tenureMonth;
    money(line.getCell(8), row.payroll.basicSalary);
    money(line.getCell(9), row.payroll.fixedOvertime);
    money(line.getCell(10), row.payroll.levy);
    money(line.getCell(11), row.payroll.unpaidLeave);
    money(line.getCell(12), row.payroll.commission);
    money(line.getCell(13), row.payroll.incentive);
    money(line.getCell(14), row.payroll.overtime);
    money(line.getCell(15), row.payroll.additions);
    money(line.getCell(16), row.payroll.deductions);
    money(line.getCell(17), row.payroll.takeHome);
    base(line.getCell(18), row.payroll.collection);
    if (row.payroll.payrollSalesPct === null) line.getCell(19).value = "";
    else {
      line.getCell(19).value = Number(row.payroll.payrollSalesPct);
      line.getCell(19).numFmt = PERCENT;
    }
    line.getCell(20).value = yesNo(row.payroll.alert);
  }
  const total = sheet.addRow(["TOTAL"]);
  bold(total);
  const totals = model.totals;
  money(total.getCell(8), totals.basicSalary);
  money(total.getCell(9), totals.fixedOvertime);
  money(total.getCell(10), totals.levy);
  money(total.getCell(11), totals.unpaidLeave);
  money(total.getCell(12), totals.commission);
  money(total.getCell(13), totals.incentive);
  money(total.getCell(14), totals.overtime);
  money(total.getCell(15), totals.additions);
  money(total.getCell(16), totals.deductions);
  money(total.getCell(17), totals.takeHome);
  base(total.getCell(18), totals.collection);
  sheet.addRow([]);
  sheet.addRow([
    "Frozen approved snapshot. Nothing outside this workbook was recalculated for the export.",
  ]);
  return sheet;
}

function staffSheet(
  workbook: ExcelJS.Workbook,
  staff: PayrollExportStaff,
  model: PayrollExportModel,
  name: string,
) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [
    { width: 24 },
    { width: 24 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 18 },
    { width: 16 },
  ];
  heading(sheet, "Statement");
  for (const [label, value] of [
    ["Staff", staff.staff.name],
    ["Staff ID", staff.staff.id],
    ["Left salon", yesNo(staff.staff.disabled)],
    ["Period", model.periodKey],
    ["Plan", staff.plan?.planId ?? "No plan"],
    ["Plan version", staff.plan?.versionId ?? ""],
    ["Stage", staff.result.stageKey],
    ["Tenure month", staff.result.tenureMonth === null ? "" : String(staff.result.tenureMonth)],
    ["Calculation version", model.calculation.version],
    ["Calculation input hash", model.calculation.inputHash],
    ["Approved at", model.approval.at],
  ])
    sheet.addRow([label, spreadsheetText(value)]);
  sheet.addRow([]);

  heading(sheet, `Payroll (${model.currency})`);
  bold(sheet.addRow(["Component", "Amount"]));
  for (const line of payrollPayslipLines(staff)) {
    const row = sheet.addRow([line.label]);
    money(row.getCell(2), line.amount);
    if (line.label === "Take home") bold(row);
  }
  const levy = sheet.addRow(["Employer levy (not paid out)"]);
  money(levy.getCell(2), staff.payroll.levy);
  const collection = sheet.addRow(["Collection"]);
  base(collection.getCell(2), staff.payroll.collection);
  const ratio = sheet.addRow(["Payroll / sales %"]);
  if (staff.payroll.payrollSalesPct !== null) {
    ratio.getCell(2).value = Number(staff.payroll.payrollSalesPct);
    ratio.getCell(2).numFmt = PERCENT;
  }
  sheet.addRow(["Sales alert", yesNo(staff.payroll.alert)]);
  sheet.addRow([]);

  heading(sheet, "Commission components");
  bold(
    sheet.addRow([
      "Component",
      "Name",
      "Method",
      "Raw base",
      "Pooled base",
      "Units",
      "Rate %",
      "Capped",
      "Amount",
      "Carry forward base",
      "Carry units",
    ]),
  );
  if (!staff.result.components.length)
    sheet.addRow(["No commission components on this statement."]);
  for (const component of staff.result.components) {
    const row = sheet.addRow([]);
    text(row.getCell(1), component.componentKey);
    text(row.getCell(2), component.componentName);
    text(row.getCell(3), component.method);
    base(row.getCell(4), component.rawBase);
    base(row.getCell(5), component.pooledBase);
    base(row.getCell(6), component.units);
    if (component.ratePct === null) row.getCell(7).value = "";
    else {
      row.getCell(7).value = Number(component.ratePct);
      row.getCell(7).numFmt = PERCENT;
    }
    row.getCell(8).value = yesNo(component.capped);
    money(row.getCell(9), component.amount);
    base(row.getCell(10), component.carryForwardOut);
    base(row.getCell(11), component.carryUnitsOut);
  }
  sheet.addRow([]);

  heading(sheet, "Incentives");
  bold(
    sheet.addRow([
      "Rule",
      "Scope",
      "Outlet",
      "Individual metric",
      "Group metric",
      "Row index",
      "Amount",
    ]),
  );
  if (!staff.result.incentives.length) sheet.addRow(["No incentives on this statement."]);
  for (const incentive of staff.result.incentives) {
    const row = sheet.addRow([]);
    text(row.getCell(1), incentive.ruleKey);
    text(row.getCell(2), incentive.scope);
    text(row.getCell(3), incentive.outletId);
    base(row.getCell(4), incentive.individualMetric);
    if (incentive.groupMetric !== null) base(row.getCell(5), incentive.groupMetric);
    row.getCell(6).value = incentive.rowIndex;
    money(row.getCell(7), incentive.amount);
  }
  sheet.addRow([]);

  heading(sheet, "Carry write-offs");
  bold(sheet.addRow(["Component", "Base", "Units", "Reason"]));
  if (!staff.result.carryWriteOffs.length) sheet.addRow(["No carry write-offs on this statement."]);
  for (const writeOff of staff.result.carryWriteOffs) {
    const row = sheet.addRow([]);
    text(row.getCell(1), writeOff.componentKey);
    base(row.getCell(2), writeOff.base);
    base(row.getCell(3), writeOff.units);
    text(row.getCell(4), writeOff.reason);
  }
  sheet.addRow([]);

  heading(sheet, "Base lines");
  bold(
    sheet.addRow([
      "Line ID",
      "Business date",
      "Type",
      "Outlet",
      "Category",
      "Base amount",
      "Units",
      "Status",
      "Mode",
      "Fixed commission",
      "Fallback rate %",
    ]),
  );
  if (!staff.lines.length) sheet.addRow(["No base lines in this period."]);
  for (const line of staff.lines) {
    const row = sheet.addRow([]);
    text(row.getCell(1), line.id);
    text(row.getCell(2), line.businessDate);
    text(row.getCell(3), line.commissionType);
    text(row.getCell(4), line.outletId);
    text(row.getCell(5), line.productCategory);
    base(row.getCell(6), line.baseAmount);
    base(row.getCell(7), line.units);
    text(row.getCell(8), line.status);
    text(row.getCell(9), line.mode);
    if (line.fixedCommission !== undefined) money(row.getCell(10), line.fixedCommission);
    if (line.fallbackRatePct !== undefined) {
      row.getCell(11).value = Number(line.fallbackRatePct);
      row.getCell(11).numFmt = PERCENT;
    }
  }
  return sheet;
}
/** Complete base ledger for the frozen month, before any web-side filtering. */
function ledgerSheet(workbook: ExcelJS.Workbook, model: PayrollExportModel) {
  const sheet = workbook.addWorksheet("Base ledger");
  sheet.columns = [
    { width: 16 },
    { width: 22 },
    { width: 24 },
    { width: 28 },
    { width: 14 },
    { width: 14 },
    { width: 18 },
    { width: 20 },
    { width: 16 },
    { width: 14 },
    { width: 12 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
  ];
  bold(
    sheet.addRow([
      "Period",
      "Staff ID",
      "Staff",
      "Line ID",
      "Business date",
      "Type",
      "Outlet",
      "Category",
      "Base amount",
      "Units",
      "Status",
      "Mode",
      "Fixed commission",
      "Fallback rate %",
    ]),
  );
  const rows = payrollExportLedger(model);
  if (!rows.length) sheet.addRow(["No base lines were posted to this approved period."]);
  for (const row of rows) {
    const line = sheet.addRow([]);
    text(line.getCell(1), model.periodKey);
    text(line.getCell(2), row.staffId);
    text(line.getCell(3), row.staffName);
    text(line.getCell(4), row.line.id);
    text(line.getCell(5), row.line.businessDate);
    text(line.getCell(6), row.line.commissionType);
    text(line.getCell(7), row.line.outletId);
    text(line.getCell(8), row.line.productCategory);
    base(line.getCell(9), row.line.baseAmount);
    base(line.getCell(10), row.line.units);
    text(line.getCell(11), row.line.status);
    text(line.getCell(12), row.line.mode);
    if (row.line.fixedCommission !== undefined) money(line.getCell(13), row.line.fixedCommission);
    if (row.line.fallbackRatePct !== undefined) {
      line.getCell(14).value = Number(row.line.fallbackRatePct);
      line.getCell(14).numFmt = PERCENT;
    }
  }
  return sheet;
}

/** Real XLSX (not CSV renamed) so owners can filter, total and share a payroll workbook. */
export async function renderPayrollWorkbook(model: PayrollExportModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Glampro Suite";
  workbook.lastModifiedBy = "Glampro Suite";
  workbook.title = `Approved payroll ${model.periodKey}`;
  workbook.subject = "Frozen approved payroll statements";
  workbook.created = new Date(model.approval.at);
  workbook.modified = new Date(model.approval.at);
  summarySheet(workbook, model);
  const used = new Set(["summary", "base ledger"]);
  for (const staff of model.staff) staffSheet(workbook, staff, model, sheetName(staff, used));
  ledgerSheet(workbook, model);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
