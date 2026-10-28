import assert from "node:assert/strict";
import { test } from "node:test";
import { payrollPackageSettingsSchema } from "./package-settings.js";
import { capturePayrollPackagePurchase, payrollPackageSessionBase } from "./package-purchase.js";
import { createPackageSchema, updatePackageSchema } from "../schemas/catalogue.js";

const settings = {
  sale: { mode: "EXCLUDE" as const },
  redemption: { mode: "FIXED" as const, amount: "5.25" },
  minimumDepositPct: "30",
};
test("settings require explicit modes, exact fixed money and bounded deposit", () => {
  assert.deepEqual(payrollPackageSettingsSchema.parse(settings), settings);
  for (const value of ["-1", "100.01", "NaN", "1.234", "1e1", ""]) {
    assert.equal(
      payrollPackageSettingsSchema.safeParse({ ...settings, minimumDepositPct: value }).success,
      false,
    );
  }
  for (const amount of [5, "", "-1", "5.001", "1e2"]) {
    assert.equal(
      payrollPackageSettingsSchema.safeParse({ ...settings, sale: { mode: "FIXED", amount } })
        .success,
      false,
    );
  }
  assert.equal(
    payrollPackageSettingsSchema.safeParse({ ...settings, sale: { mode: "EXCLUDE", amount: "5" } })
      .success,
    false,
  );
  assert.equal(payrollPackageSettingsSchema.safeParse({ ...settings, sale: {} }).success, false);
  assert.equal(
    payrollPackageSettingsSchema.safeParse({ ...settings, allowUnpaidRedemption: true }).success,
    false,
  );
});
test("configuration writes require a reason and updates require a stale-write token", () => {
  assert.equal(updatePackageSchema.safeParse({ commissionSettings: settings }).success, false);
  assert.equal(
    updatePackageSchema.safeParse({
      commissionSettings: settings,
      commissionReason: "Explicit policy",
      expectedUpdatedAt: "2026-10-28T00:00:00.000Z",
    }).success,
    true,
  );
  assert.equal(
    createPackageSchema.safeParse({
      name: "Package",
      sessionCount: 3,
      memberPrice: 100,
      nonmemberPrice: 100,
      commissionSettings: settings,
    }).success,
    false,
  );
});
test("purchase snapshots deep-copy explicit settings without authorizing earnings", () => {
  const snapshot = capturePayrollPackagePurchase({
    saleId: "sale",
    saleLineId: "line",
    packageId: "package",
    originalCustomerId: "buyer",
    outletId: null,
    purchasedAt: "2026-10-28T00:00:00.000Z",
    currency: "SGD",
    grantedSessions: 3,
    grossCents: "10000",
    netCents: "10000",
    taxCents: "0",
    sellers: [{ staffId: "seller", share: 10000 }],
    commissionSettings: settings,
  });
  settings.redemption.amount = "9.99";
  assert.equal(
    snapshot.commissionSettings?.redemption.mode === "FIXED" &&
      snapshot.commissionSettings.redemption.amount,
    "5.25",
  );
  assert.deepEqual(snapshot.missingEvidence, []);
  assert.equal(snapshot.status, "CAPTURED_ECONOMICS_ONLY");
  assert.equal(
    payrollPackageSessionBase(snapshot, 1, 3, [{ staffId: "performer", share: 10000 }]).baseAmount,
    "100.0000",
  );
});
