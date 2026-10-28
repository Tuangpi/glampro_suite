import assert from "node:assert/strict";
import { test } from "node:test";
import { capturePayrollPackagePurchase } from "./package-purchase.js";
import {
  paidPayrollPackageSessions,
  minimumPayrollPackageDeposit,
  readPayrollPackagePurchase,
} from "./package-payment.js";
const purchase = capturePayrollPackagePurchase({
  saleId: "sale",
  saleLineId: "line",
  packageId: "package",
  originalCustomerId: "buyer",
  outletId: null,
  purchasedAt: "2026-10-28T00:00:00.000Z",
  currency: "SGD",
  grantedSessions: 5,
  grossCents: "545000",
  netCents: "500000",
  taxCents: "45000",
  sellers: [{ staffId: "seller", share: 10000 }],
});
test("paid-session limits use original exact net economics and reject out-of-range collection", () => {
  assert.equal(paidPayrollPackageSessions(purchase, 200000n), 2);
  assert.equal(paidPayrollPackageSessions(purchase, 299999n), 2);
  assert.equal(paidPayrollPackageSessions(purchase, 300000n), 3);
  assert.equal(paidPayrollPackageSessions(purchase, 500000n), 5);
  assert.throws(() => paidPayrollPackageSessions(purchase, -1n));
  assert.throws(() => paidPayrollPackageSessions(purchase, 500001n));
  assert.equal(
    paidPayrollPackageSessions(
      capturePayrollPackagePurchase({
        ...purchaseInput(),
        grossCents: "1",
        netCents: "1",
        taxCents: "0",
        grantedSessions: 3,
      }),
      0n,
    ),
    0,
  );
});
function purchaseInput() {
  return {
    saleId: purchase.saleId,
    saleLineId: purchase.saleLineId,
    packageId: purchase.packageId,
    originalCustomerId: purchase.originalCustomerId,
    outletId: purchase.outletId,
    purchasedAt: purchase.purchasedAt,
    currency: purchase.currency,
    grantedSessions: purchase.grantedSessions,
    grossCents: purchase.grossCents,
    netCents: purchase.netCents,
    taxCents: purchase.taxCents,
    sellers: purchase.sellers,
  };
}
test("deposits round up exactly and malformed historical snapshots are never repaired", () => {
  assert.equal(minimumPayrollPackageDeposit(10900n, "30"), 3270n);
  assert.equal(minimumPayrollPackageDeposit(101n, "30"), 31n);
  assert.equal(minimumPayrollPackageDeposit(101n, "0"), 0n);
  assert.equal(minimumPayrollPackageDeposit(101n, "100"), 101n);
  for (const pct of ["100.01", "-1", "1e2", "", "NaN"])
    assert.throws(() => minimumPayrollPackageDeposit(100n, pct));
  assert.throws(() => readPayrollPackagePurchase({ ...purchase, sessionBaseFloor: "1.0000" }));
  assert.deepEqual(readPayrollPackagePurchase(purchase), purchase);
});
