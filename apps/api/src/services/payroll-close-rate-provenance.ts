import { z } from "zod";
import { payrollBaseLineSchema } from "@glampro_suite/shared";
import { conflict } from "../lib/http-error.js";
import { resolveCommission, type RuleCandidate } from "./commission-rules.js";

const id = z.string().min(1).max(128);
const rate = z
  .string()
  .regex(/^(?:\d{1,3})(?:\.\d{1,2})?$/)
  .refine((value) => Number(value) <= 100);
const schema = z.object({
  itemId: id,
  lines: z.array(payrollBaseLineSchema),
  rateProvenance: z.object({
    version: z.literal(1),
    rateAt: z.iso.datetime(),
    itemId: id,
    category: id.nullable(),
    selections: z.array(
      z.object({
        staffId: id,
        legacyServiceRate: rate,
        selection: z.object({ rate, source: id, ruleId: id.nullable() }),
      }),
    ),
  }),
});

/** Replay ordinary source decisions against the independent append-only rule
 * inventory available at capture. Legacy staff rate and catalogue classification
 * are frozen by the operational writer, never reconstructed from today's rows.
 * This is not a migration/backfill or authorization of supplied source uploads. */
export function verifyOrdinaryPayrollRateProvenance(
  evidence: unknown,
  line: { itemId: string; itemType: string; foc?: boolean },
  occurredAt: Date,
  capturedAt: Date,
  rules: (RuleCandidate & { tenantId: string })[],
  tenantId: string,
) {
  const parsed = schema.safeParse(evidence);
  const fail = (): never => {
    throw conflict(
      "Authoritative payroll inputs unavailable: ORDINARY_RATE_PROVENANCE_UNCONFIRMED.",
    );
  };
  if (!parsed.success || capturedAt < occurredAt) return fail();
  const { rateProvenance: provenance, lines } = parsed.data;
  if (
    parsed.data.itemId !== line.itemId ||
    provenance.itemId !== line.itemId ||
    provenance.rateAt !== occurredAt.toISOString() ||
    provenance.selections.length !== lines.length ||
    new Set(provenance.selections.map((row) => row.staffId)).size !==
      provenance.selections.length ||
    rules.some((rule) => rule.tenantId !== tenantId)
  )
    return fail();
  const historical = rules.filter(
    (rule) => rule.createdAt <= capturedAt && rule.effectiveAt <= occurredAt,
  );
  for (const part of lines) {
    const recorded = provenance.selections.find((row) => row.staffId === part.staffId);
    if (!recorded || (part.productCategory ?? null) !== provenance.category) return fail();
    const resolved = resolveCommission(
      historical,
      {
        staffId: part.staffId,
        itemId: line.itemId,
        itemKind: line.foc ? "FOC" : line.itemType === "PRODUCT" ? "PRODUCT" : "SERVICE",
        departmentId: provenance.category,
        legacyServiceRate: recorded.legacyServiceRate,
      },
      occurredAt,
    );
    if (
      resolved.rate !== recorded.selection.rate ||
      resolved.source !== recorded.selection.source ||
      resolved.ruleId !== recorded.selection.ruleId ||
      part.fallbackRatePct !== resolved.rate
    )
      return fail();
  }
  return structuredClone(provenance);
}
