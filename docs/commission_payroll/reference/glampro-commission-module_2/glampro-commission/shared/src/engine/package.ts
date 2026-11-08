/**
 * Package maths shared by POS (frontend) and ledger services (backend).
 *  - session value snapshot (FR-POS-06)
 *  - D-8: only paid-for sessions can be redeemed (FR-POS-08)
 *  - D-7: refund amount; only sale commission on the refunded part is taken back (FR-ADJ-01/02)
 */
import { D, Decimal, ZERO, money2, money4 } from '../money.js';

/** session value = net package price (after discount, excl. GST) ÷ sessions, 4 dp */
export function sessionValue(netPrice: string, sessions: number): string {
  if (sessions <= 0) throw new Error('Package must have at least 1 session');
  return money4(D(netPrice).div(sessions));
}

/** D-8: sessions the customer has paid for = floor(cash collected ÷ session value), capped at total. */
export function paidSessions(cashCollected: string, sessionVal: string, totalSessions: number): number {
  if (D(sessionVal).lte(0)) return totalSessions;
  // small epsilon so 2,000.00 / 1,000.0000 is exactly 2 even with rounding of session value
  const n = D(cashCollected).plus('0.005').div(D(sessionVal)).floor().toNumber();
  return Math.max(0, Math.min(totalSessions, n));
}

export function canRedeem(h: { cashCollected: string; sessionValue: string; sessionsTotal: number; sessionsUsed: number }): { ok: boolean; paid: number; reason?: string } {
  const paid = paidSessions(h.cashCollected, h.sessionValue, h.sessionsTotal);
  if (h.sessionsUsed >= h.sessionsTotal) return { ok: false, paid, reason: 'No sessions left on this package.' };
  if (h.sessionsUsed >= paid) return { ok: false, paid, reason: `Only ${paid} of ${h.sessionsTotal} sessions are paid for. Collect the balance first (or manager PIN override).` };
  return { ok: true, paid };
}

/** minimum deposit check (FR-POS-04) */
export function minDeposit(netPrice: string, minDepositPct: string): string {
  return money2(D(netPrice).mul(D(minDepositPct)).div(100));
}

/** D-7 refund = cash collected − sessions used × session value − admin fee (never below 0). */
export function refundAmount(cashCollected: string, sessionsUsed: number, sessionVal: string, adminFee: string): string {
  const r: Decimal = D(cashCollected).minus(D(sessionVal).mul(sessionsUsed)).minus(D(adminFee));
  return money2(r.lt(0) ? ZERO : r);
}

/** Value package spend base (FR-BAS-07): credit spent × paid ÷ credit. */
export function valuePackageSpendBase(creditSpent: string, paid: string, credit: string): string {
  if (D(credit).lte(0)) return '0.0000';
  return money4(D(creditSpent).mul(D(paid)).div(D(credit)));
}
