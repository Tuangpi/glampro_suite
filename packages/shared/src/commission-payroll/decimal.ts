/** Exact rational arithmetic. No floating point or intermediate monetary rounding. */
export interface Exact {
  n: bigint;
  d: bigint;
}

export const ZERO: Exact = { n: 0n, d: 1n };

export function exact(value: string): Exact {
  if (typeof value !== "string" || !/^-?(0|[1-9]\d{0,23})(?:\.\d{1,10})?$/.test(value))
    throw new Error(
      "Expected a bounded exact decimal string (24 integer and 10 fraction digits maximum).",
    );
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return { n: BigInt(whole + fraction) * (negative ? -1n : 1n), d: 10n ** BigInt(fraction.length) };
}

export function add(a: Exact, b: Exact): Exact {
  // All decimals and percentages have power-of-ten denominators. Reduce after
  // every operation so large line counts cannot grow denominators exponentially.
  return reduce({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
}

export function neg(a: Exact): Exact {
  return { n: -a.n, d: a.d };
}

export function mul(a: Exact, b: Exact): Exact {
  return reduce({ n: a.n * b.n, d: a.d * b.d });
}

export function div(a: Exact, b: Exact): Exact {
  if (b.n === 0n) throw new Error("Cannot divide by zero.");
  return reduce({ n: a.n * b.d, d: a.d * b.n });
}

function reduce(value: Exact): Exact {
  let a = value.n < 0n ? -value.n : value.n;
  let b = value.d < 0n ? -value.d : value.d;
  while (b !== 0n) [a, b] = [b, a % b];
  const sign = value.d < 0n ? -1n : 1n;
  return { n: (value.n / a) * sign, d: (value.d / a) * sign };
}

export function cmp(a: Exact, b: Exact): number {
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

export function min(a: Exact, b: Exact): Exact {
  return cmp(a, b) <= 0 ? a : b;
}

export function percent(value: Exact, rate: string): Exact {
  return div(mul(value, exact(rate)), exact("100"));
}

/** Half-up: ties round away from zero, including negative adjustments. */
export function fixed(value: Exact, places: 2 | 4 | 10): string {
  const scale = 10n ** BigInt(places);
  const absolute = value.n < 0n ? -value.n : value.n;
  const scaled = absolute * scale;
  const units = scaled / value.d + ((scaled % value.d) * 2n >= value.d ? 1n : 0n);
  return `${value.n < 0n && units !== 0n ? "-" : ""}${units / scale}.${(units % scale).toString().padStart(places, "0")}`;
}

export function sum(values: readonly Exact[]): Exact {
  return values.reduce(add, ZERO);
}
