import { z } from "zod";
import ExcelJS from "exceljs";
import { payrollPeriodKeySchema } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden } from "../lib/http-error.js";
import { verifiedPayrollCloseSnapshot } from "./payroll-close-store.js";
import {
  frozenPayrollExportModel,
  payrollExportLedger,
  payrollLedgerQuerySchema,
  spreadsheetText,
} from "./payroll-export-data.js";
import { payrollLineSourceCandidates } from "./payroll-report.js";
import { payrollDetailLineage } from "./payroll-detail-lineage.js";

export const commissionDetailQuerySchema = payrollLedgerQuerySchema.extend({
  period: payrollPeriodKeySchema,
  throughPeriod: payrollPeriodKeySchema.optional(),
  customerId: z.string().trim().min(1).max(128).optional(),
  packageId: z.string().trim().min(1).max(128).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

/** Read approved bases, never invent per-line commission from a pooled award. */
export async function commissionDetail(raw: unknown, exportAll = false) {
  const query = commissionDetailQuerySchema.parse(raw);
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId()) throw forbidden();
  return prisma.$transaction(
    async (tx) => {
      const actor = await tx.user.findFirst({
        where: { id: scope.actorId, disabled: false },
        select: { globalRole: true },
      });
      if (!actor || !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole)) throw forbidden();
      const end = query.throughPeriod ?? query.period;
      if (end < query.period) throw conflict("The last payroll month must not precede the first.");
      const [year, month] = query.period.split("-").map(Number);
      const [endYear, endMonth] = end.split("-").map(Number);
      const count = (endYear - year) * 12 + endMonth - month + 1;
      if (count > 24) throw conflict("Commission detail supports at most 24 payroll months.");
      const {
        period: _period,
        throughPeriod: _through,
        customerId,
        packageId,
        page,
        limit,
        ...filters
      } = query;
      const rows: (ReturnType<typeof payrollExportLedger>[number] & { period: string })[] = [];
      const unavailablePeriods: string[] = [];
      for (let index = 0; index < count; index++) {
        const period = new Date(Date.UTC(year, month - 1 + index, 1)).toISOString().slice(0, 7);
        const verified = await verifiedPayrollCloseSnapshot(tx, period);
        if (!verified || !["APPROVED", "PAID"].includes(verified.state.status)) {
          unavailablePeriods.push(period);
          continue;
        }
        const model = frozenPayrollExportModel(verified.state);
        rows.push(...payrollExportLedger(model, filters).map((row) => ({ ...row, period })));
      }
      const keys = [
        ...new Set(rows.flatMap((row) => payrollLineSourceCandidates(row.line.id, row.staffId))),
      ];
      const references = await payrollDetailLineage(tx, keys);
      const matching = rows
        .map((row) => {
          const candidates = payrollLineSourceCandidates(row.line.id, row.staffId);
          const reference = candidates.map((key) => references.get(key)).find(Boolean);
          return {
            ...row,
            saleId: reference?.saleId ?? null,
            customerId: reference?.customerId ?? null,
            packageId: reference?.packageId ?? null,
            sourceEventId: reference?.sourceEventId ?? null,
            originalSourceEventId: reference?.originalSourceEventId ?? null,
            lineageAvailable: reference?.lineageAvailable ?? false,
          };
        })
        .filter(
          (row) =>
            (!customerId || row.customerId === customerId) &&
            (!packageId || row.packageId === packageId),
        );
      return {
        period: query.period,
        throughPeriod: end,
        unavailablePeriods,
        approved: unavailablePeriods.length === 0,
        total: unavailablePeriods.length ? 0 : matching.length,
        page,
        pages: unavailablePeriods.length ? 0 : Math.ceil(matching.length / limit),
        rows: unavailablePeriods.length
          ? []
          : exportAll
            ? matching
            : matching.slice((page - 1) * limit, page * limit),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function commissionDetailWorkbook(raw: unknown) {
  const data = await commissionDetail(raw, true);
  if (!data.approved) throw conflict("Approve payroll before exporting commission detail.");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Commission detail");
  sheet.addRow(["Approved payroll bases — commission is pooled per component, not per line"]);
  sheet.addRow([
    "Staff",
    "Staff ID",
    "Date",
    "Type",
    "Base",
    "Units",
    "Status",
    "Sale",
    "Customer",
    "Package",
    "Source line",
    "Payroll month",
    "Source event",
    "Original source event",
  ]);
  for (const row of data.rows)
    sheet.addRow(
      [
        row.staffName,
        row.staffId,
        row.line.businessDate,
        row.line.commissionType,
        row.line.baseAmount,
        row.line.units,
        row.line.status,
        row.saleId,
        row.customerId,
        row.packageId,
        row.line.id,
        row.period,
        row.sourceEventId,
        row.originalSourceEventId,
      ].map((value) => (value === null ? "" : spreadsheetText(value))),
    );
  return {
    filename: `commission-detail-${data.period}${data.throughPeriod !== data.period ? "-" + data.throughPeriod : ""}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}
