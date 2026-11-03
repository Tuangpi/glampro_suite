import { z } from "zod";
import {
  exact,
  fixed,
  payrollBusinessDateSchema,
  payrollCommissionTypeSchema,
  payrollDecimalSchema,
  sum,
  type PayrollBaseLine,
  type PayrollStatement,
} from "@glampro_suite/shared";
import { badRequest, conflict } from "../lib/http-error.js";
import type { PayrollCloseState } from "./payroll-close-state.js";

/** Root-level statement money rendered by every CP-006 export surface. */
export const PAYROLL_EXPORT_MONEY_FIELDS = [
  "basicSalary",
  "fixedOvertime",
  "levy",
  "commission",
  "incentive",
  "overtime",
  "additions",
  "deductions",
  "unpaidLeave",
  "takeHome",
] as const;
export type PayrollExportMoneyField = (typeof PAYROLL_EXPORT_MONEY_FIELDS)[number];

export interface PayrollExportStaff {
  staff: PayrollStatement["staff"];
  payroll: PayrollStatement["payroll"];
  result: PayrollStatement["result"];
  plan: PayrollStatement["inputs"]["calculation"]["plan"];
  /** Frozen base ledger lines for this statement; never re-resolved from sources. */
  lines: PayrollBaseLine[];
}

export interface PayrollExportModel {
  periodKey: string;
  currency: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  calculation: {
    version: string;
    inputHash: string;
    calculatedAt: string;
    calculatedBy: string;
  };
  approval: { at: string; actorId: string; reason: string };
  staff: PayrollExportStaff[];
  totals: Record<PayrollExportMoneyField, string> & { collection: string };
}

export interface PayrollExportLedgerRow {
  staffId: string;
  staffName: string;
  line: PayrollBaseLine;
}

/** Filters accepted by the base-ledger export. Strict so unknown query keys fail loudly. */
export const payrollLedgerQuerySchema = z.strictObject({
  staffId: z.string().trim().min(1).max(128).optional(),
  outletId: z.string().trim().min(1).max(128).optional(),
  commissionType: payrollCommissionTypeSchema.optional(),
  status: z.enum(["EARNED", "REVERSED", "PAID"]).optional(),
  from: payrollBusinessDateSchema.optional(),
  to: payrollBusinessDateSchema.optional(),
});
export type PayrollLedgerQuery = z.infer<typeof payrollLedgerQuerySchema>;

/**
 * Only an approved, hash-verified snapshot is exportable. A draft may still change,
 * so exporting it as a payslip or ledger would misrepresent final pay (TC-20).
 */
export function frozenPayrollExportModel(state: PayrollCloseState): PayrollExportModel {
  const { calculation, approval } = state;
  if (state.status !== "APPROVED" || !calculation || !approval)
    throw conflict("Approve payroll before exporting frozen statements.");
  const statements = calculation.statements.map((statement) => ({
    staff: statement.staff,
    payroll: statement.payroll,
    result: statement.result,
    plan: statement.inputs.calculation.plan,
    lines: statement.inputs.calculation.lines,
  }));
  const total = (field: PayrollExportMoneyField) =>
    fixed(sum(statements.map((row) => exact(row.payroll[field]))), 2);
  return structuredClone({
    periodKey: calculation.inputs.periodKey,
    currency: calculation.inputs.currency,
    timeZone: calculation.inputs.timeZone,
    startsAt: calculation.inputs.startsAt,
    endsAt: calculation.inputs.endsAt,
    calculation: {
      version: calculation.version,
      inputHash: calculation.inputHash,
      calculatedAt: calculation.calculatedAt,
      calculatedBy: calculation.calculatedBy,
    },
    approval,
    staff: statements,
    totals: {
      ...(Object.fromEntries(
        PAYROLL_EXPORT_MONEY_FIELDS.map((field) => [field, total(field)]),
      ) as Record<PayrollExportMoneyField, string>),
      collection: fixed(sum(statements.map((row) => exact(row.payroll.collection))), 4),
    },
  });
}

