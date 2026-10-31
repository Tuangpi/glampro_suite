import { z } from "zod";
import { payrollBaseLineSchema, payrollPeriodKeySchema } from "@glampro_suite/shared";
import { salonDayBounds } from "../lib/wall-clock.js";
import { payrollInputHash } from "./payroll-close-state.js";

const id = z.string().trim().min(1).max(128);
const eventSchema = z.object({
  id,
  tenantId: id,
  sourceKey: id,
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
  saleId: id,
  outletId: id.nullable(),
  occurredAt: z.date(),
  createdAt: z.date(),
  evidence: z.unknown(),
});
const evidenceSchema = z
  .object({
    version: z.literal(1),
    status: z.literal("CAPTURED"),
    postingStatus: z.literal("PENDING_RELEASE"),
    currency: z.literal("SGD"),
    missingEvidence: z.array(z.string()).length(0).optional(),
    lines: z.array(payrollBaseLineSchema),
  })
  .passthrough();
export interface PayrollCloseSourceRecords {
  tenantId: string;
  periodKey: string;
  timeZone: string;
  /** All candidate events whose occurrence is in the requested month, not a paginated sample.
   * Completeness and source-operation reconciliation remain the authoritative loader's job. */
  events: z.input<typeof eventSchema>[];
  /** Original events for reversals, including originals from previously approved months. */
  lineageEvents: z.input<typeof eventSchema>[];
}

const ticks = (value: string) => {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return BigInt(whole + fraction.padEnd(4, "0")) * (negative ? -1n : 1n);
};
function businessDate(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}

/** Non-activating record validation only. It cannot establish a complete source inventory,
 * absence of legacy payments, authoritative cash metrics, or next-open-period posting.
 * Reversals are additive negative lines, never a mutation/removal of original history.
 */
