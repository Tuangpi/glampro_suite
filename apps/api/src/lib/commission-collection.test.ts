import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocateCollection,
  collectionComponents,
  collectionDelta,
  collectionRefundDelta,
  commissionClawbackUnits,
  partitionServiceCollection,
  sessionCollectionEligibility,
  storedCreditSpendDelta,
} from "./commission-collection.js";
import {
  packagePurchaseValue,
  packageRangeValue,
  restorePackageSessions,
  takePackageSessions,
} from "./package-valuation.js";

test("discounted stored-tax collections telescope to original value, cent by cent", () => {
  for (let gross = 0n; gross <= 40n; gross++) {
    for (let tax = 0n; tax <= gross; tax++) {
      const purchase = { netCents: gross - tax, taxCents: tax, grossCents: gross };
      let netTotal = 0n;
      let taxTotal = 0n;
      for (let collected = 1n; collected <= gross; collected++) {
        const delta = collectionDelta(purchase, collected - 1n, collected);
        assert.equal(delta.netCents + delta.taxCents, 1n);
        assert.ok(delta.netCents >= 0n && delta.taxCents >= 0n);
        netTotal += delta.netCents;
        taxTotal += delta.taxCents;
      }
      assert.equal(netTotal, purchase.netCents);
      assert.equal(taxTotal, tax);
    }
  }
  const discounted = packagePurchaseValue("109.00", "10.90", "8.10");
  assert.deepEqual(collectionComponents(discounted, 4905n), {
    grossCents: 4905n,
    netCents: 4500n,
    taxCents: 405n,
  });
});

test("mixed sale requires exact explicit allocations without mutating line evidence", () => {
  const lines = [
    {
      lineId: "package-a",
      purchase: packagePurchaseValue("109", "0", "9"),
      collectedGrossCents: 0n,
    },
    {
      lineId: "package-b",
      purchase: packagePurchaseValue("200", "0", "0"),
      collectedGrossCents: 5000n,
    },
    { lineId: "service", purchase: packagePurchaseValue("10", "0", "0"), collectedGrossCents: 0n },
  ];
  const original = structuredClone(lines);
  const result = allocateCollection(8450n, lines, [
    { lineId: "package-a", grossCents: 5450n },
    { lineId: "package-b", grossCents: 2000n },
    { lineId: "service", grossCents: 1000n },
  ]);
  assert.deepEqual(
    result.map((row) => row.netCents),
    [5000n, 2000n, 1000n],
  );
  assert.deepEqual(lines, original);
  for (const allocations of [
    [],
    [{ lineId: "package-a", grossCents: 8449n }],
    [{ lineId: "package-a", grossCents: 8451n }],
    [{ lineId: "foreign-line", grossCents: 8450n }],
    [{ lineId: "service", grossCents: 8450n }],
    [{ lineId: "package-a", grossCents: 0n }],
    [{ lineId: "package-a", grossCents: -1n }],
    [
      { lineId: "package-a", grossCents: 4000n },
      { lineId: "package-a", grossCents: 4450n },
    ],
  ])
    assert.throws(() => allocateCollection(8450n, lines, allocations), RangeError);
  assert.throws(() => allocateCollection(0n, [lines[0]!, lines[0]!], []), RangeError);
  assert.deepEqual(allocateCollection(0n, lines, []), []);
  assert.deepEqual(lines, original);
});

test("subsequent deposits use only new cumulative net and tax", () => {
  const purchase = packagePurchaseValue("0.03", "0", "0.01");
  assert.deepEqual(collectionDelta(purchase, 0n, 1n), {
    netCents: 1n,
    taxCents: 0n,
    grossCents: 1n,
  });
  assert.deepEqual(collectionDelta(purchase, 1n, 2n), {
    netCents: 0n,
    taxCents: 1n,
    grossCents: 1n,
  });
  assert.deepEqual(collectionDelta(purchase, 2n, 3n), {
    netCents: 1n,
    taxCents: 0n,
    grossCents: 1n,
  });
  assert.deepEqual(collectionDelta(purchase, 3n, 0n), {
    netCents: -2n,
    taxCents: -1n,
    grossCents: -3n,
  });
});

