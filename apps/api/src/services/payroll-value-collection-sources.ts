import { z } from "zod";
import {
  allocatePayrollSplit,
  payrollBaseLineSchema,
  type CommissionShares,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { conflict } from "../lib/http-error.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const sourceEvidence = z.object({
  status: z.literal("CAPTURED"),
  currency: z.string(),
  lines: z.array(payrollBaseLineSchema),
});
const negativeBase = (net: bigint) =>
  `-${net / 100n}.${(net % 100n).toString().padStart(2, "0")}00`;

/** Shared read/write evidence gate; callers still validate purchase, usage and money under their own transaction. */
export async function validateValuePackageCollectionSources(
  tx: Transaction,
  input: {
    saleId: string;
    currency: string;
    outletId: string | null;
    sellers: CommissionShares;
    allocations: { id: string; netCents: bigint }[];
    requireRates: boolean;
  },
) {
  const sources = await tx.payrollSourceEvent.findMany({
    where: { sourceType: "COLLECTION", sourceId: { in: input.allocations.map((row) => row.id) } },
  });
  const originalLines = new Map<string, z.infer<typeof payrollBaseLineSchema>>();
  if (sources.length !== input.allocations.length)
    throw conflict("Original collection source evidence is incomplete.");
  const seen = new Set<string>();
  for (const source of sources) {
    const allocation = input.allocations.find((row) => row.id === source.sourceId);
    const evidence = sourceEvidence.safeParse(source.evidence);
    if (
      !allocation ||
      seen.has(source.sourceId) ||
      source.saleId !== input.saleId ||
      !evidence.success ||
      evidence.data.currency !== input.currency
    )
      throw conflict("Original collection source evidence is inconsistent.");
    seen.add(source.sourceId);
    const expected = allocatePayrollSplit(
      negativeBase(allocation.netCents).slice(1),
      input.sellers,
    );
    if (
      JSON.stringify(evidence.data.lines.map((row) => row.staffId).sort()) !==
        JSON.stringify(input.sellers.map((row) => row.staffId).sort()) ||
      evidence.data.lines.some(
        (row) =>
          row.commissionType !== "VP_SALE" ||
          row.status === "REVERSED" ||
          row.mode !== "FOLLOW_PLAN" ||
          row.outletId !== input.outletId ||
          row.baseAmount !== expected.find((part) => part.staffId === row.staffId)?.amount,
      )
    )
      throw conflict("Original seller source-time evidence is inconsistent.");
    for (const row of evidence.data.lines) {
      const previous = originalLines.get(row.staffId);
      // One aggregate negative base cannot safely represent different historical rates.
      // Never let unspecified query order choose the fallback rate used for a refund.
      if (
        input.requireRates &&
        (row.fallbackRatePct === undefined ||
          (previous?.fallbackRatePct !== undefined &&
            !new Prisma.Decimal(row.fallbackRatePct).equals(previous.fallbackRatePct)))
      )
        throw conflict("Original seller source-time rates require refund reconciliation.");
      if (!previous) originalLines.set(row.staffId, row);
    }
  }
  if (input.requireRates && originalLines.size !== input.sellers.length)
    throw conflict("Original seller source-time evidence is unavailable.");
  return { sources, originalLines };
}
