import { z } from "zod";
import { payrollBaseLineSchema } from "@glampro_suite/shared";
import {
  resolvePayrollCloseSources,
  type PayrollCloseSourceRecords,
} from "./payroll-close-sources.js";

const id = z.string().trim().min(1).max(128);
const cents = z.string().regex(/^(0|[1-9]\d*)$/);
const operationSchema = z.object({
  tenantId: id,
  sourceType: z.enum(["SALE_PAYMENT", "OUTSTANDING_PAYMENT"]),
  sourceId: id,
  saleId: id,
  currency: z.literal("SGD"),
  grossCents: cents,
  occurredAt: z.date(),
});
const allocationSchema = z.object({
  id,
  tenantId: id,
  collectionId: id,
  saleLineId: id,
  itemType: z.enum(["SERVICE", "PRODUCT", "PACKAGE", "VALUE_PACKAGE", "OTHER"]),
  grossCents: cents,
  netCents: cents,
  taxCents: cents,
});
const collectionSchema = operationSchema.extend({
  id,
  allocations: z.array(allocationSchema).min(1),
});
export interface PayrollCloseCollectionRecords extends PayrollCloseSourceRecords {
  /** Complete settled external-payment facts in the requested month, normalized
   * by the future trusted loader. Never infer these from commission bases. */
  operations: z.input<typeof operationSchema>[];
  collections: z.input<typeof collectionSchema>[];
}

/** Reconciles supplied operational facts, captured allocations and package bases.
 * Does not prove DB inventory completeness, provider settlement, seller attribution
 * for collection metrics, refund totals or scoped incentive metrics. No activation. */