test("source-lot refunds and ten-decimal clawbacks consume the exact final residual", () => {
  const lot = { netCents: 2n, taxCents: 1n, grossCents: 3n };
  const refunds = [0n, 1n, 2n].map((before) => collectionRefundDelta(lot, before, before + 1n));
  assert.equal(
    refunds.reduce((sum, row) => sum + row.netCents, 0n),
    -2n,
  );
  assert.equal(
    refunds.reduce((sum, row) => sum + row.taxCents, 0n),
    -1n,
  );
  assert.equal(commissionClawbackUnits(5n, 2n, 0n, 1n), -3n);
  assert.equal(commissionClawbackUnits(5n, 2n, 1n, 2n), -2n);
  assert.equal(commissionClawbackUnits(5n, 2n, 2n, 2n), 0n);
  assert.equal(commissionClawbackUnits(0n, 0n, 0n, 0n), 0n);
  assert.throws(() => collectionRefundDelta(lot, 2n, 1n), RangeError);
  assert.throws(() => collectionRefundDelta(lot, 0n, 4n), RangeError);
  assert.throws(() => commissionClawbackUnits(1n, 0n, 0n, 0n), RangeError);
  assert.throws(() => commissionClawbackUnits(5n, 2n, 0n, 3n), RangeError);
  assert.throws(() => commissionClawbackUnits(5n, 2n, 2n, 1n), RangeError);
});

test("eligibility uses original exact-cent prefix, not a rounded average", () => {
  const purchase = packagePurchaseValue("100", "0", "0");
  const selected = [{ first: 1, last: 1 }];
  const check = (collectedNetCents: bigint, ordinals = selected) =>
    sessionCollectionEligibility({ status: "KNOWN", purchase, collectedNetCents }, 3, ordinals);
  assert.deepEqual(check(3333n), { status: "INSUFFICIENT", coveredPrefix: 0 });
  assert.deepEqual(check(3334n), { status: "COVERED", coveredPrefix: 1 });
  assert.deepEqual(check(6666n, [{ first: 2, last: 2 }]), {
    status: "INSUFFICIENT",
    coveredPrefix: 1,
  });
  assert.deepEqual(check(6667n, [{ first: 2, last: 2 }]), { status: "COVERED", coveredPrefix: 2 });
  assert.deepEqual(check(10000n, [{ first: 3, last: 3 }]), { status: "COVERED", coveredPrefix: 3 });
  // A refund reduces future eligibility without rewriting original session values.
  assert.equal(check(0n, [{ first: 3, last: 3 }]).status, "INSUFFICIENT");
  assert.deepEqual(purchase, packagePurchaseValue("100", "0", "0"));
});

test("restored out-of-order ordinals recheck coverage against the original purchase", () => {
  const purchase = packagePurchaseValue("100", "0", "0");
  const first = takePackageSessions(3, [{ first: 1, last: 3 }], 1);
  const second = takePackageSessions(3, first.remaining, 1);
  const restored = restorePackageSessions(3, second.remaining, first.allocated);
  assert.equal(packageRangeValue(purchase, 3, restored).netCents, 6667n);
  const evidence = { status: "KNOWN", purchase, collectedNetCents: 3334n } as const;
  assert.equal(sessionCollectionEligibility(evidence, 3, first.allocated).status, "COVERED");
  assert.equal(sessionCollectionEligibility(evidence, 3, second.allocated).status, "INSUFFICIENT");
});

