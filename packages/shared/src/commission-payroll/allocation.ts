import {
  commissionSharesSchema,
  type CommissionShares,
} from "../schemas/commission-attribution.js";
import { add, cmp, div, exact, fixed, mul, neg, ZERO } from "./decimal.js";
import { payrollDecimalSchema } from "./contracts.js";

/** Stable staff-ID order gets residual 1/10000 units. Negative allocations exactly reverse positives. */
export function allocatePayrollSplit(amount: string, shares: CommissionShares) {
  payrollDecimalSchema.parse(amount);
  const parsed = commissionSharesSchema
    .parse(shares)
    .sort((a, b) => a.staffId.localeCompare(b.staffId));
  const total = exact(amount);
  const ticks = (total.n * 10000n) / total.d;
  if (ticks * total.d !== total.n * 10000n)
    throw new Error("Split amount exceeds four-decimal precision.");
  const sign = ticks < 0n ? -1n : 1n;
  const absolute = ticks < 0n ? -ticks : ticks;
  const parts = parsed.map((row) => (absolute * BigInt(row.share)) / 10000n);
  let residual = absolute - parts.reduce((sum, part) => sum + part, 0n);
  for (let index = 0; residual > 0n; index++, residual--) parts[index] += 1n;
  return parsed.map((row, index) => ({
    ...row,
    amount: fixed({ n: parts[index] * sign, d: 10000n }, 4),
  }));
}

/** Difference of cumulative rounded spend values prevents repeated-spend residual drift. */
export function payrollValuePackageSpend(
  paid: string,
  credit: string,
  spentBefore: string,
  spentNow: string,
): string {
  [paid, credit, spentBefore, spentNow].forEach((value) => payrollDecimalSchema.parse(value));
  const p = exact(paid),
    c = exact(credit),
    before = exact(spentBefore),
    now = exact(spentNow);
  if (
    cmp(p, ZERO) < 0 ||
    cmp(c, ZERO) <= 0 ||
    cmp(before, ZERO) < 0 ||
    cmp(now, ZERO) < 0 ||
    cmp(add(before, now), c) > 0
  )
    throw new Error("Invalid value-package paid/credit/spend amounts.");
  const cumulative = (spent: typeof p) => exact(fixed(div(mul(spent, p), c), 4));
  return fixed(add(cumulative(add(before, now)), neg(cumulative(before))), 4);
}
