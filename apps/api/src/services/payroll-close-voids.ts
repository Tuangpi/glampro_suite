import { z } from "zod";
import {
  allocatePayrollSplit,
  commissionSharesSchema,
  payrollBaseLineSchema,
} from "@glampro_suite/shared";
import {
  resolvePayrollCloseSources,
  type PayrollCloseSourceRecords,
} from "./payroll-close-sources.js";
import { payrollInputHash } from "./payroll-close-state.js";

const id = z.string().trim().min(1).max(128);
const cents = z.string().regex(/^(0|[1-9]\d*)$/);
const money = z.object({ netCents: cents, taxCents: cents, grossCents: cents });
const voidSchema = z.object({
  id,
  tenantId: id,
  saleId: id,
  outletId: id.nullable(),
  occurredAt: z.date(),
  currency: z.literal("SGD"),
  cashDisposition: z.literal("NO_MOVEMENT"),
  netCents: z.literal("0"),
  taxCents: z.literal("0"),
  grossCents: z.literal("0"),
  /** Independent operational void AND cash-disposition evidence/revisions.
   * A sale status or negative payroll capture alone cannot establish this fact. */
  evidence: z.unknown().refine((value) => value !== undefined && value !== null),
  reversals: z
    .array(
      z.object({
        eventId: id,
        originalEventId: id,
        originalSourceId: id,
        originalSourceType: z.enum(["SALE_LINE", "COLLECTION"]),
      }),
    )
    .min(1),
});
export type PayrollNoCashSaleVoid = z.input<typeof voidSchema>;
const returnedSchema = voidSchema
  .omit({ cashDisposition: true, netCents: true, taxCents: true, grossCents: true })
  .extend({
    cashDisposition: z.literal("RETURNED"),
    ...money.shape,
    payouts: z
      .array(
        z.object({
          id,
          method: z.enum(["CASH", "CARD", "PAYNOW", "NETS", "BANK_TRANSFER"]),
          grossCents: cents,
        }),
      )
      .min(1),
    /** Complete independently loaded original external-cash allocations, not
     * contracted purchase value. Every supplied allocation is returned fully. */
    allocations: z
      .array(
        money.extend({
          id,
          originalEventId: id,
          saleLineId: id,
          itemType: z.enum(["PACKAGE", "VALUE_PACKAGE", "SERVICE", "PRODUCT"]),
          shares: commissionSharesSchema,
          evidence: z.unknown().refine((value) => value !== undefined && value !== null),
        }),
      )
      .min(1),
  });
export type PayrollReturnedCashSaleVoid = z.input<typeof returnedSchema>;
export interface PayrollCloseVoidRecords extends PayrollCloseSourceRecords {
  noCashSaleVoids?: PayrollNoCashSaleVoid[];
  returnedCashSaleVoids?: PayrollReturnedCashSaleVoid[];
}

