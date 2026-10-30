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
import { resolvePayrollFocEconomics } from "./payroll-close-foc.js";

const id = z.string().trim().min(1).max(128);
const cents = z.string().regex(/^(0|[1-9]\d*)$/);
const money = z.object({ netCents: cents, taxCents: cents, grossCents: cents });
const evidence = z.unknown().refine((value) => value !== undefined && value !== null);
const refundSchema = money.extend({
  id,
  tenantId: id,
  saleId: id,
  outletId: id,
  currency: z.literal("SGD"),
  occurredAt: z.date(),
  /** Independent full sale refund/settlement record, not reconstructed bases. */
  evidence,
  payouts: z
    .array(
      z.object({
        method: z.enum(["CASH", "CARD", "PAYNOW", "NETS", "BANK_TRANSFER"]),
        grossCents: cents,
      }),
    )
    .min(1),
  /** Complete original external-cash allocations for every refunded sale line. */
  allocations: z
    .array(
      money.extend({
        id,
        saleLineId: id,
        originalEventId: id,
        reversalEventId: id,
        itemType: z.enum(["SERVICE", "PRODUCT"]),
        shares: commissionSharesSchema,
        /** Frozen operational checkout evidence, not a captured commission base. */
        foc: z
          .object({
            soldAt: z.iso.datetime(),
            line: z.object({
              id,
              saleId: id,
              itemId: id,
              itemType: z.literal("SERVICE"),
              quantity: z.number().int().safe().positive(),
              payrollEconomics: evidence,
            }),
          })
          .optional(),
        /** Source commission shares remain above; cash follows independently
         * verified collection sellers when they differ from service performers. */
        cashAttribution: z
          .object({
            allocations: z.array(
              z.object({ id, netCents: cents, shares: commissionSharesSchema, evidence }),
            ),
            evidence,
          })
          .optional(),
        evidence,
      }),
    )
    .min(1),
});
export type PayrollSaleRefund = z.input<typeof refundSchema>;
export interface PayrollCloseSaleRefundRecords extends PayrollCloseSourceRecords {
  saleRefunds?: PayrollSaleRefund[];
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
const cashStaff = (allocation: PayrollSaleRefund["allocations"][number]) => {
  const totals = new Map<string, bigint>();
  const parts = allocation.cashAttribution?.allocations ?? [allocation];
  for (const part of parts)
    for (const share of allocatePayrollSplit(decimal(part.netCents), part.shares))
      totals.set(share.staffId, (totals.get(share.staffId) ?? 0n) + ticks(share.amount));
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([staffId, amount]) => ({
      staffId,
      amount: `${amount / 10000n}.${(amount % 10000n).toString().padStart(4, "0")}`,
    }));
};

/** Full ordinary-sale refund validation only. No cash effect is inferred from a
 * reversal alone. Loader must establish completeness, funding and settlement. */
