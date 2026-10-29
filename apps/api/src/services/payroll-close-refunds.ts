import { z } from "zod";
import {
  allocatePayrollSplit,
  commissionSharesSchema,
  payrollBaseLineSchema,
} from "@glampro_suite/shared";
import type { PayrollCloseSourceRecords } from "./payroll-close-sources.js";
import { payrollInputHash } from "./payroll-close-state.js";

const id = z.string().trim().min(1).max(128);
const cents = z.string().regex(/^(0|[1-9]\d*)$/);
const money = z.object({
  netCents: cents,
  taxCents: cents,
  grossCents: cents,
  payoutMethod: z.enum(["NONE", "CASH", "CARD", "PAYNOW", "NETS", "BANK_TRANSFER"]),
});
const payoutSchema = money.extend({
  id,
  tenantId: id,
  eventId: id,
  saleId: id,
  saleLineId: id,
  outletId: id,
  currency: z.literal("SGD"),
  occurredAt: z.date(),
  originalAllocations: z
    .array(z.object({ allocationId: id, saleLineId: id, netCents: cents }))
    .min(1),
  /** Independent settled payout/cancellation revision, never inferred from bases. */
  evidence: z.unknown().refine((value) => value !== undefined && value !== null),
});
const refundSchema = money.extend({
  purchase: z.object({ saleId: id, saleLineId: id, sellers: commissionSharesSchema }),
  originalSourceIds: z.array(id).min(1),
  lines: z.array(payrollBaseLineSchema),
});
export type PayrollRefundPayout = z.input<typeof payoutSchema>;
export type PayrollCloseRefundRecords = PayrollCloseSourceRecords & {
  refundPayouts?: PayrollRefundPayout[];
};

const ticks = (value: string) => {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return BigInt(whole + fraction.padEnd(4, "0")) * (negative ? -1n : 1n);
};
const decimal = (value: bigint) =>
  `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}00`;

/** Supplied-record package refund reconciliation only. Callers must also validate
 * source capture/inventory. This is not a payout executor or authoritative loader. */
