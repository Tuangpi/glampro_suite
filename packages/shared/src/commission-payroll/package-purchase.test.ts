import assert from "node:assert/strict";
import { test } from "node:test";
import { capturePayrollPackagePurchase, payrollPackageSessionBase } from "./package-purchase.js";

const input = {
  saleId: "sale",
  saleLineId: "line",
  packageId: "package",
  originalCustomerId: "buyer",
  outletId: "outlet",
  purchasedAt: "2026-10-28T02:00:00.000Z",
  currency: "SGD",
  grantedSessions: 3,
  grossCents: "10900",
  netCents: "10000",
  taxCents: "900",
  sellers: [{ staffId: "seller", share: 10000 }],
};
const performers = [
  { staffId: "b", share: 5000 },
  { staffId: "a", share: 5000 },
];
const ticks = (amount: string) => BigInt(amount.replace(".", ""));

test("purchase freezes original economics and explicit incomplete commission configuration", () => {
  const before = structuredClone(input);
  const snapshot = capturePayrollPackagePurchase(input);
  assert.equal(snapshot.sessionBaseFloor, "33.3333");
  assert.equal(snapshot.extraBaseTickSessions, 1);
  assert.equal(snapshot.status, "CAPTURED_ECONOMICS_ONLY");
  assert.deepEqual(snapshot.missingEvidence, ["PACKAGE_COMMISSION_SETTINGS"]);
  assert.deepEqual(snapshot.sellers, input.sellers);
  assert.deepEqual(input, before);
  assert.ok(!("rate" in snapshot));
  assert.ok(!("mode" in snapshot));
});

test("session ordinals and split residuals reconcile exactly without cent rounding", () => {
  const snapshot = capturePayrollPackagePurchase(input);
  assert.deepEqual(
    [1, 2, 3].map((n) => payrollPackageSessionBase(snapshot, n, n, performers).baseAmount),
    ["33.3334", "33.3333", "33.3333"],
  );
  for (let sessions = 1; sessions <= 17; sessions++) {
    for (let net = 0; net < 37; net++) {
      const purchase = capturePayrollPackagePurchase({
        ...input,
        grantedSessions: sessions,
        netCents: `${net}`,
        grossCents: `${net}`,
        taxCents: "0",
      });
      let total = 0n;
      for (let ordinal = 1; ordinal <= sessions; ordinal++) {
        const result = payrollPackageSessionBase(purchase, ordinal, ordinal, performers);
        assert.equal(
          result.bases.reduce((sum, row) => sum + ticks(row.amount), 0n),
          ticks(result.baseAmount),
        );
        total += ticks(result.baseAmount);
      }
      assert.equal(total, BigInt(net) * 100n);
      assert.equal(
        ticks(payrollPackageSessionBase(purchase, 1, sessions, performers).baseAmount),
        total,
      );
    }
  }
});

test("snapshots missing currency or sellers never invent them from other evidence", () => {
  const snapshot = capturePayrollPackagePurchase({ ...input, currency: null, sellers: null });
  assert.equal(snapshot.currency, null);
  assert.equal(snapshot.sellers, null);
  assert.deepEqual(snapshot.missingEvidence, [
    "PACKAGE_COMMISSION_SETTINGS",
    "SALE_CURRENCY",
    "SELLERS",
  ]);
});

test("ranges use original ordinals and handle large grants without expanding sessions", () => {
  const snapshot = capturePayrollPackagePurchase({ ...input, grantedSessions: 1_000_000_000 });
  assert.equal(
    payrollPackageSessionBase(snapshot, 1, 1_000_000_000, performers).baseAmount,
    "100.0000",
  );
  assert.equal(
    payrollPackageSessionBase(snapshot, 1_000_000_000, 1_000_000_000, performers).baseAmount,
    "0.0000",
  );
});

test("reject corrupt economics, invalid grants, ordinals and attribution", () => {
  for (const value of [
    { ...input, grantedSessions: 0 },
    { ...input, grantedSessions: 1.5 },
    { ...input, netCents: "-1" },
    { ...input, taxCents: "901" },
    { ...input, sellers: [{ staffId: "seller", share: 9999 }] },
  ])
    assert.throws(() => capturePayrollPackagePurchase(value));
  const snapshot = capturePayrollPackagePurchase(input);
  for (const [first, last] of [
    [0, 1],
    [2, 1],
    [1, 4],
    [1.5, 2],
  ])
    assert.throws(() => payrollPackageSessionBase(snapshot, first!, last!, performers));
  assert.throws(() =>
    payrollPackageSessionBase({ ...snapshot, sessionBaseFloor: "33.34" }, 1, 1, performers),
  );
  assert.throws(() =>
    payrollPackageSessionBase({ ...snapshot, extraBaseTickSessions: 0 }, 1, 1, performers),
  );
  assert.throws(() =>
    payrollPackageSessionBase({ ...snapshot, missingEvidence: [] }, 1, 1, performers),
  );
});
