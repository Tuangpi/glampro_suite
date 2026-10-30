import assert from "node:assert/strict";
import { test } from "node:test";
import { capturePayrollPackagePurchase } from "./package-purchase.js";
import { payrollPackageRefundAmounts, payrollPackageUnusedValue } from "./package-refund.js";
import { refundPayrollPackageSchema } from "../schemas/payroll-holding.js";

const purchaseInput = {
  saleId: "sale",
  saleLineId: "line",
  packageId: "package",
  originalCustomerId: "buyer",
  outletId: null,
  purchasedAt: "2026-10-28T00:00:00.000Z",
  currency: "SGD",
  grantedSessions: 5,
  netCents: "500000",
  taxCents: "45000",
  grossCents: "545000",
  sellers: [{ staffId: "seller", share: 10000 }],
  commissionSettings: {
    sale: { mode: "FIXED" as const, amount: "100" },
    redemption: { mode: "FOLLOW_PLAN" as const },
    minimumDepositPct: "0",
  },
};
const purchase = capturePayrollPackagePurchase(purchaseInput);
const input = {
  purchase,
  available: [{ first: 3, last: 5 }],
  quantityRemaining: 3,
  collectedNet: 500000n,
  collectedTax: 45000n,
  adminFeeNet: 10000n,
};
test("refund separates original net, stored GST, used-session value and cancelled debt", () => {
  assert.deepEqual(payrollPackageRefundAmounts(input), {
    net: 290000n,
    tax: 26100n,
    gross: 316100n,
    usedTicks: 20000000n,
    cancelledGross: 0n,
  });
  const partial = payrollPackageRefundAmounts({
    ...input,
    collectedNet: 250000n,
    collectedTax: 22500n,
  });
  assert.equal(partial.net, 40000n);
  assert.equal(partial.tax, 3600n);
  assert.equal(partial.cancelledGross, 272500n);
});
test("zero cash and used value or fees consuming collections permit zero payout", () => {
  for (const collectedNet of [0n, 199999n, 200000n, 210000n]) {
    const result = payrollPackageRefundAmounts({ ...input, collectedNet, collectedTax: 0n });
    assert.equal(result.gross, 0n);
  }
  assert.equal(payrollPackageRefundAmounts({ ...input, adminFeeNet: 600000n }).gross, 0n);
  const free = capturePayrollPackagePurchase({
    ...purchaseInput,
    netCents: "0",
    taxCents: "0",
    grossCents: "0",
  });
  assert.equal(
    payrollPackageRefundAmounts({ ...input, purchase: free, collectedNet: 0n, collectedTax: 0n })
      .gross,
    0n,
  );
});
test("refund rounds only at customer cent boundary and preserves exact ordinal residuals", () => {
  const tiny = capturePayrollPackagePurchase({
    ...purchaseInput,
    grantedSessions: 3,
    netCents: "1",
    taxCents: "0",
    grossCents: "1",
  });
  const result = payrollPackageRefundAmounts({
    ...input,
    purchase: tiny,
    available: [{ first: 2, last: 3 }],
    quantityRemaining: 2,
    collectedNet: 1n,
    collectedTax: 0n,
    adminFeeNet: 0n,
  });
  assert.equal(result.usedTicks, 34n);
  assert.equal(result.net, 0n);
  assert.equal(payrollPackageRefundAmounts({ ...input, adminFeeNet: 299999n }).net, 1n);
});
test("refund rejects overlapping, out-of-grant and contradictory remaining ordinals", () => {
  for (const available of [
    [
      { first: 1, last: 2 },
      { first: 2, last: 3 },
    ],
    [{ first: 0, last: 2 }],
    [{ first: 4, last: 6 }],
    [{ first: 4, last: 3 }],
    [{ first: 1.5, last: 3 }],
    [],
  ])
    assert.throws(() => payrollPackageRefundAmounts({ ...input, available }));
  assert.throws(() => payrollPackageUnusedValue(purchase, [], -1));
  assert.throws(() => payrollPackageUnusedValue(purchase, [], 0.5));
  assert.equal(
    payrollPackageUnusedValue(
      purchase,
      [
        { first: 5, last: 5 },
        { first: 3, last: 4 },
      ],
      3,
    ).usedTicks,
    20000000n,
  );
});
test("refund rejects negative and over-collected money rather than creating excess payouts", () => {
  for (const patch of [
    { collectedNet: -1n },
    { collectedTax: -1n },
    { adminFeeNet: -1n },
    { collectedNet: 500001n },
    { collectedTax: 45001n },
  ])
    assert.throws(() => payrollPackageRefundAmounts({ ...input, ...patch }));
});
test("zero payout requires explicit NONE while positive payout requires actual tender", () => {
  const request = {
    idempotencyKey: "refund-request",
    expectedUpdatedAt: "2026-10-28T00:00:00.000Z",
    reason: "Cancel unused sessions",
    adminFeeNetCents: "0",
    payoutGrossCents: "0",
    payoutMethod: "NONE",
  };
  assert.ok(refundPayrollPackageSchema.safeParse(request).success);
  assert.ok(
    refundPayrollPackageSchema.safeParse({
      ...request,
      settlement: { confirmed: true, reference: "cash-voucher-001" },
    }).success,
  );
  for (const settlement of [
    { confirmed: false, reference: "cash-voucher-001" },
    { confirmed: true, reference: " " },
    { confirmed: true, reference: "cash-voucher-001", executePayment: true },
  ])
    assert.equal(refundPayrollPackageSchema.safeParse({ ...request, settlement }).success, false);
  assert.ok(
    refundPayrollPackageSchema.safeParse({
      ...request,
      payoutGrossCents: "1",
      payoutMethod: "CASH",
    }).success,
  );
  for (const patch of [
    { payoutMethod: "CASH" },
    { payoutGrossCents: "1" },
    { payoutGrossCents: "-1" },
    { payoutGrossCents: "00" },
  ])
    assert.equal(refundPayrollPackageSchema.safeParse({ ...request, ...patch }).success, false);
});
