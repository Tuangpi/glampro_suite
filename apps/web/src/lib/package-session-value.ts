/**
 * What one session of a package is worth — the base a redemption's commission is
 * calculated on — worked out the way the server will value it.
 *
 * Payroll does not use the catalogue price. When a package is sold,
 * `capturePayrollPackagePurchase` (`packages/shared/src/commission-payroll/package-purchase.ts:36-56`)
 * takes the **net** consideration — GST backed out of the line as
 * `total × rate / (100 + rate)` rounded half-up to the cent (`gstForLine`,
 * `apps/api/src/services/sale.service.ts:488-491`) — multiplies it into
 * ten-thousandths of a dollar and spreads it over the granted sessions: every
 * session gets the floor, and the leftover ticks stay with the **first** sessions
 * of the grant (`payrollPackageSessionBase`, `:66-93`). That way a grant of six
 * sessions reconciles to the cent instead of leaving a remainder nobody owns.
 *
 * This mirrors that arithmetic in integers, because a preview that disagrees with
 * the stored figure by a rounding step is worse than no preview. It is still a
 * **preview**: the figure the server stores comes from the sale's own line (a
 * member or non-member price after any voucher), and the salon's GST switch
 * decides whether a tax component is backed out at all.
 */
import { GST_INCLUSIVE_DIVISOR_STRING, GST_RATE_PERCENT } from "@glampro_suite/shared";

/** One price's worth of the preview. */
export interface PackageSessionValue {
  /** The price as typed, in whole cents. */
  priceCents: number;
  /** GST backed out of the price — zero when the salon is not GST-registered. */
  taxCents: number;
  /** Price less GST: what payroll divides by the sessions. */
  netCents: number;
  /** `net ÷ sessions`, floored to four decimals — the figure payroll stores. */
  sessionValue: string;
  /** How many of the earliest sessions carry one extra S$0.0001. */
  residualSessions: number;
}

/**
 * The session value of one price, or `null` when there is nothing to work out yet
 * (a blank or unreadable price, or no sessions granted).
 *
 * A zero price is **not** `null`: it is a real answer, "this session is worth
 * nothing", and the caller says so rather than staying silent.
 */
export function packageSessionValue(
  price: string,
  sessions: number,
  gstEnabled: boolean,
): PackageSessionValue | null {
  const amount = Number(price);
  if (price.trim() === "" || !Number.isFinite(amount)) return null;
  if (!Number.isSafeInteger(sessions) || sessions < 1) return null;

  // The form clamps at zero; a typed `-5` would otherwise preview a negative value.
  const priceCents = Math.max(0, Math.round(amount * 100));
  const taxCents = gstEnabled ? gstComponent(priceCents) : 0;
  const netCents = priceCents - taxCents;
  const ticks = BigInt(netCents) * 100n;
  const count = BigInt(sessions);
  const floor = ticks / count;

  return {
    priceCents,
    taxCents,
    netCents,
    sessionValue: `${floor / 10000n}.${(floor % 10000n).toString().padStart(4, "0")}`,
    residualSessions: Number(ticks % count),
  };
}

/** `total × rate / (100 + rate)`, rounded half-up to the cent — `gstForLine`. */
function gstComponent(totalCents: number): number {
  const divisor = BigInt(GST_INCLUSIVE_DIVISOR_STRING);
  const numerator = BigInt(totalCents) * BigInt(GST_RATE_PERCENT);
  const quotient = numerator / divisor;
  // Integer division truncates, so the half-cent that decides the rounding is
  // compared rather than added: an odd divisor has no exact half to add.
  return Number((numerator % divisor) * 2n >= divisor ? quotient + 1n : quotient);
}