export function resolvePayrollCloseRefunds(raw: PayrollCloseRefundRecords) {
  const payouts = z.array(payoutSchema).parse(raw.refundPayouts ?? []);
  if (payouts.some((row) => row.tenantId !== raw.tenantId))
    throw new Error("Payroll refund payout contains another salon's records.");
  if (
    new Set(payouts.map((row) => row.id)).size !== payouts.length ||
    new Set(payouts.map((row) => row.eventId)).size !== payouts.length
  )
    throw new Error("Duplicate payroll refund payout evidence.");
  payrollInputHash(payouts.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })));
  const blockers: { code: string; sourceId: string }[] = [];
  const block = (code: string, sourceId: string) => blockers.push({ code, sourceId });
  const events = raw.events.filter((row) =>
    ["PACKAGE_REFUND", "VALUE_PACKAGE_REFUND"].includes(row.sourceType),
  );
  const refunds: {
    eventId: string;
    outletId: string;
    netCents: string;
    staff: { staffId: string; amount: string }[];
  }[] = [];
  const all = [...raw.events, ...raw.lineageEvents];
  const consumedSources = new Set<string>();
  for (const payout of payouts)
    if (!events.some((event) => event.id === payout.eventId))
      block("REFUND_PAYOUT_EVENT_UNAVAILABLE", payout.id);
  for (const event of events) {
    const payout = payouts.find((row) => row.eventId === event.id);
    const parsed = refundSchema.safeParse(event.evidence);
    if (!payout || !parsed.success) {
      block("CASH_REFUND_RECONCILIATION_UNAVAILABLE", event.id);
      continue;
    }
    const refund = parsed.data;
    if (
      payout.saleId !== event.saleId ||
      payout.outletId !== event.outletId ||
      payout.occurredAt.getTime() !== event.occurredAt.getTime() ||
      refund.purchase.saleId !== event.saleId ||
      payout.saleLineId !== refund.purchase.saleLineId ||
      payout.netCents !== refund.netCents ||
      payout.taxCents !== refund.taxCents ||
      payout.grossCents !== refund.grossCents ||
      payout.payoutMethod !== refund.payoutMethod ||
      BigInt(payout.netCents) + BigInt(payout.taxCents) !== BigInt(payout.grossCents) ||
      (payout.payoutMethod === "NONE") !== (payout.grossCents === "0")
    )
      block("REFUND_PAYOUT_MISMATCH", event.id);
    const type = event.sourceType === "PACKAGE_REFUND" ? "PKG_SALE" : "VP_SALE";
    let originalNet = 0n;
    const originalStaff = new Set<string>();
    if (
      new Set(payout.originalAllocations.map((row) => row.allocationId)).size !==
        payout.originalAllocations.length ||
      payout.originalAllocations.length !== refund.originalSourceIds.length
    )
      block("REFUND_ORIGINAL_ALLOCATION_MISMATCH", event.id);
    if (new Set(refund.originalSourceIds).size !== refund.originalSourceIds.length)
      block("REFUND_ORIGINAL_SOURCE_DUPLICATE", event.id);
    for (const sourceId of refund.originalSourceIds) {
      if (consumedSources.has(sourceId)) block("REFUND_ORIGINAL_SOURCE_REUSED", event.id);
      consumedSources.add(sourceId);
      const original = all.find((row) => row.id === sourceId);
      const evidence = z
        .object({ lines: z.array(payrollBaseLineSchema).min(1) })
        .safeParse(original?.evidence);
      if (
        !original ||
        original.sourceType !== "COLLECTION" ||
        original.saleId !== event.saleId ||
        original.outletId !== event.outletId ||
        original.occurredAt > event.occurredAt ||
        !evidence.success ||
        evidence.data.lines.some(
          (line) => line.commissionType !== type || ticks(line.baseAmount) < 0n,
        )
      ) {
        block("REFUND_ORIGINAL_SOURCE_UNAVAILABLE", event.id);
        continue;
      }
      for (const line of evidence.data.lines) {
        originalNet += ticks(line.baseAmount);
        originalStaff.add(line.staffId);
      }
      const sourceTotal = evidence.data.lines.reduce(
        (sum, line) => sum + ticks(line.baseAmount),
        0n,
      );
      const allocation = payout.originalAllocations.find(
        (row) => row.allocationId === original.sourceId,
      );
      if (
        !allocation ||
        allocation.saleLineId !== payout.saleLineId ||
        BigInt(allocation.netCents) * 100n !== sourceTotal
      )
        block("REFUND_ORIGINAL_ALLOCATION_MISMATCH", event.id);
      const expected = allocatePayrollSplit(
        `${sourceTotal / 10000n}.${(sourceTotal % 10000n).toString().padStart(4, "0")}`,
        refund.purchase.sellers,
      );
      if (
        evidence.data.lines.length !== expected.length ||
        expected.some((part) => {
          const line = evidence.data.lines.find((row) => row.staffId === part.staffId);
          return !line || ticks(line.baseAmount) !== ticks(part.amount);
        })
      )
        block("REFUND_ORIGINAL_ATTRIBUTION_MISMATCH", event.id);
    }
    const shares = [...refund.purchase.sellers].sort((a, b) => a.staffId.localeCompare(b.staffId));
    if (
      originalNet < BigInt(refund.netCents) * 100n ||
      originalStaff.size !== shares.length ||
      shares.some((row) => !originalStaff.has(row.staffId))
    )
      block("REFUND_ORIGINAL_CONSIDERATION_MISMATCH", event.id);
    const staff = allocatePayrollSplit(decimal(BigInt(refund.netCents)), shares);
    if (
      refund.netCents === "0"
        ? refund.lines.length !== 0
        : refund.lines.length !== staff.length ||
          staff.some((part) => {
            const line = refund.lines.find((row) => row.staffId === part.staffId);
            return (
              !line ||
              line.commissionType !== type ||
              ticks(line.baseAmount) !== -ticks(part.amount)
            );
          })
    )
      block("REFUND_SELLER_BASE_MISMATCH", event.id);
    refunds.push({
      eventId: event.id,
      outletId: payout.outletId,
      netCents: payout.netCents,
      staff,
    });
  }
  return structuredClone({
    blockers,
    reconciliation: blockers.length
      ? null
      : {
          refunds: refunds.sort((a, b) => a.eventId.localeCompare(b.eventId)),
          payouts: payouts
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((row) => ({
              ...row,
              originalAllocations: [...row.originalAllocations].sort((a, b) =>
                a.allocationId.localeCompare(b.allocationId),
              ),
              occurredAt: row.occurredAt.toISOString(),
            })),
        },
  });
}
