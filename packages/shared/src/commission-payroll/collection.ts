import { z } from "zod";
import { commissionSharesSchema } from "../schemas/commission-attribution.js";
import { allocatePayrollSplit } from "./allocation.js";

const key = z.string().min(1).max(128);
const cents = z.string().regex(/^(0|[1-9]\d{0,13})$/);
export const payrollPackageCollectionInputSchema = z.strictObject({
  collectionId: key,
  saleId: key,
  saleLineId: key,
  itemId: key,
  outletId: key.nullable(),
  sourceType: z.enum(["SALE_PAYMENT", "OUTSTANDING_PAYMENT"]),
  sourceId: key,
  occurredAt: z.iso.datetime(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  confirmedCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  grossCents: cents,
  netCents: cents,
  taxCents: cents,
  sellers: commissionSharesSchema.nullable(),
});

/**
 * Source-linked, rate-free package collection facts, not engine-ready/payable lines.
 * Package mode/fixed awards, unit economics and fallback evidence remain separate gates.
 * Unknown attribution/currency must never be upgraded from a current catalogue or cashier.
 */
export function capturePayrollPackageCollection(
  value: z.input<typeof payrollPackageCollectionInputSchema>,
) {
  const input = payrollPackageCollectionInputSchema.parse(value);
  if (BigInt(input.netCents) + BigInt(input.taxCents) !== BigInt(input.grossCents))
    throw new Error("Package collection net and GST must equal gross consideration.");
  if (input.confirmedCurrency !== null && input.confirmedCurrency !== input.currency)
    throw new Error("Package collection currency differs from the source sale.");
  const missingEvidence: ("SALE_CURRENCY" | "SELLERS")[] = [];
  if (input.confirmedCurrency === null) missingEvidence.push("SALE_CURRENCY");
  if (input.sellers === null) missingEvidence.push("SELLERS");
  const net = BigInt(input.netCents);
  const totalBase = `${net / 100n}.${(net % 100n).toString().padStart(2, "0")}00`;
  return {
    version: 1 as const,
    status: missingEvidence.length ? ("UNAVAILABLE" as const) : ("CAPTURED_BASE_ONLY" as const),
    commissionType: "PKG_SALE" as const,
    collectionId: input.collectionId,
    saleId: input.saleId,
    saleLineId: input.saleLineId,
    itemId: input.itemId,
    outletId: input.outletId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    occurredAt: input.occurredAt,
    currency: input.confirmedCurrency,
    grossCents: input.grossCents,
    netCents: input.netCents,
    taxCents: input.taxCents,
    missingEvidence,
    bases:
      missingEvidence.length === 0 && input.sellers
        ? allocatePayrollSplit(totalBase, input.sellers).map(({ staffId, share, amount }) => ({
            staffId,
            share,
            baseAmount: amount,
          }))
        : null,
  };
}