const ticks = (value: string) => {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return BigInt(whole + fraction.padEnd(4, "0")) * (negative ? -1n : 1n);
};
const decimal = (value: string) => {
  const amount = BigInt(value);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}00`;
};

/** Supplied no-movement or fully returned ordinary/collection voids. No settlement or
 * inventory authenticity is established and no payout is executed. */
export function resolvePayrollCloseVoids(raw: PayrollCloseVoidRecords) {
  const sources = resolvePayrollCloseSources(raw);
  const returned = z.array(returnedSchema).parse(raw.returnedCashSaleVoids ?? []);
  const records = [...z.array(voidSchema).parse(raw.noCashSaleVoids ?? []), ...returned];
  if (records.some((row) => row.tenantId !== raw.tenantId))
    throw new Error("Payroll sale void contains another salon's records.");
  const reversals = records.flatMap((row) => row.reversals);
  for (const keys of [
    records.map((row) => row.id),
    records.map((row) => row.saleId),
    reversals.map((row) => row.eventId),
    reversals.map((row) => row.originalEventId),
    returned.flatMap((row) => row.allocations.map((part) => part.id)),
    returned.flatMap((row) => row.allocations.map((part) => part.originalEventId)),
    returned.flatMap((row) => row.payouts.map((part) => part.id)),
  ])
    if (new Set(keys).size !== keys.length)
      throw new Error("Duplicate payroll sale void evidence.");
  const snapshot = records
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
      reversals: [...row.reversals].sort((a, b) => a.eventId.localeCompare(b.eventId)),
      ...(row.cashDisposition === "RETURNED"
        ? {
            payouts: [...row.payouts].sort((a, b) => a.id.localeCompare(b.id)),
            allocations: [...row.allocations]
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((part) => ({
                ...part,
                shares: [...part.shares].sort((a, b) => a.staffId.localeCompare(b.staffId)),
              })),
          }
        : {}),
    }));
  payrollInputHash(snapshot);
  const blockers: { code: string; sourceId: string }[] = [];
  const block = (code: string, sourceId: string) => blockers.push({ code, sourceId });
  const all = [...raw.events, ...raw.lineageEvents];
  const returnedCash: {
    saleId: string;
    outletId: string | null;
    netCents: string;
    staff: { staffId: string; amount: string }[];
  }[] = [];
  for (const record of records) {
    if (!sources.sources) block("VOID_SOURCE_RECONCILIATION_UNAVAILABLE", record.id);
    if (
      record.occurredAt < new Date(sources.startsAt) ||
      record.occurredAt >= new Date(sources.endsAt)
    )
      block("VOID_OUTSIDE_REQUESTED_MONTH", record.id);
    const originals = all.filter(
      (event) =>
        event.saleId === record.saleId && ["SALE_LINE", "COLLECTION"].includes(event.sourceType),
    );
    if (
      originals.length !== record.reversals.length ||
      originals.some((event) => !record.reversals.some((row) => row.originalEventId === event.id))
    )
      block("VOID_SOURCE_INVENTORY_MISMATCH", record.id);
    for (const part of record.reversals) {
      const original = all.find((event) => event.id === part.originalEventId);
      const reversal = raw.events.find((event) => event.id === part.eventId);
      if (
        !original ||
        original.sourceType !== part.originalSourceType ||
        original.sourceId !== part.originalSourceId ||
        original.saleId !== record.saleId ||
        original.outletId !== record.outletId ||
        original.occurredAt > record.occurredAt ||
        !reversal ||
        reversal.sourceType !== "REVERSAL" ||
        reversal.sourceId !== original.id ||
        reversal.saleId !== record.saleId ||
        reversal.outletId !== record.outletId ||
        reversal.occurredAt < record.occurredAt
      )
        block("VOID_SOURCE_IDENTITY_MISMATCH", part.eventId);
    }
    if (record.cashDisposition !== "RETURNED") continue;
    if (
      new Set(record.reversals.map((part) => part.originalSourceType)).size !== 1 ||
      record.allocations.length !== record.reversals.length ||
      record.reversals.some(
        (part) =>
          !record.allocations.some(
            (allocation) => allocation.originalEventId === part.originalEventId,
          ),
      )
    )
      block("VOID_RETURN_ALLOCATION_INVENTORY_MISMATCH", record.id);
    const sum = (key: "netCents" | "taxCents" | "grossCents") =>
      record.allocations.reduce((total, part) => total + BigInt(part[key]), 0n);
    if (
      record.grossCents === "0" ||
      BigInt(record.netCents) + BigInt(record.taxCents) !== BigInt(record.grossCents) ||
      record.payouts.some((part) => part.grossCents === "0") ||
      record.payouts.reduce((total, part) => total + BigInt(part.grossCents), 0n) !==
        BigInt(record.grossCents) ||
      (["netCents", "taxCents", "grossCents"] as const).some(
        (key) => sum(key) !== BigInt(record[key]),
      )
    )
      block("VOID_RETURN_PAYOUT_MISMATCH", record.id);
    const staff: { staffId: string; amount: string }[] = [];
    for (const allocation of [...record.allocations].sort((a, b) => a.id.localeCompare(b.id))) {
      const original = all.find((event) => event.id === allocation.originalEventId);
      const parsed = z
        .object({ lines: z.array(payrollBaseLineSchema).min(1) })
        .safeParse(original?.evidence);
      const expected = allocatePayrollSplit(decimal(allocation.netCents), allocation.shares);
      const ordinary = ["SERVICE", "PRODUCT"].includes(allocation.itemType);
      const type = {
        PACKAGE: "PKG_SALE",
        VALUE_PACKAGE: "VP_SALE",
        SERVICE: "SVC",
        PRODUCT: "PRD",
      }[allocation.itemType];
      if (
        !original ||
        original.sourceType !== (ordinary ? "SALE_LINE" : "COLLECTION") ||
        original.sourceId !== (ordinary ? allocation.saleLineId : allocation.id) ||
        BigInt(allocation.netCents) + BigInt(allocation.taxCents) !==
          BigInt(allocation.grossCents) ||
        !parsed.success ||
        parsed.data.lines.length !== expected.length ||
        expected.some((part) => {
          const line = parsed.success
            ? parsed.data.lines.find((line) => line.staffId === part.staffId)
            : null;
          return (
            !line || line.commissionType !== type || ticks(line.baseAmount) !== ticks(part.amount)
          );
        })
      )
        block("VOID_RETURN_ORIGINAL_ALLOCATION_MISMATCH", allocation.id);
      staff.push(...expected);
    }
    returnedCash.push({
      saleId: record.saleId,
      outletId: record.outletId,
      netCents: record.netCents,
      staff,
    });
  }
  return structuredClone({
    blockers,
    reconciliation: blockers.length
      ? null
      : {
          voids: snapshot,
          returnedCash: returnedCash.sort((a, b) => a.saleId.localeCompare(b.saleId)),
        },
  });
}
