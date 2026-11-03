import { readStoredPayrollClose } from "./payroll-close-store.js";
import {
  frozenPayrollExportModel,
  payrollExportFilename,
  payrollLedgerCsv,
  type PayrollLedgerQuery,
} from "./payroll-export-data.js";
import { renderPayrollPayslips } from "./payroll-export-pdf.js";
import { renderPayrollWorkbook } from "./payroll-export-xlsx.js";

export interface PayrollExportFile {
  filename: string;
  contentType: string;
  body: Buffer | string;
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF = "application/pdf";
const CSV = "text/csv; charset=utf-8";

/**
 * Owner-facing frozen exports. Each call re-reads the stored approved snapshot inside the
 * payroll store's verified transaction, so exports can never mix in a newer draft.
 */
export async function readPayrollWorkbookExport(period: string): Promise<PayrollExportFile> {
  const model = frozenPayrollExportModel(await readStoredPayrollClose(period));
  return {
    filename: payrollExportFilename("workbook.xlsx", model.periodKey),
    contentType: XLSX,
    body: await renderPayrollWorkbook(model),
  };
}

export async function readPayrollPayslipsExport(period: string): Promise<PayrollExportFile> {
  const model = frozenPayrollExportModel(await readStoredPayrollClose(period));
  return {
    filename: payrollExportFilename("payslips.pdf", model.periodKey),
    contentType: PDF,
    body: await renderPayrollPayslips(model),
  };
}

export async function readPayrollLedgerExport(
  period: string,
  query: PayrollLedgerQuery,
): Promise<PayrollExportFile> {
  const model = frozenPayrollExportModel(await readStoredPayrollClose(period));
  return {
    filename: payrollExportFilename("ledger.csv", model.periodKey),
    contentType: CSV,
    body: payrollLedgerCsv(model, query),
  };
}
