import { z } from "zod";
import { payrollInputHash } from "./payroll-close-state.js";
import {
  resolvePayrollCloseSources,
  type PayrollCloseSourceRecords,
} from "./payroll-close-sources.js";

const id = z.string().trim().min(1).max(128);
const operationSchema = z.object({
  tenantId: id,
  sourceType: z.enum([
    "SALE_LINE",
    "COLLECTION",
    "ORDINARY_COLLECTION",
    "REDEMPTION",
    "VALUE_SPEND",
    "CORRECTION",
    "REVERSAL",
    "PACKAGE_REFUND",
    "VALUE_PACKAGE_REFUND",
  ]),
  sourceId: id,
  /** Corrections reuse a redemption ID; each immutable revision is a distinct operation. */
  sourceKey: id.optional(),
  saleId: id,
  outletId: id.nullable(),
  occurredAt: z.date(),
  /** Operational source revision/snapshot, independently loaded rather than
   * reconstructed from the captured payroll event itself. */
  evidence: z.unknown().refine((value) => value !== undefined && value !== null),
});
export interface PayrollCloseInventoryRecords extends PayrollCloseSourceRecords {
  operations: z.input<typeof operationSchema>[];
}

/** Matches a supplied independent operational inventory one-to-one to captures.
 * Completeness/authenticity of that inventory must still be established by a
 * trusted, unpaginated transactional loader. Does not read or mutate any database. */
export function resolvePayrollCloseInventory(raw: PayrollCloseInventoryRecords) {
  const sources = resolvePayrollCloseSources(raw);
  const tenantId = id.parse(raw.tenantId);
  const operations = z.array(operationSchema).parse(raw.operations);
  payrollInputHash(operations.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })));
  if (operations.some((row) => row.tenantId !== tenantId))
    throw new Error("Payroll inventory contains another salon's operation.");
  const key = (row: { sourceType: string; sourceId: string; sourceKey?: string }) =>
    JSON.stringify([
      row.sourceType,
      row.sourceId,
      row.sourceType === "CORRECTION" ? row.sourceKey : null,
    ]);
  const keys = operations.map(key);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate payroll inventory operation.");
  const blockers: { code: string; sourceKey: string }[] = [];
  const block = (code: string, sourceKey: string) => blockers.push({ code, sourceKey });
  const from = new Date(sources.startsAt);
  const to = new Date(sources.endsAt);
  const byKey = new Map(operations.map((row) => [key(row), row]));
  const eventsByKey = new Map<string, PayrollCloseSourceRecords["events"]>();
  for (const event of raw.events) {
    const rows = eventsByKey.get(key(event)) ?? [];
    rows.push(event);
    eventsByKey.set(key(event), rows);
    if (!byKey.has(key(event))) block("CAPTURE_OPERATION_UNAVAILABLE", key(event));
  }
  for (const operation of operations) {
    const identity = key(operation);
    if (operation.occurredAt < from || operation.occurredAt >= to)
      block("OPERATION_OUTSIDE_REQUESTED_MONTH", identity);
    const events = eventsByKey.get(identity) ?? [];
    if (events.length !== 1) {
      block("OPERATION_CAPTURE_MISSING_OR_DUPLICATE", identity);
      continue;
    }
    const event = events[0];
    if (
      event.saleId !== operation.saleId ||
      event.outletId !== operation.outletId ||
      event.occurredAt.getTime() !== operation.occurredAt.getTime()
    )
      block("OPERATION_CAPTURE_IDENTITY_MISMATCH", identity);
  }
  const ready = sources.status !== "UNAVAILABLE" && blockers.length === 0;
  return structuredClone({
    status: ready ? ("INVENTORY_EVIDENCE_READY" as const) : ("UNAVAILABLE" as const),
    earningsActive: false as const,
    sourceBlockers: sources.blockers,
    blockers: blockers.sort(
      (a, b) => a.sourceKey.localeCompare(b.sourceKey) || a.code.localeCompare(b.code),
    ),
    inventory: ready
      ? {
          operations: [...operations]
            .sort((a, b) => key(a).localeCompare(key(b)))
            .map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
          sources: sources.sources,
        }
      : null,
  });
}
