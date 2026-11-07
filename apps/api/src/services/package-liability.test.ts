import assert from "node:assert/strict";
import { after, test } from "node:test";
import { capturePayrollPackagePurchase } from "@glampro_suite/shared";
import { packageLiability, packageLiabilityRow } from "./package-liability.js";
import { soldSessionEvidence } from "./package-utilisation.js";
import { prisma } from "../lib/prisma.js";
import { runAsTenant, runAtOutlet } from "../lib/tenant-context.js";

const asOf = new Date("2026-11-07T00:00:00Z");
const purchase = capturePayrollPackagePurchase({
  saleId: "sale",
  saleLineId: "line",
  packageId: "package",
  originalCustomerId: "customer",
  outletId: null,
  purchasedAt: asOf.toISOString(),
  currency: "SGD",
  grantedSessions: 3,
  grossCents: "1000",
  netCents: "1000",
  taxCents: "0",
  sellers: null,
  commissionSettings: {
    sale: { mode: "FOLLOW_PLAN" },
    redemption: { mode: "FIXED", amount: "2.50" },
    minimumDepositPct: "0",
  },
});
const holding = {
  id: "holding",
  customerId: "transferred-customer",
  packageId: "package",
  saleLineId: "line",
  quantity: 3,
  quantityRemaining: 2,
  expiresAt: null,
  payrollPurchaseSnapshot: purchase,
  payrollAvailableOrdinals: [{ first: 2, last: 3 }],
};
test("per-holding value retains original residual ordinals and captured fixed policy after transfer", () => {
  const row = packageLiabilityRow(holding, asOf);
  assert.equal(row.remainingNet, "6.6666");
  assert.equal(row.commissionExposure, "5.00");
  assert.equal(row.customerId, "transferred-customer");
  assert.equal(row.expired, false);
});
test("excluded is explicit zero; follow-plan exposure stays unknown, never fabricated", () => {
  for (const mode of ["EXCLUDE", "FOLLOW_PLAN"] as const) {
    const snapshot = {
      ...purchase,
      commissionSettings: { ...purchase.commissionSettings!, redemption: { mode } },
    };
    const row = packageLiabilityRow(
      {
        ...holding,
        payrollPurchaseSnapshot: snapshot,
        expiresAt: new Date("2026-01-01T00:00:00Z"),
      },
      asOf,
    );
    assert.equal(row.expired, true);
    assert.equal(row.commissionExposure, mode === "EXCLUDE" ? "0.00" : null);
    if (mode === "FOLLOW_PLAN") assert.match(row.exposureReason!, /Future performer/);
  }
});
test("legacy, corrupt, foreign and mismatched remaining evidence is unavailable, not zero", () => {
  for (const edit of [
    { payrollPurchaseSnapshot: null },
    { payrollPurchaseSnapshot: {} },
    { payrollAvailableOrdinals: null },
    { quantityRemaining: 1 },
    { packageId: "other" },
    {
      payrollAvailableOrdinals: [
        { first: 1, last: 2 },
        { first: 2, last: 3 },
      ],
    },
  ]) {
    const row = packageLiabilityRow({ ...holding, ...edit }, asOf);
    assert.equal(row.remainingNet, null);
    assert.equal(row.commissionExposure, null);
  }
});
test("sold sessions use original grants and immutable snapshots even after holding deletion", () => {
  const line = { id: "line", saleId: "sale", itemId: "package" };
  assert.equal(soldSessionEvidence(line, [holding], []), 3);
  assert.equal(soldSessionEvidence(line, [], []), null);
  assert.equal(soldSessionEvidence(line, [{ ...holding, payrollPurchaseSnapshot: {} }], []), null);
  assert.equal(soldSessionEvidence({ ...line, itemId: "other" }, [holding], []), null);
  assert.equal(
    soldSessionEvidence(line, [], [{ saleLineId: "line", saleId: "sale", grantedSessions: 3 }]),
    3,
  );
});

const original = prisma.$transaction;
after(() => Reflect.set(prisma, "$transaction", original));
let role: string | null = "MANAGER";
Reflect.set(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    user: {
      findFirst: async (query: { where: unknown }) => {
        assert.deepEqual(query.where, { id: "actor", disabled: false });
        return role ? { globalRole: role } : null;
      },
    },
    customerPackageHolding: {
      findMany: async (query: { where: unknown }) => {
        assert.deepEqual(query.where, { quantityRemaining: { gt: 0 } });
        return [holding];
      },
    },
  }),
);
test("liability rechecks actor role and refuses staff, missing actor and outlet views", async () => {
  assert.equal((await runAsTenant("salon", packageLiability, "actor")).rows.length, 1);
  for (const value of ["STAFF", "CASHIER", null]) {
    role = value;
    await assert.rejects(runAsTenant("salon", packageLiability, "actor"), /Forbidden/);
  }
  role = "MANAGER";
  await assert.rejects(
    runAsTenant("salon", () => runAtOutlet("outlet", packageLiability), "actor"),
    /Forbidden/,
  );
  await assert.rejects(packageLiability(), /Forbidden/);
});