test("known zero, free suffix ordinals and legacy UNKNOWN remain distinct", () => {
  const zero = packagePurchaseValue("0", "0", "0");
  assert.deepEqual(
    sessionCollectionEligibility({ status: "KNOWN", purchase: zero, collectedNetCents: 0n }, 3, [
      { first: 3, last: 3 },
    ]),
    { status: "COVERED", coveredPrefix: 3 },
  );
  assert.deepEqual(
    sessionCollectionEligibility({ status: "UNKNOWN" }, 3, [{ first: 3, last: 3 }]),
    { status: "UNKNOWN", coveredPrefix: null },
  );
  const purchase = packagePurchaseValue("0.01", "0", "0");
  assert.deepEqual(
    sessionCollectionEligibility({ status: "KNOWN", purchase, collectedNetCents: 0n }, 3, [
      { first: 3, last: 3 },
    ]),
    { status: "INSUFFICIENT", coveredPrefix: 0 },
  );
  assert.deepEqual(
    sessionCollectionEligibility({ status: "KNOWN", purchase, collectedNetCents: 1n }, 3, [
      { first: 3, last: 3 },
    ]),
    { status: "COVERED", coveredPrefix: 3 },
  );
  assert.throws(() => sessionCollectionEligibility({ status: "UNKNOWN" }, 3, []), RangeError);
  assert.throws(
    () => sessionCollectionEligibility({ status: "UNKNOWN" }, 3, [{ first: 4, last: 4 }]),
    RangeError,
  );
});

test("credit bonus ratios telescope and exact restoration cancels original spend", () => {
  const deltas = [0n, 1n, 2n].map((before) => storedCreditSpendDelta(2n, 3n, before, before + 1n));
  assert.deepEqual(deltas, [1n, 0n, 1n]);
  assert.equal(
    deltas.reduce((sum, value) => sum + value, 0n),
    2n,
  );
  assert.equal(storedCreditSpendDelta(2n, 3n, 3n, 2n), -deltas[2]!);
  assert.equal(storedCreditSpendDelta(10000n, 12000n, 0n, 6000n), 5000n);
  assert.equal(storedCreditSpendDelta(0n, 100n, 0n, 100n), 0n);
  assert.throws(() => storedCreditSpendDelta(0n, 0n, 0n, 0n), RangeError);
  assert.throws(() => storedCreditSpendDelta(2n, 3n, 0n, 4n), RangeError);
});

test("mixed service funding partitions rather than doubles ordinary service basis", () => {
  const purchase = packagePurchaseValue("109", "0", "9");
  assert.deepEqual(partitionServiceCollection(purchase, 5450n, 5450n), {
    ordinaryNetCents: 5000n,
    creditFundedNetCents: 5000n,
  });
  assert.equal(storedCreditSpendDelta(4000n, 5450n, 0n, 5450n), 4000n);
  assert.deepEqual(partitionServiceCollection(purchase, 0n, 10900n), {
    ordinaryNetCents: 0n,
    creditFundedNetCents: 10000n,
  });
  assert.deepEqual(partitionServiceCollection(purchase, 10900n, 0n), {
    ordinaryNetCents: 10000n,
    creditFundedNetCents: 0n,
  });
  assert.throws(() => partitionServiceCollection(purchase, 0n, 1n), RangeError);
  assert.throws(() => partitionServiceCollection(purchase, -1n, 10901n), RangeError);
});

test("invalid evidence fails closed; large values never pass through Number", () => {
  const purchase = packagePurchaseValue("9999999999.99", "0", "825688073.39");
  assert.deepEqual(collectionComponents(purchase, purchase.grossCents), purchase);
  assert.throws(() => collectionComponents(purchase, -1n), RangeError);
  assert.throws(() => collectionComponents(purchase, purchase.grossCents + 1n), RangeError);
  assert.throws(
    () => collectionComponents({ netCents: 1n, taxCents: -1n, grossCents: 0n }, 0n),
    RangeError,
  );
  assert.throws(
    () => collectionComponents({ netCents: 1n, taxCents: 1n, grossCents: 1n }, 0n),
    RangeError,
  );
  assert.throws(
    () =>
      sessionCollectionEligibility(
        { status: "KNOWN", purchase, collectedNetCents: purchase.netCents + 1n },
        3,
        [{ first: 1, last: 1 }],
      ),
    RangeError,
  );
  assert.deepEqual(collectionComponents(packagePurchaseValue("0", "0", "0"), 0n), {
    netCents: 0n,
    taxCents: 0n,
    grossCents: 0n,
  });
});
