import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { calculatedPayrollExportState } from "./payroll-export.test-helper.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { cartPreviewSchema, previewPayrollCart } from "./payroll-cart-preview.js";
const original = prisma.$transaction;
after(() => Reflect.set(prisma, "$transaction", original));
let role = "MANAGER";
let gstEnabled = true;
let available = true;
const state = calculatedPayrollExportState();
const now = new Date();
state.periodKey = now.toISOString().slice(0, 7);
for (const statement of state.calculation!.statements) {
  statement.inputs.calculation.periodKey = state.periodKey;
  statement.inputs.calculation.lines = statement.inputs.calculation.lines.map((line) => ({
    ...line,
    businessDate: `${state.periodKey}-${line.businessDate.slice(-2)}`,
  }));
}
const D = (n: string) => new Prisma.Decimal(n);
const item = {
  id: "item",
  status: "ACTIVE",
  memberPrice: D("54.50"),
  nonmemberPrice: D("109"),
  departmentId: "hair",
  commissionSettings: {
    sale: { mode: "FIXED", amount: "7.25" },
    redemption: { mode: "FOLLOW_PLAN" },
    minimumDepositPct: "0",
  },
};
Reflect.set(prisma, "$transaction", async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    user: {
      findFirst: async () => ({ id: "staff-a", globalRole: role }),
      findMany: async () => [{ id: "staff-a", commissionRate: D("5") }],
    },
    tenant: { findUniqueOrThrow: async () => ({ timeZone: "UTC", gstEnabled }) },
    payrollClose: {
      findFirst: async () =>
        available ? { state, revision: state.revision, status: state.status } : null,
    },
    payrollCloseEvent: { findFirst: async () => ({ stateHash: payrollInputHash(state) }) },
    customer: { findFirst: async () => ({ memberId: "member" }) },
    service: { findFirst: async () => item },
    product: { findFirst: async () => item },
    package: { findFirst: async () => item },
    commissionRule: { findMany: async () => [] },
    outlet: { findFirst: async () => ({ id: "branch" }) },
  }),
);
const input = {
  itemType: "SERVICE",
  itemId: "item",
  quantity: 1,
  shares: [{ staffId: "staff-a", share: 10000 }],
};
test("server catalogue economics back out GST and membership/discount without mutating payroll", async () => {
  const before = JSON.stringify(state);
  const data = await runAsTenant("salon", () => previewPayrollCart(input), "staff-a");
  assert.equal(data.baseAmount, "100.0000");
  assert.equal(data.rows[0].amount, "10.00");
  const member = await runAsTenant(
    "salon",
    () => previewPayrollCart({ ...input, customerId: "buyer", discountPercent: 50 }),
    "staff-a",
  );
  assert.equal(member.baseAmount, "25.0000");
  assert.equal(member.rows[0].amount, "2.50");
  assert.equal(JSON.stringify(state), before);
});
test("FOC uses list price rather than a zero sale base, package fixed awards occur once per line", async () => {
  const foc = await runAsTenant(
    "salon",
    () => previewPayrollCart({ ...input, discountPercent: 100 }),
    "staff-a",
  );
  assert.equal(foc.commissionType, "FOC");
  assert.equal(foc.baseAmount, "109.0000");
  const pkg = await runAsTenant(
    "salon",
    () => previewPayrollCart({ ...input, itemType: "PACKAGE", quantity: 3 }),
    "staff-a",
  );
  assert.equal(pkg.rows[0].amount, "7.25");
});
test("staff sees SELF only, missing snapshot is unavailable and payload cannot override base or roles", async () => {
  role = "STAFF";
  gstEnabled = false;
  try {
    const own = await runAsTenant(
      "salon",
      () => runAtOutlet("branch", () => previewPayrollCart(input)),
      "staff-a",
    );
    assert.equal(own.scope, "SELF");
    assert.equal(own.baseAmount, "109.0000");
    assert.equal(JSON.stringify(own).includes("basicSalary"), false);
    available = false;
    const missing = await runAsTenant("salon", () => previewPayrollCart(input), "staff-a");
    assert.equal(missing.rows[0].amount, null);
    assert.equal(cartPreviewSchema.safeParse({ ...input, baseAmount: "999" }).success, false);
    role = "CASHIER";
    await assert.rejects(
      runAsTenant("salon", () => previewPayrollCart(input), "staff-a"),
      /Forbidden/,
    );
  } finally {
    role = "MANAGER";
    gstEnabled = true;
    available = true;
  }
});
