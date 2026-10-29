import { z } from "zod";
import { resolvePayrollCloseVoids, type PayrollCloseVoidRecords } from "./payroll-close-voids.js";
import {
  resolvePayrollCloseSources,
  type PayrollCloseSourceRecords,
} from "./payroll-close-sources.js";
import { payrollInputHash } from "./payroll-close-state.js";
import {
  resolvePayrollCloseSaleRefunds,
  type PayrollCloseSaleRefundRecords,
} from "./payroll-close-sale-refunds.js";

const id = z.string().trim().min(1).max(128);
const noCashSchema = z.object({
  id,
  tenantId: id,
  eventId: id,
  originalEventId: id,
  originalSourceId: id,
  originalSourceType: z.enum(["REDEMPTION", "VALUE_SPEND", "CORRECTION"]),
  saleId: id,
  outletId: id.nullable(),
  occurredAt: z.date(),
  currency: z.literal("SGD"),
  netCents: z.literal("0"),
  taxCents: z.literal("0"),
  grossCents: z.literal("0"),
  /** Independent operational void/correction revision confirming no money movement.
   * Never synthesize this from a payroll reversal or its negative base lines. */
  evidence: z.unknown().refine((value) => value !== undefined && value !== null),
});
export type PayrollNoCashReversal = z.input<typeof noCashSchema>;
export interface PayrollCloseReversalRecords
  extends PayrollCloseSourceRecords, PayrollCloseSaleRefundRecords, PayrollCloseVoidRecords {
  noCashReversals?: PayrollNoCashReversal[];
}

/** Validates non-cash usage reversals and independently reconciled full ordinary
 * sale refunds and explicit no-movement/fully returned collection voids.
 * Uncertain/unsupported void cash still fails closed; no DB loading. */
export function resolvePayrollCloseReversals(raw: PayrollCloseReversalRecords) {
  const sources = resolvePayrollCloseSources(raw);
  const saleRefunds = resolvePayrollCloseSaleRefunds(raw);
  const voids = resolvePayrollCloseVoids(raw);
  const records = z.array(noCashSchema).parse(raw.noCashReversals ?? []);
  if (records.some((row) => row.tenantId !== raw.tenantId))
    throw new Error("Payroll no-cash reversal contains another salon's records.");
  for (const keys of [records.map((row) => row.id), records.map((row) => row.eventId)])
    if (new Set(keys).size !== keys.length)
      throw new Error("Duplicate payroll no-cash reversal evidence.");
  const snapshot = records
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() }));
  payrollInputHash(snapshot);
  const blockers: { code: string; sourceId: string | null }[] = [
    ...saleRefunds.blockers,
    ...voids.blockers,
  ];
  const block = (code: string, sourceId: string | null) => blockers.push({ code, sourceId });
  if (!sources.sources) block("REVERSAL_SOURCE_RECONCILIATION_UNAVAILABLE", null);
  for (const saleVoid of [...(raw.noCashSaleVoids ?? []), ...(raw.returnedCashSaleVoids ?? [])]) {
    if (
      (raw.saleRefunds ?? []).some((refund) => refund.saleId === saleVoid.saleId) ||
      raw.events.some(
        (event) =>
          event.saleId === saleVoid.saleId &&
          ["PACKAGE_REFUND", "VALUE_PACKAGE_REFUND"].includes(event.sourceType),
      )
    )
      block("VOID_REFUND_CASH_EFFECT_CONFLICT", saleVoid.id);
  }
  const reversals = raw.events.filter((row) => row.sourceType === "REVERSAL");
  const all = [...raw.events, ...raw.lineageEvents];
  for (const record of records)
    if (!reversals.some((event) => event.id === record.eventId))
      block("NO_CASH_REVERSAL_EVENT_UNAVAILABLE", record.id);
  for (const event of reversals) {
    const cashRefund = saleRefunds.reconciliation?.refunds.some((row) =>
      row.allocations.some((part) => part.reversalEventId === event.id),
    );
    const record = records.find((row) => row.eventId === event.id);
    const noCashVoid = voids.reconciliation?.voids.some((row) =>
      row.reversals.some((part) => part.eventId === event.id),
    );
    if (noCashVoid) {
      if (record || cashRefund) block("REVERSAL_CASH_EFFECT_CONFLICT", event.id);
      continue;
    }
    if (cashRefund) {
      if (record) block("REVERSAL_CASH_EFFECT_CONFLICT", event.id);
      continue;
    }
    const original = all.find((row) => row.id === event.sourceId);
    if (!record) {
      block("CASH_REFUND_RECONCILIATION_UNAVAILABLE", event.id);
      continue;
    }
    if (
      !original ||
      original.id !== record.originalEventId ||
      original.sourceId !== record.originalSourceId ||
      original.sourceType !== record.originalSourceType ||
      event.saleId !== record.saleId ||
      event.outletId !== record.outletId ||
      event.occurredAt.getTime() !== record.occurredAt.getTime()
    )
      block("NO_CASH_REVERSAL_IDENTITY_MISMATCH", event.id);
  }
  return structuredClone({
    blockers,
    reconciliation: blockers.length
      ? null
      : {
          noCashReversals: snapshot,
          saleRefunds: saleRefunds.reconciliation,
          voids: voids.reconciliation,
        },
  });
}