/** Payslip money lines, in statement order, so a printed payslip reconciles to take home. */
export function payrollPayslipLines(staff: PayrollExportStaff) {
  const payroll = staff.payroll;
  return [
    { label: "Basic salary", amount: payroll.basicSalary },
    { label: "Fixed overtime", amount: payroll.fixedOvertime },
    { label: "Commission", amount: payroll.commission },
    { label: "Incentive", amount: payroll.incentive },
    { label: "Overtime", amount: payroll.overtime },
    { label: "Additions", amount: payroll.additions },
    { label: "Less unpaid leave", amount: payroll.unpaidLeave },
    { label: "Less deductions", amount: payroll.deductions },
    { label: "Take home", amount: payroll.takeHome },
  ];
}

/** Frozen base lines across staff, filtered and ordered by business date then line ID. */
export function payrollExportLedger(
  model: PayrollExportModel,
  query: PayrollLedgerQuery = {},
): PayrollExportLedgerRow[] {
  const filters = payrollLedgerQuerySchema.parse(query);
  if (filters.from && filters.to && filters.from > filters.to)
    throw badRequest("The ledger from date must not be after the to date.");
  return model.staff
    .flatMap((staff) =>
      staff.lines.map((line) => ({ staffId: staff.staff.id, staffName: staff.staff.name, line })),
    )
    .filter(
      (row) =>
        (!filters.staffId || row.staffId === filters.staffId) &&
        (!filters.outletId || row.line.outletId === filters.outletId) &&
        (!filters.commissionType || row.line.commissionType === filters.commissionType) &&
        (!filters.status || row.line.status === filters.status) &&
        (!filters.from || row.line.businessDate >= filters.from) &&
        (!filters.to || row.line.businessDate <= filters.to),
    )
    .sort(
      (a, b) =>
        a.line.businessDate.localeCompare(b.line.businessDate) ||
        a.line.id.localeCompare(b.line.id),
    );
}

const INJECTION = /^[=+\-@\t\r]/;

/** Neutralises spreadsheet formulas without changing the readable value. */
export function spreadsheetText(value: string): string {
  return INJECTION.test(value) ? `'${value}` : value;
}

/** RFC 4180 field with a leading-quote guard against formula injection. */
export function csvText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const safe = spreadsheetText(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Money/decimal cells stay numeric; rejecting anything else prevents formula payloads. */
export function csvDecimal(value: string): string {
  if (!payrollDecimalSchema.safeParse(value).success)
    throw new Error("Export contains a non-decimal money value.");
  return value;
}

const LEDGER_HEADER = [
  "Period",
  "Staff ID",
  "Staff",
  "Line ID",
  "Business date",
  "Commission type",
  "Outlet ID",
  "Product category",
  "Base amount",
  "Units",
  "Status",
  "Mode",
  "Fixed commission",
  "Fallback rate %",
];

/** Filtered base-ledger CSV. The BOM keeps Excel from mis-decoding UTF-8 names. */
export function payrollLedgerCsv(
  model: PayrollExportModel,
  query: PayrollLedgerQuery = {},
): string {
  const lines = payrollExportLedger(model, query).map((row) =>
    [
      csvText(model.periodKey),
      csvText(row.staffId),
      csvText(row.staffName),
      csvText(row.line.id),
      csvText(row.line.businessDate),
      csvText(row.line.commissionType),
      csvText(row.line.outletId),
      csvText(row.line.productCategory ?? ""),
      csvDecimal(row.line.baseAmount),
      csvDecimal(row.line.units),
      csvText(row.line.status),
      csvText(row.line.mode),
      row.line.fixedCommission === undefined ? "" : csvDecimal(row.line.fixedCommission),
      row.line.fallbackRatePct === undefined ? "" : csvDecimal(row.line.fallbackRatePct),
    ].join(","),
  );
  return `\uFEFF${[LEDGER_HEADER.join(","), ...lines].join("\r\n")}\r\n`;
}

export type PayrollExportKind = "workbook.xlsx" | "payslips.pdf" | "ledger.csv";

export function payrollExportFilename(kind: PayrollExportKind, periodKey: string) {
  if (kind === "workbook.xlsx") return `payroll-${periodKey}.xlsx`;
  if (kind === "payslips.pdf") return `payroll-payslips-${periodKey}.pdf`;
  return `payroll-base-ledger-${periodKey}.csv`;
}
