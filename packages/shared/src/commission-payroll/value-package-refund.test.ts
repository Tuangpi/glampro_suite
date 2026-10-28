import assert from "node:assert/strict";
import { test } from "node:test";
import { payrollValuePackageSpend } from "./allocation.js";
import {
  payrollValuePackagePurchaseSchema,
  payrollValuePackageRefundAmounts,
} from "./value-package-refund.js";

const purchase = {
  version: 1,
  saleId: "original-sale",
  saleLineId: "original-line",
  currency: "SGD",
  paidNet: "500.00",
  credit: "600.00",
  sellers: [
    { staffId: "original-seller", share: 6000 },
    { staffId: "second-seller", share: 4000 },
  ],
};
const input = {
  purchase,
  creditRemaining: "500.00",
  originalTaxCents: 4500n,
  collectedNet: 50000n,
  collectedTax: 4500n,
  adminFeeNet: 10000n,
};

test("value refund applies original paid/credit ratio, not remaining face credit", () => {
  assert.deepEqual(payrollValuePackageRefundAmounts(input), {
    net: 31666n,
    tax: 2850n,
    gross: 34516n,
    usedTicks: 833333n,
    cancelledCreditCents: 50000n,
    cancelledGross: 0n,
  });
});

test("value refund separates partial collections, original tax and cancelled debt", () => {
  const result = payrollValuePackageRefundAmounts({
    ...input,
    collectedNet: 25000n,
    collectedTax: 2250n,
  });
  assert.equal(result.net, 6666n);
  assert.equal(result.tax, 600n);
  assert.equal(result.gross, 7266n);
  assert.equal(result.cancelledGross, 27250n);
});

test("unused value package returns exactly collected cash, never promotional credit", () => {
  const result = payrollValuePackageRefundAmounts({
    ...input,
    creditRemaining: "600.00",
    adminFeeNet: 0n,
  });
  assert.equal(result.net, 50000n);
  assert.equal(result.tax, 4500n);
  assert.equal(result.gross, 54500n);
  assert.equal(result.usedTicks, 0n);
});

test("exhausted, uncollected, free and fee-consumed packages permit zero payout", () => {
  for (const patch of [
    { creditRemaining: "0.00" },
    { collectedNet: 0n, collectedTax: 0n },
    { adminFeeNet: 50000n },
    {
      purchase: { ...purchase, paidNet: "0.00" },
      originalTaxCents: 0n,
      collectedNet: 0n,
      collectedTax: 0n,
    },
  ]) {
    const result = payrollValuePackageRefundAmounts({ ...input, ...patch });
    assert.equal(result.net, 0n);
    assert.equal(result.tax, 0n);
    assert.equal(result.gross, 0n);
  }
});

test("refund used value reconciles cumulative VP_SPEND rounding at every draw", () => {
  let spentTicks = 0n;
  for (let index = 0; index <= 6; index++) {
    if (index > 0)
      spentTicks += BigInt(
        payrollValuePackageSpend("500.00", "600.00", String((index - 1) * 100), "100").replace(
          ".",
          "",
        ),
      );
    const result = payrollValuePackageRefundAmounts({
      ...input,
      creditRemaining: `${600 - index * 100}.00`,
      adminFeeNet: 0n,
    });
    assert.equal(result.usedTicks, spentTicks);
    assert.ok(result.net * 100n + result.usedTicks <= input.collectedNet * 100n);
    assert.ok(input.collectedNet * 100n - result.net * 100n - result.usedTicks < 100n);
  }
  assert.equal(spentTicks, 5000000n);
});

test("sub-cent residual is not paid out or rounded separately for each draw", () => {
  const result = payrollValuePackageRefundAmounts({
    ...input,
    purchase: { ...purchase, paidNet: "0.01", credit: "0.03" },
    creditRemaining: "0.02",
    originalTaxCents: 0n,
    collectedNet: 1n,
    collectedTax: 0n,
    adminFeeNet: 0n,
  });
  assert.equal(result.usedTicks, 33n);
  assert.equal(result.net, 0n);
});

test("invalid holding amounts and contradictory collections reject rather than overpay", () => {
  for (const patch of [
    { creditRemaining: "600.01" },
    { creditRemaining: "-1.00" },
    { creditRemaining: "1e2" },
    { creditRemaining: "1.001" },
    { creditRemaining: " 1.00" },
    { originalTaxCents: -1n },
    { collectedNet: -1n },
    { collectedNet: 50001n },
    { collectedTax: -1n },
    { collectedTax: 4501n },
    { adminFeeNet: -1n },
  ])
    assert.throws(() => payrollValuePackageRefundAmounts({ ...input, ...patch }));
});

test("missing or corrupt original evidence cannot be inferred for refunds", () => {
  for (const patch of [
    { currency: null },
    { currency: "sgd" },
    { sellers: null },
    { sellers: [] },
    { sellers: [{ staffId: "seller", share: 9999 }] },
    { sellers: [{ staffId: "seller", share: -10000 }] },
    { saleId: "" },
    { saleLineId: "" },
    { credit: "0.00" },
    { paidNet: "-1.00" },
    { paidNet: "1.001" },
    { version: 2 },
  ])
    assert.throws(() =>
      payrollValuePackageRefundAmounts({ ...input, purchase: { ...purchase, ...patch } }),
    );
  assert.throws(() => payrollValuePackageRefundAmounts({ ...input, purchase: null }));
});

test("ratio evidence can stay explicitly incomplete until refund acceptance", () => {
  assert.ok(
    payrollValuePackagePurchaseSchema.safeParse({ ...purchase, currency: null, sellers: null })
      .success,
  );
});

test("quote is deterministic and does not mutate original purchase/seller evidence", () => {
  const before = JSON.stringify(purchase);
  assert.deepEqual(
    payrollValuePackageRefundAmounts(input),
    payrollValuePackageRefundAmounts(input),
  );
  assert.equal(JSON.stringify(purchase), before);
});
