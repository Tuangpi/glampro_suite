import assert from "node:assert/strict";
import { test } from "node:test";
import { capturePayrollPackageCollection } from "./collection.js";

const input = {
  collectionId: "collection",
  saleId: "sale",
  saleLineId: "line",
  itemId: "package",
  outletId: "outlet",
  sourceType: "SALE_PAYMENT" as const,
  sourceId: "payment",
  occurredAt: "2026-10-28T02:00:00.000Z",
  currency: "SGD",
  confirmedCurrency: "SGD",
  grossCents: "10900",
  netCents: "10000",
  taxCents: "900",
  sellers: [
    { staffId: "b", share: 6667 },
    { staffId: "a", share: 3333 },
  ],
};

test("package collection captures original sellers and net bases, without rates or earnings", () => {
  const before = structuredClone(input);
  const result = capturePayrollPackageCollection(input);
  assert.equal(result.status, "CAPTURED_BASE_ONLY");
  assert.equal(result.commissionType, "PKG_SALE");
  assert.deepEqual(result.bases, [
    { staffId: "a", share: 3333, baseAmount: "33.3300" },
    { staffId: "b", share: 6667, baseAmount: "66.6700" },
  ]);
  assert.equal(result.sourceId, "payment");
  assert.equal(result.outletId, "outlet");
  assert.equal(result.occurredAt, input.occurredAt);
  assert.equal(result.taxCents, "900");
  assert.ok(!JSON.stringify(result).includes("rate"));
  assert.deepEqual(input, before);
});

test("four-decimal split residuals reconcile for every cent and input order", () => {
  for (let net = 0n; net < 300n; net++) {
    const value = { ...input, grossCents: `${net}`, netCents: `${net}`, taxCents: "0" };
    const result = capturePayrollPackageCollection(value);
    const ticks = result.bases!.reduce(
      (sum, row) => sum + BigInt(row.baseAmount.replace(".", "")),
      0n,
    );
    assert.equal(ticks, net * 100n);
    assert.deepEqual(
      result,
      capturePayrollPackageCollection({ ...value, sellers: [...input.sellers].reverse() }),
    );
  }
});

test("incomplete evidence is unavailable, never a zero or cashier substitute", () => {
  for (const value of [
    { ...input, sellers: null },
    { ...input, confirmedCurrency: null },
    { ...input, confirmedCurrency: null, sellers: null },
  ]) {
    const result = capturePayrollPackageCollection(value);
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.bases, null);
    assert.ok(result.missingEvidence.length > 0);
  }
  assert.deepEqual(
    capturePayrollPackageCollection({ ...input, confirmedCurrency: null, sellers: null })
      .missingEvidence,
    ["SALE_CURRENCY", "SELLERS"],
  );
});

test("later collections retain their own source date and only new net consideration", () => {
  const result = capturePayrollPackageCollection({
    ...input,
    sourceType: "OUTSTANDING_PAYMENT",
    sourceId: "balance-payment",
    occurredAt: "2026-11-01T00:00:00.000Z",
    grossCents: "5450",
    netCents: "5000",
    taxCents: "450",
  });
  assert.equal(result.sourceId, "balance-payment");
  assert.equal(result.occurredAt, "2026-11-01T00:00:00.000Z");
  assert.deepEqual(
    result.bases?.map((row) => row.baseAmount),
    ["16.6650", "33.3350"],
  );
});

test("reject contradictory GST/currency, malformed money, rates and invalid splits", () => {
  for (const value of [
    { ...input, taxCents: "901" },
    { ...input, confirmedCurrency: "USD" },
    { ...input, netCents: "-1" },
    { ...input, netCents: "1.2" },
    { ...input, netCents: "01" },
    { ...input, rate: "5" },
    { ...input, sellers: [{ staffId: "a", share: 9999 }] },
    {
      ...input,
      sellers: [
        { staffId: "a", share: 5000 },
        { staffId: "a", share: 5000 },
      ],
    },
  ])
    assert.throws(() => capturePayrollPackageCollection(value));
});
