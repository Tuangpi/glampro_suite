import { conflict } from "./http-error.js";

/** Snapshot a catalogue rule at completed purchase, never at hold/first use. */
export function packageExpiry(validityDays: number | null | undefined, soldAt: Date): Date | null {
  if (validityDays == null) return null;
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 36_500) {
    throw new RangeError("Package validity must be 1–36500 whole days or null.");
  }
  return new Date(soldAt.getTime() + validityDays * 86_400_000);
}

/** Expiry is exclusive: a holding cannot be spent at the expiry instant. */
export function assertHoldingLive(expiresAt: Date | null, name: string, at: Date): void {
  if (expiresAt !== null && expiresAt.getTime() <= at.getTime()) {
    throw conflict(
      `${name} expired on ${expiresAt.toISOString().slice(0, 10)}, so it cannot pay for this sale.`,
      "HOLDING_EXPIRED",
    );
  }
}
