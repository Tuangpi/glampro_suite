import { z } from "zod";
import {
  allocatePayrollSplit,
  commissionSharesSchema,
  payrollBaseLineSchema,
} from "@glampro_suite/shared";
import {
  resolvePayrollCloseCollections,
  type PayrollCloseCollectionRecords,
} from "./payroll-close-collections.js";
import { payrollInputHash } from "./payroll-close-state.js";
import {
  resolvePayrollCloseReversals,
  type PayrollCloseReversalRecords,
} from "./payroll-close-reversals.js";
import {
  resolvePayrollCloseRefunds,
  type PayrollCloseRefundRecords,
} from "./payroll-close-refunds.js";

const id = z.string().trim().min(1).max(128);
const attributionSchema = z.object({
  tenantId: id,
  allocationId: id,
  saleLineId: id,
  outletId: id,
  shares: commissionSharesSchema,
  /** Historical operational attribution/revision, not current staff or cashier. */
  evidence: z.unknown().refine((value) => value !== undefined && value !== null),
});
export type PayrollCashAttribution = z.input<typeof attributionSchema>;
const ticks = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(4, "0"));
};
const amount = (value: bigint) => {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 10000n}.${(absolute % 10000n).toString().padStart(4, "0")}`;
};

/** Non-DB net collection, package payout and explicit non-cash usage reversals.
 * Full ordinary-sale refunds require independent payouts. Cash is never inferred from bases. */
export function resolvePayrollCloseCash(
  raw: PayrollCloseCollectionRecords &
    PayrollCloseRefundRecords & {
      cashAttributions: PayrollCashAttribution[];
    } & PayrollCloseReversalRecords,
) {
  const collections = resolvePayrollCloseCollections(raw);
  const refunds = resolvePayrollCloseRefunds(raw);
  const reversals = resolvePayrollCloseReversals(raw);
  const attributions = z
    .array(attributionSchema)
    .parse(raw.cashAttributions)
    .sort((a, b) => a.allocationId.localeCompare(b.allocationId))
    .map((row) => ({
      ...row,
      shares: [...row.shares].sort((a, b) => a.staffId.localeCompare(b.staffId)),
    }));
  if (attributions.some((row) => row.tenantId !== raw.tenantId))
    throw new Error("Payroll cash attribution contains another salon's records.");
  if (new Set(attributions.map((row) => row.allocationId)).size !== attributions.length)
    throw new Error("Duplicate payroll cash allocation attribution.");
  payrollInputHash(attributions);
  const blockers: { code: string; sourceId: string | null }[] = [
    ...refunds.blockers,
    ...reversals.blockers,
  ];
  if (!collections.reconciliation)
    blockers.push({ code: "COLLECTION_RECONCILIATION_UNAVAILABLE", sourceId: null });
  const allocations =
    collections.reconciliation?.collections.flatMap((row) => row.allocations) ?? [];
  const byId = new Map(allocations.map((row) => [row.id, row]));
  for (const row of attributions) {
    const allocation = byId.get(row.allocationId);
    if (!allocation || allocation.saleLineId !== row.saleLineId)
      blockers.push({ code: "CASH_ATTRIBUTION_ALLOCATION_MISMATCH", sourceId: row.allocationId });
  }
  const staff = new Map<string, bigint>();
  const outlets = new Map<string, bigint>();
  const allocated: { allocationId: string; outletId: string; staffId: string; amount: string }[] =
    [];
  for (const row of allocations) {
    const attribution = attributions.find((entry) => entry.allocationId === row.id);
    if (!attribution) {
      blockers.push({ code: "CASH_ATTRIBUTION_UNAVAILABLE", sourceId: row.id });
      continue;
    }
    const value = BigInt(row.netCents) * 100n;
    // Collection sources supply outlet evidence for packages; ordinary lines need
    // their independent operational attribution snapshot from the future loader.
    const event = raw.events.find(
      (entry) => entry.sourceType === "COLLECTION" && entry.sourceId === row.id,
    );
    if (event && event.outletId !== attribution.outletId)
      blockers.push({ code: "CASH_ATTRIBUTION_OUTLET_MISMATCH", sourceId: row.id });
    const packageEvidence = event
      ? z.object({ lines: z.array(payrollBaseLineSchema) }).safeParse(event.evidence)
      : null;
    if (packageEvidence?.success && packageEvidence.data.lines.length !== attribution.shares.length)
      blockers.push({ code: "CASH_PACKAGE_ATTRIBUTION_MISMATCH", sourceId: row.id });
    for (const part of allocatePayrollSplit(amount(value), attribution.shares)) {
      if (event) {
        const line = packageEvidence?.success
          ? packageEvidence.data.lines.find((entry) => entry.staffId === part.staffId)
          : null;
        if (!line || ticks(line.baseAmount) !== ticks(part.amount))
          blockers.push({ code: "CASH_PACKAGE_ATTRIBUTION_MISMATCH", sourceId: row.id });
      }
      staff.set(part.staffId, (staff.get(part.staffId) ?? 0n) + ticks(part.amount));
      allocated.push({
        allocationId: row.id,
        outletId: attribution.outletId,
        staffId: part.staffId,
        amount: part.amount,
      });
    }
    outlets.set(attribution.outletId, (outlets.get(attribution.outletId) ?? 0n) + value);
  }
  for (const refund of refunds.reconciliation?.refunds ?? []) {
    const value = BigInt(refund.netCents) * 100n;
    outlets.set(refund.outletId, (outlets.get(refund.outletId) ?? 0n) - value);
    for (const part of refund.staff)
      staff.set(part.staffId, (staff.get(part.staffId) ?? 0n) - ticks(part.amount));
  }
  const saleRefunds = reversals.reconciliation?.saleRefunds?.refunds ?? [];
  const voidReturns = reversals.reconciliation?.voids?.returnedCash ?? [];
  for (const returned of raw.returnedCashSaleVoids ?? []) {
    for (const allocation of returned.allocations) {
      const collected = byId.get(allocation.id);
      const original = raw.events.find((event) => event.id === allocation.originalEventId);
      const attribution = attributions.find((row) => row.allocationId === allocation.id);
      const collection = collections.reconciliation?.collections.find((row) =>
        row.allocations.some((part) => part.id === allocation.id),
      );
      if (
        (original && !collected) ||
        (collected &&
          (collection?.saleId !== returned.saleId ||
            collected.itemType !== allocation.itemType ||
            attribution?.outletId !== returned.outletId ||
            payrollInputHash(attribution?.shares ?? []) !==
              payrollInputHash(
                [...allocation.shares].sort((a, b) => a.staffId.localeCompare(b.staffId)),
              ) ||
            collected.saleLineId !== allocation.saleLineId ||
            collected.netCents !== allocation.netCents ||
            collected.taxCents !== allocation.taxCents ||
            collected.grossCents !== allocation.grossCents))
      )
        blockers.push({ code: "VOID_RETURN_CURRENT_COLLECTION_MISMATCH", sourceId: allocation.id });
    }
  }
  for (const returned of voidReturns) {
    if (returned.outletId === null) {
      blockers.push({ code: "VOID_RETURN_CASH_OUTLET_UNAVAILABLE", sourceId: returned.saleId });
      continue;
    }
    outlets.set(
      returned.outletId,
      (outlets.get(returned.outletId) ?? 0n) - BigInt(returned.netCents) * 100n,
    );
    for (const part of returned.staff)
      staff.set(part.staffId, (staff.get(part.staffId) ?? 0n) - ticks(part.amount));
  }
  for (const refund of saleRefunds) {
    outlets.set(
      refund.outletId,
      (outlets.get(refund.outletId) ?? 0n) - BigInt(refund.netCents) * 100n,
    );
    for (const allocation of refund.allocations)
      for (const part of allocation.staff)
        staff.set(part.staffId, (staff.get(part.staffId) ?? 0n) - ticks(part.amount));
  }
  return structuredClone({
    status: blockers.length ? ("UNAVAILABLE" as const) : ("CASH_EVIDENCE_READY" as const),
    earningsActive: false as const,
    blockers,
    cash: blockers.length
      ? null
      : {
          salonCash: amount(
            allocations.reduce((sum, row) => sum + BigInt(row.netCents) * 100n, 0n) -
              (refunds.reconciliation?.refunds ?? []).reduce(
                (sum, row) => sum + BigInt(row.netCents) * 100n,
                0n,
              ) -
              saleRefunds.reduce((sum, row) => sum + BigInt(row.netCents) * 100n, 0n) -
              voidReturns.reduce((sum, row) => sum + BigInt(row.netCents) * 100n, 0n),
          ),
          staff: [...staff]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([staffId, value]) => ({ staffId, collection: amount(value) })),
          outlets: [...outlets]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([outletId, value]) => ({ outletId, collection: amount(value) })),
          attributions,
          refunds: refunds.reconciliation,
          reversals: reversals.reconciliation,
          allocated: allocated.sort(
            (a, b) =>
              a.allocationId.localeCompare(b.allocationId) || a.staffId.localeCompare(b.staffId),
          ),
        },
  });
}
