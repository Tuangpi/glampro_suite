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
const amount = (value: bigint) =>
  `${value / 10000n}.${(value % 10000n).toString().padStart(4, "0")}`;

/** Non-DB, positive-collection evidence only. Refund/reversal activity is deliberately
 * unavailable until independent payout and historical attribution reconciliation is
 * implemented. SALON_CASH totals are external net money, never commission bases.
 * SUM_INDIVIDUAL requires a separately defined population/base metric resolver. */
export function resolvePayrollCloseCash(
  raw: PayrollCloseCollectionRecords & {
    cashAttributions: PayrollCashAttribution[];
  },
) {
  const collections = resolvePayrollCloseCollections(raw);
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
  const blockers: { code: string; sourceId: string | null }[] = [];
  if (!collections.reconciliation)
    blockers.push({ code: "COLLECTION_RECONCILIATION_UNAVAILABLE", sourceId: null });
  for (const event of raw.events) {
    if (["REVERSAL", "PACKAGE_REFUND", "VALUE_PACKAGE_REFUND"].includes(event.sourceType))
      blockers.push({ code: "CASH_REFUND_RECONCILIATION_UNAVAILABLE", sourceId: event.id });
  }
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
  return structuredClone({
    status: blockers.length ? ("UNAVAILABLE" as const) : ("CASH_EVIDENCE_READY" as const),
    earningsActive: false as const,
    blockers,
    cash: blockers.length
      ? null
      : {
          salonCash: amount(
            allocations.reduce((sum, row) => sum + BigInt(row.netCents) * 100n, 0n),
          ),
          staff: [...staff]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([staffId, value]) => ({ staffId, collection: amount(value) })),
          outlets: [...outlets]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([outletId, value]) => ({ outletId, collection: amount(value) })),
          attributions,
          allocated: allocated.sort(
            (a, b) =>
              a.allocationId.localeCompare(b.allocationId) || a.staffId.localeCompare(b.staffId),
          ),
        },
  });
}
