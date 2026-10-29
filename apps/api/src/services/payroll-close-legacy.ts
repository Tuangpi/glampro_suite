import { z } from "zod";
import {
  resolvePayrollCloseSources,
  type PayrollCloseSourceRecords,
} from "./payroll-close-sources.js";

const id = z.string().trim().min(1).max(128);
const legacySchema = z.object({
  id,
  tenantId: id,
  userId: id,
  saleId: id.nullable(),
  saleLineId: id.nullable(),
  sourceType: id.nullable(),
  sourceId: id.nullable(),
  ledgerVersion: z.number().int().nonnegative().nullable(),
  amount: z.string().regex(/^-?\d+(?:\.\d{1,10})?$/),
  paidAt: z.date().nullable(),
  reversesId: id.nullable(),
  reconciliationRequired: z.boolean(),
});

export interface PayrollCloseLegacyRecords extends PayrollCloseSourceRecords {
  /** Complete legacy inventory associated with candidate/lineage sales, including
   * unpaid, unreleased, reversed and zero-amount rows. Completeness is the loader's
   * responsibility, not established by an empty array supplied to this function. */
  legacyCommissions: z.input<typeof legacySchema>[];
}

/** Non-activating exclusion boundary. Any overlapping sale fails closed: nullable
 * historical identifiers cannot prove that separate rows represent disjoint work.
 * Even offsetting reversals or unreleased candidates require explicit reconciliation;
 * neither is evidence that the old path can no longer pay. No history is changed. */
export function resolvePayrollCloseLegacyExclusion(raw: PayrollCloseLegacyRecords) {
  const sources = resolvePayrollCloseSources(raw);
  const legacy = z.array(legacySchema).parse(raw.legacyCommissions);
  const tenantId = id.parse(raw.tenantId);
  if (legacy.some((row) => row.tenantId !== tenantId))
    throw new Error("Legacy payroll evidence contains another salon's commission.");
  if (new Set(legacy.map((row) => row.id)).size !== legacy.length)
    throw new Error("Duplicate legacy payroll commission IDs.");

  const saleIds = new Set([...raw.events, ...raw.lineageEvents].map((row) => row.saleId));
  const blockers = legacy
    .filter((row) => row.saleId === null || saleIds.has(row.saleId) || row.reconciliationRequired)
    .map((row) => ({
      code:
        row.saleId === null ? "LEGACY_SOURCE_IDENTITY_UNAVAILABLE" : "LEGACY_PAYOUT_NOT_EXCLUDED",
      commissionId: row.id,
      saleId: row.saleId,
    }))
    .sort((a, b) => a.commissionId.localeCompare(b.commissionId));

  return structuredClone({
    status:
      sources.status === "UNAVAILABLE" || blockers.length
        ? ("UNAVAILABLE" as const)
        : ("LEGACY_EXCLUSION_EVIDENCE_READY" as const),
    earningsActive: false as const,
    periodKey: sources.periodKey,
    timeZone: sources.timeZone,
    startsAt: sources.startsAt,
    endsAt: sources.endsAt,
    sourceBlockers: sources.blockers,
    blockers,
    sources: blockers.length ? null : sources.sources,
    legacyEvidence: [...legacy]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({ ...row, paidAt: row.paidAt?.toISOString() ?? null })),
  });
}