export function resolvePayrollCloseSources(raw: PayrollCloseSourceRecords) {
  const tenantId = id.parse(raw.tenantId);
  const periodKey = payrollPeriodKeySchema.parse(raw.periodKey);
  const [year, month] = periodKey.split("-").map(Number);
  const from = salonDayBounds(`${periodKey}-01`, raw.timeZone).from;
  const to = salonDayBounds(
    new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    raw.timeZone,
  ).from;
  const events = raw.events
    .map((row) => eventSchema.parse(row))
    .sort((a, b) => a.id.localeCompare(b.id));
  const lineage = raw.lineageEvents.map((row) => eventSchema.parse(row));
  const all = [...events, ...lineage];
  if (all.some((row) => row.tenantId !== tenantId))
    throw new Error("Payroll source evidence contains another salon's event.");
  if (
    new Set(all.map((row) => row.id)).size !== all.length ||
    new Set(all.map((row) => row.sourceKey)).size !== all.length
  )
    throw new Error("Duplicate payroll source event IDs or keys.");
  const blockers: { code: string; eventId: string }[] = [];
  const block = (code: string, eventId: string) => {
    blockers.push({ code, eventId });
  };
  const parsed = new Map<string, z.infer<typeof evidenceSchema>>();
  const lineIds = new Set<string>();
  for (const event of all) {
    const evidence = evidenceSchema.safeParse(event.evidence);
    if (!evidence.success) {
      block("SOURCE_EVIDENCE_UNAVAILABLE", event.id);
      continue;
    }
    parsed.set(event.id, evidence.data);
    if (
      new Set(evidence.data.lines.map((line) => line.staffId)).size !== evidence.data.lines.length
    )
      block("DUPLICATE_SOURCE_STAFF", event.id);
    const types: Record<typeof event.sourceType, string[]> = {
      SALE_LINE: ["SVC", "PRD", "FOC"],
      COLLECTION: ["PKG_SALE", "VP_SALE"],
      ORDINARY_COLLECTION: ["SVC", "PRD"],
      REDEMPTION: ["PKG_RED"],
      VALUE_SPEND: ["VP_SPEND"],
      CORRECTION: ["PKG_RED"],
      REVERSAL: ["SVC", "PRD", "FOC", "PKG_SALE", "VP_SALE", "PKG_RED", "VP_SPEND"],
      PACKAGE_REFUND: ["PKG_SALE"],
      VALUE_PACKAGE_REFUND: ["VP_SALE"],
    };
    for (const line of evidence.data.lines) {
      if (!types[event.sourceType].includes(line.commissionType))
        block("SOURCE_COMMISSION_TYPE_MISMATCH", event.id);
      if (lineIds.has(line.id)) block("DUPLICATE_SOURCE_LINE", event.id);
      lineIds.add(line.id);
      if (line.status !== "EARNED") block("SOURCE_LINE_NOT_UNPOSTED", event.id);
      if (line.outletId !== event.outletId) block("SOURCE_OUTLET_MISMATCH", event.id);
      if (line.businessDate !== businessDate(event.occurredAt, raw.timeZone))
        block("SOURCE_BUSINESS_DATE_MISMATCH", event.id);
    }
  }
  const originalById = new Map(all.map((row) => [row.id, row]));
  const reversedIds = new Set<string>();
  for (const event of events) {
    if (event.occurredAt < from || event.occurredAt >= to)
      block("SOURCE_OUTSIDE_REQUESTED_MONTH", event.id);
    const evidence = parsed.get(event.id);
    if (!evidence) continue;
    if (event.sourceType !== "REVERSAL") {
      if (
        !evidence.lines.length &&
        !["PACKAGE_REFUND", "VALUE_PACKAGE_REFUND"].includes(event.sourceType)
      )
        block("SOURCE_LINES_UNAVAILABLE", event.id);
      if (
        !evidence.lines.length &&
        ["PACKAGE_REFUND", "VALUE_PACKAGE_REFUND"].includes(event.sourceType) &&
        (evidence.netCents !== "0" ||
          evidence.taxCents !== "0" ||
          evidence.grossCents !== "0" ||
          evidence.payoutMethod !== "NONE")
      )
        block("EMPTY_REFUND_EVIDENCE_INVALID", event.id);
      continue;
    }
    const original = originalById.get(event.sourceId);
    const originalEvidence = original ? parsed.get(original.id) : undefined;
    if (
      !original ||
      !originalEvidence ||
      !originalEvidence.lines.length ||
      original.sourceType === "REVERSAL" ||
      original.saleId !== event.saleId ||
      original.outletId !== event.outletId ||
      original.occurredAt > event.occurredAt ||
      evidence.originalEventId !== original.id
    ) {
      block("REVERSAL_ORIGINAL_UNAVAILABLE", event.id);
      continue;
    }
    if (reversedIds.has(original.id)) block("DUPLICATE_SOURCE_REVERSAL", event.id);
    reversedIds.add(original.id);
    // Existing source writers assign exactly one credited line per staff per event.
    const originalLines = new Map(originalEvidence.lines.map((line) => [line.staffId, line]));
    const staffIds = new Set(evidence.lines.map((line) => line.staffId));
    if (
      originalLines.size !== originalEvidence.lines.length ||
      staffIds.size !== evidence.lines.length ||
      evidence.lines.length !== originalEvidence.lines.length
    ) {
      block("REVERSAL_LINES_MISMATCH", event.id);
      continue;
    }
    for (const line of evidence.lines) {
      const prior = originalLines.get(line.staffId);
      if (!prior) {
        block("REVERSAL_LINES_MISMATCH", event.id);
        continue;
      }
      const identity = (row: typeof line) => ({
        staffId: row.staffId,
        outletId: row.outletId,
        commissionType: row.commissionType,
        mode: row.mode,
        productCategory: row.productCategory ?? null,
        fallbackRatePct: row.fallbackRatePct ?? null,
      });
      if (
        payrollInputHash(identity(line)) !== payrollInputHash(identity(prior)) ||
        ticks(line.baseAmount) !== -ticks(prior.baseAmount) ||
        ticks(line.units) !== -ticks(prior.units) ||
        (line.fixedCommission !== undefined &&
          ticks(line.fixedCommission) !== -ticks(prior.fixedCommission!))
      )
        block("REVERSAL_NOT_EXACT", event.id);
    }
  }
  const snapshot = (row: (typeof events)[number]) => ({
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
  const lines = events.flatMap((event) => parsed.get(event.id)?.lines ?? []);
  return structuredClone({
    status: blockers.length ? ("UNAVAILABLE" as const) : ("SOURCE_EVIDENCE_READY" as const),
    earningsActive: false as const,
    periodKey,
    timeZone: raw.timeZone,
    startsAt: from.toISOString(),
    endsAt: to.toISOString(),
    blockers,
    sources: blockers.length
      ? null
      : {
          events: events.map(snapshot),
          lineageEvents: [...lineage].sort((a, b) => a.id.localeCompare(b.id)).map(snapshot),
          lines,
          requiredStaffIds: [...new Set(lines.map((line) => line.staffId))].sort(),
        },
  });
}
