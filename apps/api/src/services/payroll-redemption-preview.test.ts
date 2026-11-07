import assert from "node:assert/strict";
import { after, test } from "node:test";
import { capturePayrollPackagePurchase } from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { runAsTenant } from "../lib/tenant-context.js";
import { calculatedPayrollExportState } from "./payroll-export.test-helper.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { previewPayrollRedemption, redemptionPreviewSchema } from "./payroll-redemption-preview.js";

const original = prisma.$transaction;
after(() => Reflect.set(prisma, "$transaction", original));
const state = calculatedPayrollExportState();
state.periodKey = new Date().toISOString().slice(0, 7);
for (const statement of state.calculation!.statements) {
  statement.inputs.calculation.periodKey = state.periodKey;
  statement.inputs.calculation.lines = statement.inputs.calculation.lines.map((line) => ({
    ...line,
    businessDate: `${state.periodKey}-${line.businessDate.slice(-2)}`,
  }));
}
const definition = state.calculation!.statements[0]!.inputs.calculation.plan!.definition;
definition.components.push({
  key: "redemption",
  name: "Session commission",
  commissionTypes: ["PKG_RED"],
  basePct: "100",
  method: "FLAT",
  flatRatePct: "5",
  bands: [],
  sort: 1,
});
let role = "MANAGER";
let paid = 10000n;
let fixed = false;
let missing = false;
let expired = false;
let refunded = false;
let excluded = false;
const snapshot = () =>
  capturePayrollPackagePurchase({
    saleId: "sale",
    saleLineId: "line",
    packageId: "package",
    originalCustomerId: "buyer",
    outletId: null,
    purchasedAt: "2026-09-01T00:00:00Z",
    currency: "SGD",
    grantedSessions: 3,
    grossCents: "10000",
    netCents: "10000",
    taxCents: "0",
    sellers: [{ staffId: "staff-a", share: 10000 }],
    commissionSettings: {
      sale: { mode: "FOLLOW_PLAN" },
      redemption: excluded
        ? { mode: "EXCLUDE" }
        : fixed
          ? { mode: "FIXED", amount: "4.25" }
          : { mode: "FOLLOW_PLAN" },
      minimumDepositPct: "0",
    },
  });
Reflect.set(prisma, "$transaction", async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    user: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        globalRole: role,
      }),
      findMany: async () => [{ id: "staff-a", commissionRate: new Prisma.Decimal(5) }],
    },
    customerPackageHolding: {
      findFirst: async ({ where }: { where: { customerId: string } }) =>
        where.customerId === "buyer"
          ? {
              id: "holding",
              packageId: "package",
              quantityRemaining: 3,
              expiresAt: expired ? new Date("2020-01-01T00:00:00Z") : null,
              payrollPurchaseSnapshot: missing ? null : snapshot(),
              payrollAvailableOrdinals: [{ first: 1, last: 3 }],
            }
          : null,
    },
    tenant: { findUniqueOrThrow: async () => ({ timeZone: "UTC" }) },
    payrollClose: {
      findFirst: async () => ({ state, revision: state.revision, status: state.status }),
    },
    payrollCloseEvent: { findFirst: async () => ({ stateHash: payrollInputHash(state) }) },
    commissionCollectionAllocation: { findMany: async () => [{ netCents: paid }] },
    payrollSourceEvent: { findFirst: async () => (refunded ? { id: "refund" } : null) },
    commissionRule: { findMany: async () => [] },
  }),
);
const input = {
  holdingId: "holding",
  customerId: "buyer",
  quantity: 1,
  shares: [{ staffId: "staff-a", share: 10000 }],
};
test("redemption preview uses original residual-bearing ordinals, never current catalogue prices or writes", async () => {
  const before = JSON.stringify(state);
  const data = await runAsTenant("salon", () => previewPayrollRedemption(input), "staff-a");
  assert.equal(data.baseAmount, "33.3334");
  assert.equal(data.rows[0].amount, "1.67");
  assert.equal(data.basis, "ORIGINAL_SESSION_SNAPSHOT");
  assert.equal(JSON.stringify(state), before);
});
test("fixed redemption awards count sessions and staff output is SELF-only", async () => {
  fixed = true;
  role = "STAFF";
  try {
    const own = await runAsTenant(
      "salon",
      () => previewPayrollRedemption({ ...input, quantity: 2 }),
      "staff-a",
    );
    assert.equal(own.rows[0].amount, "8.50");
    const other = await runAsTenant("salon", () => previewPayrollRedemption(input), "other");
    assert.deepEqual(other.rows, []);
  } finally {
    fixed = false;
    role = "MANAGER";
  }
});
test("unpaid or legacy sessions are unavailable rather than zero, and ownership is checked", async () => {
  paid = 0n;
  try {
    assert.equal(
      (await runAsTenant("salon", () => previewPayrollRedemption(input), "staff-a")).baseAmount,
      null,
    );
    paid = 10000n;
    missing = true;
    assert.equal(
      (await runAsTenant("salon", () => previewPayrollRedemption(input), "staff-a")).rows[0].amount,
      null,
    );
    await assert.rejects(
      runAsTenant(
        "salon",
        () => previewPayrollRedemption({ ...input, customerId: "foreign" }),
        "staff-a",
      ),
      /not found/,
    );
    assert.equal(redemptionPreviewSchema.safeParse({ ...input, baseAmount: "999" }).success, false);
  } finally {
    paid = 10000n;
    missing = false;
  }
});
test("expired/refunded holdings are unavailable while explicit exclusion is a genuine zero", async () => {
  try {
    expired = true;
    assert.equal(
      (await runAsTenant("salon", () => previewPayrollRedemption(input), "staff-a")).baseAmount,
      null,
    );
    expired = false;
    refunded = true;
    assert.equal(
      (await runAsTenant("salon", () => previewPayrollRedemption(input), "staff-a")).baseAmount,
      null,
    );
    refunded = false;
    excluded = true;
    const data = await runAsTenant("salon", () => previewPayrollRedemption(input), "staff-a");
    assert.equal(data.baseAmount, "33.3334");
    assert.equal(data.rows[0].amount, "0.00");
  } finally {
    expired = false;
    refunded = false;
    excluded = false;
  }
});
