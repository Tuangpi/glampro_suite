import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PACKAGE_VALUATION_POLICY_VERSION,
  normalizeSessionRanges,
  packageMoneyToCents,
  packagePurchaseValue,
  packageRangeValue,
  restorePackageSessions,
  takePackageSessions,
} from "./package-valuation.js";

describe("package valuation policy version 1", () => {
  it("uses discounted contracted consideration and stored tax, not catalogue price or cash collected", () => {
    assert.equal(PACKAGE_VALUATION_POLICY_VERSION, 1);
    const purchase = packagePurchaseValue("540.00", "0.00", "0.00");
    assert.deepEqual(purchase, { netCents: 54000n, taxCents: 0n, grossCents: 54000n });
    const { remaining } = takePackageSessions(6, [{ first: 1, last: 6 }], 2);
    assert.equal(packageRangeValue(purchase, 6, remaining).netCents, 36000n);
    assert.deepEqual(packagePurchaseValue("109.00", "10.90", "8.10"), {
      netCents: 9000n,
      taxCents: 810n,
      grossCents: 9810n,
    });
  });

  it("distinguishes a known zero-priced grant from missing evidence", () => {
    const purchase = packagePurchaseValue("10.00", "10.00", "0.00");
    assert.deepEqual(packageRangeValue(purchase, 3, [{ first: 1, last: 3 }]), {
      quantity: 3,
      netCents: 0n,
      taxCents: 0n,
      grossCents: 0n,
    });
    assert.throws(() => packagePurchaseValue("", "0", "0"), RangeError);
  });

  it("converts exact decimal strings without floating-point rounding", () => {
    for (const [value, expected] of [
      ["0", 0n],
      ["1.2", 120n],
      ["0.01", 1n],
      ["9999999999.99", 999999999999n],
    ] as const) {
      assert.equal(packageMoneyToCents(value), expected);
    }
    for (const value of [
      "-1",
      "1.001",
      " 1",
      "1 ",
      "1e2",
      "NaN",
      "Infinity",
      ".50",
      "1.",
      "1,000.00",
      "1\n",
      "1\r\n",
    ]) {
      assert.throws(() => packageMoneyToCents(value), RangeError, value);
    }
    assert.throws(() => packagePurchaseValue("1", "2", "0"), RangeError);
    assert.throws(() => packagePurchaseValue("1", "0", "1.01"), RangeError);
  });

  it("restores exactly 33.34 after an out-of-order reversal, leaving 66.67", () => {
    const purchase = packagePurchaseValue("100", "0", "0");
    const first = takePackageSessions(3, [{ first: 1, last: 3 }], 1);
    const second = takePackageSessions(3, first.remaining, 1);
    assert.equal(packageRangeValue(purchase, 3, first.allocated).netCents, 3334n);
    assert.equal(packageRangeValue(purchase, 3, second.allocated).netCents, 3333n);
    const restored = restorePackageSessions(3, second.remaining, first.allocated);
    assert.deepEqual(restored, [
      { first: 1, last: 1 },
      { first: 3, last: 3 },
    ]);
    assert.equal(packageRangeValue(purchase, 3, restored).netCents, 6667n);
    assert.deepEqual(takePackageSessions(3, restored, 1).allocated, first.allocated);
    assert.throws(() => restorePackageSessions(3, restored, first.allocated), RangeError);
  });

  it("allocates tax independently and derives gross from net plus tax on each ordinal", () => {
    const purchase = packagePurchaseValue("0.03", "0", "0.01");
    const values = [1, 2, 3].map((ordinal) =>
      packageRangeValue(purchase, 3, [{ first: ordinal, last: ordinal }]),
    );
    assert.deepEqual(
      values.map((value) => value.grossCents),
      [2n, 1n, 0n],
    );
    assert.deepEqual(
      values.map((value) => value.taxCents),
      [1n, 0n, 0n],
    );
    for (const value of values) assert.equal(value.grossCents, value.netCents + value.taxCents);
    const taxed = packagePurchaseValue("109", "0", "9");
    assert.deepEqual(packageRangeValue(taxed, 5, [{ first: 3, last: 5 }]), {
      quantity: 3,
      netCents: 6000n,
      taxCents: 540n,
      grossCents: 6540n,
    });
  });

  it("canonicalizes unordered adjacent ranges without mutating original evidence", () => {
    const input = Object.freeze([
      Object.freeze({ first: 3, last: 4 }),
      Object.freeze({ first: 1, last: 2 }),
    ]);
    assert.deepEqual(normalizeSessionRanges(4, input), [{ first: 1, last: 4 }]);
    assert.equal(input[0]?.first, 3);
    assert.deepEqual(takePackageSessions(4, input, 3), {
      allocated: [{ first: 1, last: 3 }],
      remaining: [{ first: 4, last: 4 }],
    });
  });

  it("rejects corrupt ranges, invalid counts and non-reconciling purchase evidence", () => {
    for (const sessions of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => normalizeSessionRanges(sessions, []), RangeError);
    }
    for (const range of [
      { first: 0, last: 1 },
      { first: 2, last: 1 },
      { first: 1, last: 4 },
      { first: 1.5, last: 2 },
      { first: 1, last: NaN },
    ]) {
      assert.throws(() => normalizeSessionRanges(3, [range]), RangeError);
    }
    assert.throws(
      () =>
        normalizeSessionRanges(3, [
          { first: 1, last: 2 },
          { first: 2, last: 3 },
        ]),
      RangeError,
    );
    assert.throws(() => takePackageSessions(3, [{ first: 1, last: 1 }], 2), RangeError);
    for (const quantity of [0, -1, 1.5, 4, NaN]) {
      assert.throws(() => takePackageSessions(3, [{ first: 1, last: 3 }], quantity), RangeError);
    }
    assert.throws(() => restorePackageSessions(3, [], []), RangeError);
    for (const purchase of [
      { netCents: -1n, taxCents: 1n, grossCents: 0n },
      { netCents: 1n, taxCents: -1n, grossCents: 0n },
      { netCents: 1n, taxCents: 1n, grossCents: 1n },
    ])
      assert.throws(() => packageRangeValue(purchase, 3, []), RangeError);
  });

  it("conserves every cent across grants, draws and exact restorations for many divisors", () => {
    for (let sessions = 1; sessions <= 25; sessions++) {
      for (let cents = 0n; cents <= 50n; cents++) {
        const purchase = { netCents: cents, taxCents: cents / 3n, grossCents: cents + cents / 3n };
        let available = [{ first: 1, last: sessions }];
        const allocations = [];
        let releasedNet = 0n;
        let releasedTax = 0n;
        for (let i = 0; i < sessions; i++) {
          const draw = takePackageSessions(sessions, available, 1);
          const value = packageRangeValue(purchase, sessions, draw.allocated);
          allocations.push(draw.allocated);
          available = draw.remaining;
          releasedNet += value.netCents;
          releasedTax += value.taxCents;
          const remaining = packageRangeValue(purchase, sessions, available);
          assert.equal(releasedNet + remaining.netCents, purchase.netCents);
          assert.equal(releasedTax + remaining.taxCents, purchase.taxCents);
          assert.equal(remaining.quantity, sessions - i - 1);
        }
        for (const allocation of allocations.reverse()) {
          available = restorePackageSessions(sessions, available, allocation);
        }
        assert.deepEqual(available, [{ first: 1, last: sessions }]);
        assert.equal(
          packageRangeValue(purchase, sessions, available).grossCents,
          purchase.grossCents,
        );
      }
    }
  });

  it("supports large grants and amounts without expanding ordinals or losing integer precision", () => {
    const sessions = Number.MAX_SAFE_INTEGER;
    const purchase = {
      netCents: 9007199254740993123n,
      taxCents: 7n,
      grossCents: 9007199254740993130n,
    };
    const all = [{ first: 1, last: sessions }];
    assert.deepEqual(packageRangeValue(purchase, sessions, all), {
      ...purchase,
      quantity: sessions,
    });
    const draw = takePackageSessions(sessions, all, 1);
    assert.equal(draw.remaining.length, 1);
    assert.deepEqual(restorePackageSessions(sessions, draw.remaining, draw.allocated), all);
    const fragmented = [
      { first: 1, last: 3 },
      { first: sessions - 2, last: sessions },
    ];
    assert.equal(packageRangeValue(purchase, sessions, fragmented).quantity, 6);
  });
});
