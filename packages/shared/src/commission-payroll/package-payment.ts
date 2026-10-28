import { z } from "zod";
import { capturePayrollPackagePurchase, type PayrollPackagePurchase } from "./package-purchase.js";

/** Validate persisted purchase evidence without upgrading missing historic facts. */
export function readPayrollPackagePurchase(value: unknown): PayrollPackagePurchase {
  const object = z.record(z.string(), z.unknown()).parse(value);
  const { version, status, sessionBaseFloor, extraBaseTickSessions, missingEvidence, ...input } =
    object;
  const canonical = capturePayrollPackagePurchase(
    input as Parameters<typeof capturePayrollPackagePurchase>[0],
  );
  if (
    version !== canonical.version ||
    status !== canonical.status ||
    sessionBaseFloor !== canonical.sessionBaseFloor ||
    extraBaseTickSessions !== canonical.extraBaseTickSessions ||
    JSON.stringify(missingEvidence) !== JSON.stringify(canonical.missingEvidence)
  )
    throw new Error("Package purchase snapshot economics are inconsistent.");
  return canonical;
}

/** Compare against the original unrounded rational session value, not its display floor. */
export function paidPayrollPackageSessions(
  snapshot: PayrollPackagePurchase,
  collectedNetCents: bigint,
) {
  const purchase = readPayrollPackagePurchase(snapshot);
  if (collectedNetCents < 0n || collectedNetCents > BigInt(purchase.netCents))
    throw new Error("Collected package net must lie within the original consideration.");
  if (BigInt(purchase.netCents) === 0n) return purchase.grantedSessions;
  return Number((collectedNetCents * BigInt(purchase.grantedSessions)) / BigInt(purchase.netCents));
}

/** Minimum deposit rounds UP to a cent. Never admit a deposit below the exact threshold. */
export function minimumPayrollPackageDeposit(grossCents: bigint, pct: string) {
  if (!/^(0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(pct)) throw new Error("Invalid deposit percentage.");
  const [whole, fraction = ""] = pct.split(".");
  const bps = BigInt(whole! + fraction.padEnd(2, "0"));
  if (bps > 10000n || grossCents < 0n) throw new Error("Invalid deposit threshold.");
  return (grossCents * bps + 9999n) / 10000n;
}
