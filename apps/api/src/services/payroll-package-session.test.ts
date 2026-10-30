import assert from "node:assert/strict";
import { test } from "node:test";
import { capturePayrollPackagePurchase } from "@glampro_suite/shared";
import { hashPassword } from "../lib/password.js";
import { runAsTenant } from "../lib/tenant-context.js";
import { drawPayrollPackageSessions } from "./payroll-package-session.js";

test("unpaid draw writer binds verified approval to tenant, customer and usage sale without PIN leakage", async () => {
  const pin = "654321";
  const purchase = capturePayrollPackagePurchase({
    saleId: "purchase",
    saleLineId: "line",
    packageId: "package",
    originalCustomerId: "buyer",
    outletId: "outlet",
    purchasedAt: "2026-08-01T00:00:00Z",
    currency: "SGD",
    grantedSessions: 2,
    netCents: "10000",
    taxCents: "900",
    grossCents: "10900",
    sellers: [{ staffId: "seller", share: 10000 }],
    commissionSettings: {
      sale: { mode: "FOLLOW_PLAN" },
      redemption: { mode: "FOLLOW_PLAN" },
      minimumDepositPct: "30",
    },
  });
  const holding = {
    id: "holding",
    tenantId: "salon",
    customerId: "buyer",
    quantityRemaining: 2,
    payrollPurchaseSnapshot: purchase,
    payrollAvailableOrdinals: [{ first: 1, last: 2 }],
  };
  const manager = {
    id: "manager",
    tenantId: "salon",
    globalRole: "MANAGER",
    posPinHash: await hashPassword(pin),
  };
  const sale = { id: "usage", customerId: "buyer" };
  const audits: { metadata: unknown; createdAt: Date }[] = [];
  let updates = 0;
  const tx = {
    customerPackageHolding: {
      findFirstOrThrow: async () => holding,
      update: async () => {
        updates++;
      },
    },
    payrollSourceEvent: { findFirst: async () => null },
    commissionCollectionAllocation: { findMany: async () => [{ netCents: 3000n }] },
    user: { findFirst: async () => manager },
    sale: { findFirst: async () => sale },
    auditLog: {
      create: async ({ data }: { data: (typeof audits)[number] }) => {
        audits.push(data);
      },
    },
  } as unknown as Parameters<typeof drawPayrollPackageSessions>[0];
  const approval = { managerId: manager.id, pin, reason: "Approved exception" };
  const draw = (override = approval, saleId: string | undefined = sale.id) =>
    runAsTenant(
      "salon",
      () => drawPayrollPackageSessions(tx, holding.id, 1, override, saleId),
      "operator",
    );
  await assert.rejects(draw({ ...approval, pin: "wrong" }), /valid enabled salon manager PIN/);
  manager.tenantId = "foreign";
  await assert.rejects(draw(), /valid enabled salon manager PIN/);
  manager.tenantId = "salon";
  manager.globalRole = "STAFF";
  await assert.rejects(draw(), /valid enabled salon manager PIN/);
  manager.globalRole = "MANAGER";
  sale.customerId = "foreign";
  await assert.rejects(draw(), /matching usage sale/);
  sale.customerId = "buyer";
  await assert.rejects(draw({ ...approval, reason: " " }), /matching usage sale/);
  await assert.rejects(
    runAsTenant("salon", () => drawPayrollPackageSessions(tx, holding.id, 1, approval), "operator"),
    /matching usage sale/,
  );
  await assert.rejects(
    drawPayrollPackageSessions(tx, holding.id, 1, approval, sale.id),
    /authenticated operator/,
  );
  assert.equal(audits.length, 0);
  assert.equal(updates, 0);
  assert.deepEqual((await draw()).ordinals, [{ first: 1, last: 1 }]);
  assert.equal(updates, 1);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].metadata, {
    actorId: "operator",
    managerId: "manager",
    managerRole: "MANAGER",
    saleId: "usage",
    reason: "Approved exception",
    quantity: 1,
    paidSessions: 0,
    usedSessions: 0,
  });
  assert.equal(JSON.stringify(audits).includes(pin), false);
  assert.ok(audits[0].createdAt instanceof Date);
});