export function resolvePayrollCloseSaleRefunds(raw: PayrollCloseSaleRefundRecords) {
  const sources = resolvePayrollCloseSources(raw);
  const refunds = z.array(refundSchema).parse(raw.saleRefunds ?? []);
  if (refunds.some((row) => row.tenantId !== raw.tenantId))
    throw new Error("Payroll sale refund contains another salon's records.");
  const allocations = refunds.flatMap((row) => row.allocations);
  for (const keys of [
    refunds.map((row) => row.id),
    refunds.map((row) => row.saleId),
    allocations.map((row) => row.id),
    allocations.map((row) => row.originalEventId),
    allocations.map((row) => row.reversalEventId),
    allocations.flatMap((row) => row.cashAttribution?.allocations.map((part) => part.id) ?? []),
    refunds.flatMap((row) =>
      row.allocations.map((part) => JSON.stringify([row.saleId, part.saleLineId])),
    ),
  ])
    if (new Set(keys).size !== keys.length)
      throw new Error("Duplicate payroll sale refund evidence.");
  const snapshot = refunds
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
      payouts: [...row.payouts].sort(
        (a, b) => a.method.localeCompare(b.method) || a.grossCents.localeCompare(b.grossCents),
      ),
      allocations: [...row.allocations]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((part) => ({
          ...part,
          shares: [...part.shares].sort((a, b) => a.staffId.localeCompare(b.staffId)),
          ...(part.cashAttribution
            ? {
                cashAttribution: {
                  ...part.cashAttribution,
                  allocations: [...part.cashAttribution.allocations]
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .map((allocation) => ({
                      ...allocation,
                      shares: [...allocation.shares].sort((a, b) =>
                        a.staffId.localeCompare(b.staffId),
                      ),
                    })),
                },
              }
            : {}),
          staff: allocatePayrollSplit(decimal(part.netCents), part.shares),
          // Preserve each original collection allocation's four-decimal residual.
          // Splitting a combined line total can move residuals between sellers.
          cashStaff: cashStaff(part),
        })),
    }));
  payrollInputHash(snapshot);
  const blockers: { code: string; sourceId: string }[] = [];
  const block = (code: string, sourceId: string) => blockers.push({ code, sourceId });
  const all = [...raw.events, ...raw.lineageEvents];
  for (const refund of refunds) {
    if (!sources.sources) block("SALE_REFUND_SOURCES_UNAVAILABLE", refund.id);
    if (
      refund.occurredAt < new Date(sources.startsAt) ||
      refund.occurredAt >= new Date(sources.endsAt)
    )
      block("SALE_REFUND_OUTSIDE_REQUESTED_MONTH", refund.id);
    const sum = (key: "netCents" | "taxCents" | "grossCents") =>
      refund.allocations.reduce((total, row) => total + BigInt(row[key]), 0n);
    if (
      BigInt(refund.netCents) + BigInt(refund.taxCents) !== BigInt(refund.grossCents) ||
      refund.grossCents === "0" ||
      refund.payouts.some((row) => row.grossCents === "0") ||
      refund.payouts.reduce((total, row) => total + BigInt(row.grossCents), 0n) !==
        BigInt(refund.grossCents) ||
      (["netCents", "taxCents", "grossCents"] as const).some(
        (key) => sum(key) !== BigInt(refund[key]),
      )
    )
      block("SALE_REFUND_PAYOUT_MISMATCH", refund.id);
    for (const allocation of refund.allocations) {
      if (
        allocation.cashAttribution &&
        allocation.cashAttribution.allocations.reduce(
          (sum, row) => sum + BigInt(row.netCents),
          0n,
        ) !== BigInt(allocation.netCents)
      )
        block("SALE_REFUND_CASH_ALLOCATION_MISMATCH", allocation.id);
      const original = all.find((row) => row.id === allocation.originalEventId);
      const reversal = raw.events.find((row) => row.id === allocation.reversalEventId);
      if (
        !original ||
        original.sourceType !== "SALE_LINE" ||
        original.sourceId !== allocation.saleLineId ||
        original.saleId !== refund.saleId ||
        original.outletId !== refund.outletId ||
        original.occurredAt > refund.occurredAt ||
        !reversal ||
        reversal.sourceType !== "REVERSAL" ||
        reversal.sourceId !== original.id ||
        reversal.saleId !== refund.saleId ||
        reversal.outletId !== refund.outletId ||
        reversal.occurredAt < refund.occurredAt
      ) {
        block("SALE_REFUND_SOURCE_IDENTITY_MISMATCH", allocation.id);
        continue;
      }
      const parsed = z
        .object({ lines: z.array(payrollBaseLineSchema).min(1) })
        .safeParse(original.evidence);
      let baseAmount = decimal(allocation.netCents);
      if (allocation.foc) {
        if (
          allocation.itemType !== "SERVICE" ||
          allocation.foc.line.id !== allocation.saleLineId ||
          allocation.foc.line.saleId !== refund.saleId ||
          allocation.foc.soldAt !== original.occurredAt.toISOString() ||
          allocation.netCents !== "0" ||
          allocation.taxCents !== "0" ||
          allocation.grossCents !== "0" ||
          !allocation.cashAttribution ||
          allocation.cashAttribution.allocations.length
        )
          block("SALE_REFUND_FOC_ECONOMICS_MISMATCH", allocation.id);
        try {
          baseAmount = resolvePayrollFocEconomics(
            allocation.foc.line,
            new Date(allocation.foc.soldAt),
            0,
          ).baseAmount;
        } catch {
          block("SALE_REFUND_FOC_ECONOMICS_MISMATCH", allocation.id);
        }
      } else if (allocation.cashAttribution?.allocations.length === 0)
        block("SALE_REFUND_CASH_ALLOCATION_MISMATCH", allocation.id);
      const expected = allocatePayrollSplit(baseAmount, allocation.shares);
      const type = allocation.foc ? "FOC" : allocation.itemType === "SERVICE" ? "SVC" : "PRD";
      const focUnits = allocation.foc
        ? allocatePayrollSplit(`${allocation.foc.line.quantity}.0000`, allocation.shares)
        : null;
      if (
        BigInt(allocation.netCents) + BigInt(allocation.taxCents) !==
          BigInt(allocation.grossCents) ||
        !parsed.success ||
        parsed.data.lines.length !== expected.length ||
        expected.some((part) => {
          const line = parsed.success
            ? parsed.data.lines.find((row) => row.staffId === part.staffId)
            : null;
          return (
            !line ||
            line.commissionType !== type ||
            ticks(line.baseAmount) !== ticks(part.amount) ||
            (focUnits &&
              (line.mode !== "FOLLOW_PLAN" ||
                line.fixedCommission !== undefined ||
                line.units !== focUnits.find((row) => row.staffId === part.staffId)?.amount))
          );
        })
      )
        block("SALE_REFUND_ORIGINAL_ALLOCATION_MISMATCH", allocation.id);
    }
    const ordinaryOriginals = all.filter(
      (row) => row.saleId === refund.saleId && row.sourceType === "SALE_LINE",
    );
    if (
      ordinaryOriginals.length !== refund.allocations.length ||
      ordinaryOriginals.some(
        (row) => !refund.allocations.some((part) => part.originalEventId === row.id),
      )
    )
      block("SALE_REFUND_LINE_INVENTORY_MISMATCH", refund.id);
  }
  return structuredClone({
    blockers,
    reconciliation: blockers.length ? null : { refunds: snapshot },
  });
}
