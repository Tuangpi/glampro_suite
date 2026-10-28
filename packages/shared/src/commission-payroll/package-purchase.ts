import { z } from "zod";
import {
  commissionSharesSchema,
  type CommissionShares,
} from "../schemas/commission-attribution.js";
import { allocatePayrollSplit } from "./allocation.js";

const key = z.string().min(1).max(128);
const cents = z.string().regex(/^(0|[1-9]\d{0,13})$/);
const count = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const inputSchema = z.strictObject({
  saleId: key,
  saleLineId: key,
  packageId: key,
  originalCustomerId: key,
  outletId: key.nullable(),
  purchasedAt: z.iso.datetime(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  grantedSessions: count,
  grossCents: cents,
  netCents: cents,
  taxCents: cents,
  sellers: commissionSharesSchema.nullable(),
});

function decimalTicks(ticks: bigint) {
  return `${ticks / 10000n}.${(ticks % 10000n).toString().padStart(4, "0")}`;
}

/** Original contract economics, not collected cash or an instruction to post earnings. */
export function capturePayrollPackagePurchase(value: z.input<typeof inputSchema>) {
  const input = inputSchema.parse(value);
  if (BigInt(input.netCents) + BigInt(input.taxCents) !== BigInt(input.grossCents))
    throw new Error("Package purchase net and GST must equal gross consideration.");
  const ticks = BigInt(input.netCents) * 100n;
  const sessions = BigInt(input.grantedSessions);
  const missingEvidence: ("SALE_CURRENCY" | "SELLERS" | "PACKAGE_COMMISSION_SETTINGS")[] = [
    "PACKAGE_COMMISSION_SETTINGS",
  ];
  if (!input.currency) missingEvidence.push("SALE_CURRENCY");
  if (!input.sellers) missingEvidence.push("SELLERS");
  return {
    ...input,
    sellers: input.sellers
      ? [...input.sellers].sort((a, b) => a.staffId.localeCompare(b.staffId))
      : null,
    version: 1 as const,
    status: "CAPTURED_ECONOMICS_ONLY" as const,
    sessionBaseFloor: decimalTicks(ticks / sessions),
    extraBaseTickSessions: Number(ticks % sessions),
    missingEvidence,
  };
}

export type PayrollPackagePurchase = ReturnType<typeof capturePayrollPackagePurchase>;

/**
 * Use original one-based ordinals, not current catalogue prices or remaining quantity.
 * First remainder ordinals receive one extra 0.0001; the whole grant reconciles exactly.
 * Operational exact-cent valuation remains a separate ledger.
 */
export function payrollPackageSessionBase(
  snapshot: PayrollPackagePurchase,
  first: number,
  last: number,
  performers: CommissionShares,
) {
  const { version, status, sessionBaseFloor, extraBaseTickSessions, missingEvidence, ...input } =
    snapshot;
  const canonical = capturePayrollPackagePurchase(input);
  if (
    version !== canonical.version ||
    status !== canonical.status ||
    sessionBaseFloor !== canonical.sessionBaseFloor ||
    extraBaseTickSessions !== canonical.extraBaseTickSessions ||
    JSON.stringify(missingEvidence) !== JSON.stringify(canonical.missingEvidence)
  )
    throw new Error("Package purchase snapshot economics are inconsistent.");
  count.parse(first);
  count.parse(last);
  if (first > last || last > canonical.grantedSessions)
    throw new Error("Session ordinals must lie within the original grant.");
  const ticks = BigInt(canonical.netCents) * 100n;
  const sessions = BigInt(canonical.grantedSessions);
  const extraLast = BigInt(last) < ticks % sessions ? BigInt(last) : ticks % sessions;
  const extra = extraLast >= BigInt(first) ? extraLast - BigInt(first) + 1n : 0n;
  const baseAmount = decimalTicks((ticks / sessions) * BigInt(last - first + 1) + extra);
  return { baseAmount, bases: allocatePayrollSplit(baseAmount, performers) };
}
