/**
 * Money helpers. NEVER use JS numbers for money – always Decimal.
 * Storage precision: base lines 4 dp; statement amounts 2 dp, ROUND_HALF_UP (NFR-01).
 */
import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type DecimalLike = Decimal | string | number;

export const D = (v: DecimalLike | null | undefined): Decimal => new Decimal(v ?? 0);
export const ZERO = new Decimal(0);

/** Round to 2 dp half-up and return a fixed string, e.g. "628.99". */
export const money2 = (v: DecimalLike): string => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
/** Round to 4 dp (ledger precision). */
export const money4 = (v: DecimalLike): string => D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

/** Percentage helper: pct("7") => 0.07 */
export const pct = (ratePct: DecimalLike): Decimal => D(ratePct).div(100);

/** Display helper: 8985.5 => "8,985.50" */
export const fmt = (v: DecimalLike): string => {
  const s = money2(v);
  const neg = s.startsWith('-');
  const [i, f] = (neg ? s.slice(1) : s).split('.');
  return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + f;
};

/** Format a rate for display: "7" -> "7%", "2.50" -> "2.5%" */
export const fmtPct = (v: DecimalLike): string => D(v).toDecimalPlaces(4).toString() + '%';

/**
 * Split an amount between staff by split % so that the parts add up EXACTLY to the amount
 * (at 4 dp). The last staff member receives the rounding remainder.
 */
export function allocateBySplit<T extends { splitPct: DecimalLike }>(amount: DecimalLike, splits: T[]): { split: T; amount: string }[] {
  if (splits.length === 0) throw new Error('At least one staff split is required');
  const total = splits.reduce((s, x) => s.plus(D(x.splitPct)), ZERO);
  if (!total.eq(100)) throw new Error(`Split % must total 100 (got ${total.toString()})`);
  const amt = D(amount);
  let used = ZERO;
  return splits.map((split, i) => {
    const part = i === splits.length - 1 ? amt.minus(used) : amt.mul(pct(split.splitPct)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    used = used.plus(part);
    return { split, amount: money4(part) };
  });
}