export function resolvePayrollCloseCollections(raw: PayrollCloseCollectionRecords) {
  const sources = resolvePayrollCloseSources(raw);
  const tenantId = id.parse(raw.tenantId);
  const operations = z.array(operationSchema).parse(raw.operations);
  const collections = z.array(collectionSchema).parse(raw.collections);
  const allocations = collections.flatMap((row) => row.allocations);
  if ([...operations, ...collections, ...allocations].some((row) => row.tenantId !== tenantId))
    throw new Error("Payroll collection evidence contains another salon's records.");
  const key = (row: z.infer<typeof operationSchema>) =>
    JSON.stringify([row.sourceType, row.sourceId]);
  for (const keys of [
    operations.map(key),
    collections.map(key),
    collections.map((row) => row.id),
    allocations.map((row) => row.id),
    allocations.map((row) => JSON.stringify([row.collectionId, row.saleLineId])),
  ]) {
    if (new Set(keys).size !== keys.length)
      throw new Error("Duplicate payroll collection evidence.");
  }
  const blockers: { code: string; sourceId: string }[] = [];
  const block = (code: string, sourceId: string) => blockers.push({ code, sourceId });
  const from = new Date(sources.startsAt);
  const to = new Date(sources.endsAt);
  const operationByKey = new Map(operations.map((row) => [key(row), row]));
  const collectionByKey = new Map(collections.map((row) => [key(row), row]));
  for (const operation of operations) {
    if (operation.occurredAt < from || operation.occurredAt >= to)
      block("PAYMENT_OUTSIDE_REQUESTED_MONTH", operation.sourceId);
    if (!collectionByKey.has(key(operation)))
      block("PAYMENT_COLLECTION_MISSING", operation.sourceId);
  }
  const collectionEvents = raw.events.filter((row) =>
    ["COLLECTION", "ORDINARY_COLLECTION"].includes(row.sourceType),
  );
  const allocationById = new Map(allocations.map((row) => [row.id, row]));
  for (const event of collectionEvents) {
    const allocation = allocationById.get(event.sourceId);
    if (
      !allocation ||
      !(
        event.sourceType === "ORDINARY_COLLECTION"
          ? ["SERVICE", "PRODUCT"]
          : ["PACKAGE", "VALUE_PACKAGE"]
      ).includes(allocation.itemType)
    )
      block("COLLECTION_EVENT_ALLOCATION_UNAVAILABLE", event.id);
  }
  for (const collection of collections) {
    const operation = operationByKey.get(key(collection));
    if (!operation) block("COLLECTION_PAYMENT_MISSING", collection.id);
    else if (
      operation.saleId !== collection.saleId ||
      operation.grossCents !== collection.grossCents ||
      operation.occurredAt.getTime() !== collection.occurredAt.getTime()
    )
      block("COLLECTION_PAYMENT_MISMATCH", collection.id);
    if (collection.occurredAt < from || collection.occurredAt >= to)
      block("COLLECTION_OUTSIDE_REQUESTED_MONTH", collection.id);
    let gross = 0n;
    for (const allocation of collection.allocations) {
      gross += BigInt(allocation.grossCents);
      if (
        allocation.collectionId !== collection.id ||
        BigInt(allocation.netCents) + BigInt(allocation.taxCents) !== BigInt(allocation.grossCents)
      )
        block("COLLECTION_ALLOCATION_MISMATCH", allocation.id);
      const events = collectionEvents.filter((row) => row.sourceId === allocation.id);
      const ordinary = ["SERVICE", "PRODUCT"].includes(allocation.itemType);
      if (!["PACKAGE", "VALUE_PACKAGE"].includes(allocation.itemType) && !events.length) continue;
      if (events.length !== 1) {
        block("PACKAGE_COLLECTION_EVENT_MISSING_OR_DUPLICATE", allocation.id);
        continue;
      }
      const event = events[0];
      const parsed = z.object({ lines: z.array(payrollBaseLineSchema) }).safeParse(event.evidence);
      const lines = parsed.success ? parsed.data.lines : null;
      const type =
        allocation.itemType === "PACKAGE"
          ? "PKG_SALE"
          : allocation.itemType === "VALUE_PACKAGE"
            ? "VP_SALE"
            : allocation.itemType === "PRODUCT"
              ? "PRD"
              : "SVC";
      if (
        event.saleId !== collection.saleId ||
        event.sourceType !== (ordinary ? "ORDINARY_COLLECTION" : "COLLECTION") ||
        (ordinary && collection.sourceType !== "OUTSTANDING_PAYMENT") ||
        event.occurredAt.getTime() !== collection.occurredAt.getTime() ||
        !lines ||
        lines.some(
          (line) => line.commissionType !== type || (ordinary && line.units !== "0.0000"),
        ) ||
        lines.reduce((sum, line) => {
          const [whole, fraction = ""] = line.baseAmount.split(".");
          return sum + BigInt(whole + fraction.padEnd(4, "0"));
        }, 0n) !==
          BigInt(allocation.netCents) * 100n
      )
        block("PACKAGE_COLLECTION_BASE_MISMATCH", allocation.id);
    }
    if (gross !== BigInt(collection.grossCents)) block("COLLECTION_GROSS_MISMATCH", collection.id);
  }
  const ready = sources.status !== "UNAVAILABLE" && blockers.length === 0;
  return structuredClone({
    status: ready ? ("COLLECTION_EVIDENCE_READY" as const) : ("UNAVAILABLE" as const),
    earningsActive: false as const,
    sourceBlockers: sources.blockers,
    blockers: blockers.sort(
      (a, b) => a.sourceId.localeCompare(b.sourceId) || a.code.localeCompare(b.code),
    ),
    reconciliation: ready
      ? {
          operations: [...operations]
            .sort((a, b) => key(a).localeCompare(key(b)))
            .map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
          collections: [...collections]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((row) => ({
              ...row,
              occurredAt: row.occurredAt.toISOString(),
              allocations: [...row.allocations].sort((a, b) => a.id.localeCompare(b.id)),
            })),
          externalGrossCents: operations
            .reduce((sum, row) => sum + BigInt(row.grossCents), 0n)
            .toString(),
          externalNetCents: allocations
            .reduce((sum, row) => sum + BigInt(row.netCents), 0n)
            .toString(),
          sources: sources.sources,
        }
      : null,
  });
}
