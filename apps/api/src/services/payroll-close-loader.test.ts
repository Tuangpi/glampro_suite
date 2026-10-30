import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAYROLL_DEFAULT_SETTINGS,
  capturePayrollPackagePurchase,
  type PayrollPackageSettings,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import {
  approvePayrollClose,
  calculatePayrollClose,
  openPayrollClose,
  payrollInputHash,
  type PayrollCloseInputs,
} from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";
import type { PayrollOpeningCarry } from "./payroll-close-opening.js";

const owner = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
const D = (value: string) => new Prisma.Decimal(value);
function packagePurchaseFixture(mode: "FOLLOW_PLAN" | "EXCLUDE" | "FIXED" = "FOLLOW_PLAN") {
  const f = valuePurchaseFixture();
  const sale = f.data.sales[0];
  sale.customerId = "customer";
  const line = sale.lines[0];
  line.itemType = "PACKAGE";
  const settings: PayrollPackageSettings = {
    sale: mode === "FIXED" ? { mode, amount: "12.34" } : { mode },
    redemption: { mode: "FOLLOW_PLAN" },
    minimumDepositPct: "30",
  };
  f.data.packageHoldings.push({
    tenantId: "salon",
    saleLineId: line.id,
    packageId: line.itemId,
    quantity: 10,
    payrollPurchaseSnapshot: capturePayrollPackagePurchase({
      saleId: sale.id,
      saleLineId: line.id,
      packageId: line.itemId,
      originalCustomerId: sale.customerId,
      outletId: sale.outletId,
      purchasedAt: sale.soldAt.toISOString(),
      currency: "SGD",
      grantedSessions: 10,
      grossCents: "10900",
      netCents: "10000",
      taxCents: "900",
      sellers: line.attribution.sellers,
      commissionSettings: settings,
    }),
  });
  const captured = f.data.events[0].evidence
    .lines[0] as (typeof f.data.events)[0]["evidence"]["lines"][number] & {
    fixedCommission?: string;
  };
  captured.commissionType = "PKG_SALE";
  captured.mode = mode;
  if (mode === "FIXED") captured.fixedCommission = "12.3400";
  return f;
}

test("full single-receipt package purchases reconcile all original sale policies", async () => {
  for (const mode of ["FOLLOW_PLAN", "EXCLUDE", "FIXED"] as const) {
    const f = packagePurchaseFixture(mode);
    const inputs = await f.load();
    const line = inputs.staff[0].calculation.lines[0];
    assert.equal(inputs.staff[0].collection, "100.0000");
    assert.equal(line.commissionType, "PKG_SALE");
    assert.equal(line.baseAmount, "100.0000");
    assert.equal(line.units, "1.0000");
    assert.equal(line.mode, mode);
    assert.equal(line.fixedCommission, mode === "FIXED" ? "12.3400" : undefined);
    assert.equal(payrollInputHash(await f.load()), payrollInputHash(inputs));
    const query = f.queries.find((row) => row.model === "customerPackageHolding")!;
    assert.deepEqual(query.args, {
      where: { tenantId: "salon", saleLineId: "line" },
      orderBy: { id: "asc" },
    });
  }
});

test("package purchases reject missing, foreign, noncanonical and changed original economics", async () => {
  for (const mutate of [
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.packageHoldings = [];
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.packageHoldings.push(f.data.packageHoldings[0]);
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.packageHoldings[0].tenantId = "other";
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.packageHoldings[0].saleLineId = "other";
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.packageHoldings[0].packageId = "other";
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.packageHoldings[0].quantity = 11;
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.packageHoldings[0].payrollPurchaseSnapshot = null;
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.sales[0].customerId = "other";
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.sales[0].lines[0].taxAmount = D("8");
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      const s = f.data.packageHoldings[0].payrollPurchaseSnapshot as Record<string, unknown>;
      s.sessionBaseFloor = "999.0000";
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      const s = f.data.packageHoldings[0].payrollPurchaseSnapshot as Record<string, unknown>;
      s.commissionSettings = null;
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.events[0].evidence.lines[0].units = "10.0000";
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.events[0].evidence.lines[0].baseAmount = "109.0000";
    },
    (f: ReturnType<typeof packagePurchaseFixture>) => {
      f.data.events[0].evidence.lines[0].mode = "EXCLUDE";
    },
  ]) {
    const f = packagePurchaseFixture();
    mutate(f);
    await assert.rejects(f.load(), /PACKAGE_PURCHASE_EVIDENCE_UNCONFIRMED/);
  }
  const fixed = packagePurchaseFixture("FIXED");
  (fixed.data.events[0].evidence.lines[0] as { fixedCommission?: string }).fixedCommission =
    "24.6800";
  await assert.rejects(fixed.load(), /PACKAGE_PURCHASE_EVIDENCE_UNCONFIRMED/);
});

test("package deposits use receipt net cash and require capture, rates and a collection", async () => {
  const partial = packagePurchaseFixture();
  partial.data.payments[0].amount = D("54.50");
  partial.data.collections[0].grossCents = 5450n;
  Object.assign(partial.data.collections[0].allocations[0], {
    grossCents: 5450n,
    netCents: 5000n,
    taxCents: 450n,
  });
  partial.data.events[0].evidence.lines[0].baseAmount = "50.0000";
  const inputs = await partial.load();
  assert.equal(inputs.staff[0].collection, "50.0000");
  assert.equal(inputs.staff[0].calculation.lines[0].baseAmount, "50.0000");
  const absent = packagePurchaseFixture();
  absent.data.collections = [];
  absent.data.payments = [];
  absent.data.events = [];
  await assert.rejects(absent.load(), /PACKAGE_COLLECTION_REQUIRED/);
  const missing = packagePurchaseFixture();
  missing.data.events = [];
  await assert.rejects(missing.load(), /PACKAGE_COLLECTION_CAPTURE_MISSING/);
  const rate = packagePurchaseFixture();
  rate.data.events[0].evidence.lines[0].fallbackRatePct = "10";
  await assert.rejects(rate.load(), /RATE_PROVENANCE_UNCONFIRMED/);
  const multiple = packagePurchaseFixture();
  const current = multiple.data.collections[0];
  const prior = {
    ...current,
    id: "prior",
    createdAt: new Date("2026-09-14T00:00:00Z"),
    grossCents: 5450n,
    allocations: [
      { ...current.allocations[0], grossCents: 5450n, netCents: 5000n, taxCents: 450n },
    ],
  };
  current.grossCents = 5450n;
  Object.assign(current.allocations[0], { grossCents: 5450n, netCents: 5000n, taxCents: 450n });
  multiple.data.payments[0].amount = D("54.50");
  multiple.tx.commissionCollection.findMany = (async (args: { where: { saleId?: string } }) =>
    args.where.saleId
      ? [prior, current]
      : [current]) as unknown as typeof multiple.tx.commissionCollection.findMany;
  await assert.rejects(multiple.load(), /PACKAGE_COLLECTION_HISTORY_UNCONFIRMED/);
});

function packageInstalmentFixture(mode: "FOLLOW_PLAN" | "EXCLUDE" | "FIXED" = "FIXED") {
  const f = packagePurchaseFixture(mode);
  const first = f.data.collections[0];
  first.grossCents = 3270n;
  Object.assign(first.allocations[0], { grossCents: 3270n, netCents: 3000n, taxCents: 270n });
  f.data.payments[0].amount = D("32.70");
  const at = new Date("2026-09-20T00:00:00Z");
  const next = {
    ...first,
    id: "collection-2",
    sourceId: "payment-2",
    createdAt: at,
    occurredAt: at,
    grossCents: 7630n,
    allocations: [
      {
        ...first.allocations[0],
        id: "allocation-2",
        collectionId: "collection-2",
        grossCents: 7630n,
        netCents: 7000n,
        taxCents: 630n,
      },
    ],
  };
  f.data.collections.push(next);
  f.data.payments.push({
    ...f.data.payments[0],
    id: "payment-2",
    amount: D("76.30"),
    createdAt: at,
  });
  const event = f.data.events[0];
  event.evidence.lines[0].baseAmount = "30.0000";
  const later = structuredClone(event);
  later.id = "capture-2";
  later.sourceId = "allocation-2";
  later.sourceKey = "collection:allocation-2";
  later.occurredAt = later.createdAt = at;
  later.evidence.rateProvenance.rateAt = at.toISOString();
  Object.assign(later.evidence.lines[0], {
    id: "base-2",
    businessDate: "2026-09-20",
    baseAmount: "70.0000",
    units: "0.0000",
    ...(mode === "FIXED" ? { fixedCommission: "0.0000" } : {}),
  });
  f.data.events.push(later);
  return f;
}

function crossMonthPackageFixture(
  mode: "FOLLOW_PLAN" | "EXCLUDE" | "FIXED" = "FIXED",
  outstanding = false,
) {
  const f = outstanding ? packageOutstandingFixture(mode) : packageInstalmentFixture(mode);
  const at = new Date("2026-08-31T15:59:59.999Z");
  const sale = f.data.sales[0];
  sale.soldAt = at;
  const purchase = f.data.packageHoldings[0].payrollPurchaseSnapshot as ReturnType<
    typeof capturePayrollPackagePurchase
  >;
  purchase.purchasedAt = at.toISOString();
  f.data.collections[0].occurredAt = f.data.collections[0].createdAt = at;
  f.data.payments[0].createdAt = at;
  const event = f.data.events[0];
  event.occurredAt = event.createdAt = at;
  event.evidence.rateProvenance.rateAt = at.toISOString();
  event.evidence.lines[0].businessDate = "2026-08-31";
  type Query = { where: { saleId?: string; createdAt?: unknown; occurredAt?: unknown } };
  f.tx.sale.findMany = (async () => []) as typeof f.tx.sale.findMany;
  f.tx.commissionCollection.findMany = (async ({ where }: Query) =>
    where.saleId
      ? f.data.collections
      : f.data.collections.slice(1)) as unknown as typeof f.tx.commissionCollection.findMany;
  f.tx.salePayment.findMany = (async ({ where }: Query) =>
    where.saleId
      ? f.data.payments.slice(0, 1)
      : f.data.payments.slice(1)) as unknown as typeof f.tx.salePayment.findMany;
  f.tx.payrollSourceEvent.findMany = (async ({ where }: Query) =>
    where.saleId
      ? f.data.events.slice(0, 1)
      : f.data.events.slice(1)) as unknown as typeof f.tx.payrollSourceEvent.findMany;
  f.tx.customerOutstandingPayment.findMany = (async ({ where }: Query) =>
    where.saleId
      ? []
      : f.data.outstanding) as unknown as typeof f.tx.customerOutstandingPayment.findMany;
  return f;
}

test("cross-month package history verifies prior cash without repeating its bases, units or awards", async () => {
  for (const mode of ["FOLLOW_PLAN", "EXCLUDE", "FIXED"] as const) {
    for (const outstanding of [false, true]) {
      const f = crossMonthPackageFixture(mode, outstanding);
      const inputs = await f.load();
      assert.equal(inputs.staff[0].collection, "70.0000");
      assert.equal(inputs.staff[0].calculation.lines.length, 1);
      const line = inputs.staff[0].calculation.lines[0];
      assert.equal(line.baseAmount, "70.0000");
      assert.equal(line.units, "0.0000");
      assert.equal(line.mode, mode);
      assert.equal(line.fixedCommission, mode === "FIXED" ? "0.0000" : undefined);
      assert.equal(payrollInputHash(await f.load()), payrollInputHash(inputs));
    }
  }
});

test("cross-month package history rejects missing or altered historical payment and capture evidence", async () => {
  for (const mutate of [
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.payments.shift();
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.payments[0].amount = D("32.69");
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.payments[0].tenantId = "foreign";
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.payments[0].sessionId = "unsettled";
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.events.shift();
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.events[0].saleId = "other";
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.events[0].evidence.lines[0].units = "0.0000";
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.events[0].evidence.lines[0].fixedCommission = "0.0000";
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.events[0].evidence.lines[0].fallbackRatePct = "10";
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.collections[0].allocations[0].netCents += 1n;
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.events[1].evidence.lines[0].units = "1.0000";
    },
    (f: ReturnType<typeof crossMonthPackageFixture>) => {
      f.data.events[1].evidence.lines[0].fixedCommission = "12.3400";
    },
  ]) {
    const f = crossMonthPackageFixture();
    mutate(f);
    await assert.rejects(f.load(), /Authoritative payroll inputs unavailable/);
  }
});

test("historical evidence changes invalidate a cross-month draft without adding prior cash", async () => {
  const f = crossMonthPackageFixture();
  const inputs = await f.load();
  const draft = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  f.data.events[0].createdAt = new Date("2026-08-31T16:00:01.000Z");
  const changed = await f.load();
  assert.equal(changed.staff[0].collection, "70.0000");
  assert.throws(
    () => approvePayrollClose(draft, 1, changed, owner, "2026-10-01T01:00:00.000Z", "Review"),
    /inputs changed/,
  );
});

test("same-month package instalments reconcile net cash with units and fixed award only once", async () => {
  for (const mode of ["FOLLOW_PLAN", "EXCLUDE", "FIXED"] as const) {
    const f = packageInstalmentFixture(mode);
    const inputs = await f.load();
    assert.equal(inputs.staff[0].collection, "100.0000");
    const lines = inputs.staff[0].calculation.lines;
    assert.deepEqual(lines.map((row) => row.baseAmount).sort(), ["30.0000", "70.0000"]);
    assert.deepEqual(lines.map((row) => row.units).sort(), ["0.0000", "1.0000"]);
    if (mode === "FIXED")
      assert.deepEqual(lines.map((row) => row.fixedCommission).sort(), ["0.0000", "12.3400"]);
    f.data.events[1].evidence.lines[0].units = "1.0000";
    await assert.rejects(f.load(), /PACKAGE_PURCHASE_EVIDENCE_UNCONFIRMED/);
  }
  const fixed = packageInstalmentFixture();
  fixed.data.events[1].evidence.lines[0].fixedCommission = "12.3400";
  await assert.rejects(fixed.load(), /PACKAGE_PURCHASE_EVIDENCE_UNCONFIRMED/);
});

function packageOutstandingFixture(mode: "FOLLOW_PLAN" | "EXCLUDE" | "FIXED" = "FIXED") {
  const f = packageInstalmentFixture(mode);
  const receipt = f.data.collections[1];
  receipt.sourceType = "OUTSTANDING_PAYMENT";
  const payment = f.data.payments.pop()!;
  const outstanding = { id: "debt", tenantId: "salon", saleId: "sale", customerId: "customer" };
  const balance = {
    id: payment.id,
    tenantId: "salon",
    saleId: "sale",
    customerId: "customer",
    outstandingId: outstanding.id,
    paidAmount: payment.amount,
    paidAt: payment.createdAt,
    outstanding,
    sale: f.data.sales[0],
  };
  f.data.outstanding.push(balance);
  return { ...f, balance };
}

test("same-month outstanding package balances add only collected net without repeating award or units", async () => {
  for (const mode of ["FOLLOW_PLAN", "EXCLUDE", "FIXED"] as const) {
    const f = packageOutstandingFixture(mode);
    const inputs = await f.load();
    assert.equal(inputs.staff[0].collection, "100.0000");
    const later = inputs.staff[0].calculation.lines.find((row) => row.units === "0.0000")!;
    assert.equal(later.baseAmount, "70.0000");
    assert.equal(later.mode, mode);
    assert.equal(later.fixedCommission, mode === "FIXED" ? "0.0000" : undefined);
    assert.equal(payrollInputHash(await f.load()), payrollInputHash(inputs));
  }
});

test("outstanding package balances reject foreign or mismatched payment/debt identity", async () => {
  for (const mutate of [
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.balance.tenantId = "other";
    },
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.balance.sale.tenantId = "other";
    },
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.balance.saleId = "other";
    },
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.balance.customerId = "other";
    },
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.balance.outstandingId = "other";
    },
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.balance.outstanding.tenantId = "other";
    },
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.balance.outstanding.saleId = "other";
    },
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.balance.outstanding.customerId = "other";
    },
  ]) {
    const f = packageOutstandingFixture();
    mutate(f);
    await assert.rejects(f.load(), /OUTSTANDING_PAYMENT_IDENTITY_UNCONFIRMED/);
  }
});

test("outstanding package receipts require independently matching payment amount, time and capture", async () => {
  for (const mutate of [
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.data.outstanding = [];
    },
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.balance.paidAmount = D("76.29");
    },
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.balance.paidAt = new Date("2026-09-21T00:00:00Z");
    },
    (f: ReturnType<typeof packageOutstandingFixture>) => {
      f.data.collections[1].sourceId = "other";
    },
  ]) {
    const f = packageOutstandingFixture();
    mutate(f);
    await assert.rejects(f.load(), /PACKAGE_COLLECTION_PAYMENT_UNCONFIRMED/);
  }
  const missing = packageOutstandingFixture();
  missing.data.events.pop();
  await assert.rejects(missing.load(), /PACKAGE_COLLECTION_CAPTURE_MISSING/);
  const changed = packageOutstandingFixture();
  const inputs = await changed.load();
  const draft = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  changed.balance.outstanding.id = "new-debt";
  changed.balance.outstandingId = "new-debt";
  const awaitInputs = await changed.load();
  assert.throws(
    () => approvePayrollClose(draft, 1, awaitInputs, owner, "2026-10-01T01:00:00.000Z", "Review"),
    /inputs changed/,
  );
});

test("historical package purchases allow later deposits but still require an original sale-payment deposit", async () => {
  const historical = packageOutstandingFixture();
  historical.data.sales[0].soldAt = new Date("2026-08-15T00:00:00Z");
  const snapshot = historical.data.packageHoldings[0].payrollPurchaseSnapshot as ReturnType<
    typeof capturePayrollPackagePurchase
  >;
  snapshot.purchasedAt = historical.data.sales[0].soldAt.toISOString();
  assert.equal((await historical.load()).staff[0].collection, "100.0000");
  const first = packageOutstandingFixture();
  first.data.collections[0].sourceType = "OUTSTANDING_PAYMENT";
  await assert.rejects(first.load(), /PACKAGE_COLLECTION_HISTORY_UNCONFIRMED/);
  const duplicated = packageOutstandingFixture();
  duplicated.data.collections[1].sourceId = duplicated.data.collections[0].sourceId;
  await assert.rejects(duplicated.load(), /PACKAGE_COLLECTION_PAYMENT_UNCONFIRMED/);
});

test("package deposit threshold rounds up and ambiguous, foreign or out-of-period history blocks close", async () => {
  const rounded = packageInstalmentFixture();
  const original = rounded.data.packageHoldings[0].payrollPurchaseSnapshot as ReturnType<
    typeof capturePayrollPackagePurchase
  >;
  const {
    version: _version,
    status: _status,
    sessionBaseFloor: _floor,
    extraBaseTickSessions: _extra,
    missingEvidence: _missing,
    ...purchase
  } = original;
  rounded.data.packageHoldings[0].payrollPurchaseSnapshot = capturePayrollPackagePurchase({
    ...purchase,
    commissionSettings: { ...purchase.commissionSettings!, minimumDepositPct: "30.01" },
  });
  // 10900 * 30.01% = 3271.09 cents; the required deposit is 3272, never 3271.
  rounded.data.collections[0].grossCents = 3271n;
  Object.assign(rounded.data.collections[0].allocations[0], {
    grossCents: 3271n,
    netCents: 3001n,
    taxCents: 270n,
  });
  rounded.data.payments[0].amount = D("32.71");
  await assert.rejects(rounded.load(), /PACKAGE_MINIMUM_DEPOSIT_UNCONFIRMED/);
  const under = packageInstalmentFixture();
  under.data.collections[0].grossCents = 3269n;
  Object.assign(under.data.collections[0].allocations[0], {
    grossCents: 3269n,
    netCents: 2999n,
    taxCents: 270n,
  });
  under.data.payments[0].amount = D("32.69");
  await assert.rejects(under.load(), /PACKAGE_MINIMUM_DEPOSIT_UNCONFIRMED/);
  for (const mutate of [
    (f: ReturnType<typeof packageInstalmentFixture>) => {
      f.data.collections[1].createdAt = f.data.collections[0].createdAt;
    },
    (f: ReturnType<typeof packageInstalmentFixture>) => {
      f.data.collections[1].occurredAt = new Date("2026-10-01T00:00:00Z");
    },
    (f: ReturnType<typeof packageInstalmentFixture>) => {
      f.data.collections[1].tenantId = "foreign";
    },
    (f: ReturnType<typeof packageInstalmentFixture>) => {
      f.data.collections[1].sourceType = "OUTSTANDING_PAYMENT";
    },
    (f: ReturnType<typeof packageInstalmentFixture>) => {
      f.data.events.pop();
    },
    (f: ReturnType<typeof packageInstalmentFixture>) => {
      f.data.payments.pop();
    },
  ]) {
    const f = packageInstalmentFixture();
    mutate(f);
    await assert.rejects(
      f.load(),
      /PACKAGE_COLLECTION_HISTORY_UNCONFIRMED|PACKAGE_COLLECTION_PAYMENT_UNCONFIRMED|PACKAGE_COLLECTION_CAPTURE_MISSING|CASH_RECONCILIATION_UNAVAILABLE/,
    );
  }
  const incomplete = packageInstalmentFixture();
  const history = [...incomplete.data.collections];
  incomplete.tx.commissionCollection.findMany = (async (args: { where: { saleId?: string } }) =>
    args.where.saleId
      ? history
      : [history[1]]) as unknown as typeof incomplete.tx.commissionCollection.findMany;
  await assert.rejects(incomplete.load(), /PACKAGE_COLLECTION_HISTORY_UNCONFIRMED/);
  const tax = packageInstalmentFixture();
  tax.data.collections[1].allocations[0].netCents += 1n;
  tax.data.collections[1].allocations[0].taxCents -= 1n;
  await assert.rejects(tax.load(), /OPERATIONAL_COLLECTION_TAX_MISMATCH/);
  const gateway = packageInstalmentFixture();
  gateway.data.payments[1].sessionId = "unsettled";
  await assert.rejects(gateway.load(), /GATEWAY_SETTLEMENT_UNCONFIRMED/);
});

test("fixed package award splits once per sale line and changed award invalidates approval", async () => {
  const f = packagePurchaseFixture("FIXED");
  const shares = [
    { staffId: "staff", share: 3333 },
    { staffId: "owner", share: 6667 },
  ];
  f.data.staff.push({ tenantId: "salon", id: "owner", name: "Owner", disabled: false });
  f.data.configuration.push(
    ...f.data.configuration
      .slice(1)
      .map((row) => ({ ...row, id: `${row.id}-owner`, targetId: "owner" })),
  );
  f.data.sales[0].lines[0].attribution.sellers = shares;
  f.data.collections[0].allocations[0].evidence.sellers = shares;
  const original = f.data.packageHoldings[0].payrollPurchaseSnapshot as ReturnType<
    typeof capturePayrollPackagePurchase
  >;
  const {
    version: _version,
    status: _status,
    sessionBaseFloor: _floor,
    extraBaseTickSessions: _extra,
    missingEvidence: _missing,
    ...input
  } = original;
  const purchaseInput = { ...input, sellers: shares };
  f.data.packageHoldings[0].payrollPurchaseSnapshot = capturePayrollPackagePurchase(purchaseInput);
  const event = f.data.events[0];
  event.evidence.lines = [
    {
      ...event.evidence.lines[0],
      baseAmount: "33.3300",
      units: "0.3333",
      fixedCommission: "4.1129",
    },
    {
      ...event.evidence.lines[0],
      id: "owner-base",
      staffId: "owner",
      baseAmount: "66.6700",
      units: "0.6667",
      fixedCommission: "8.2271",
    },
  ] as typeof event.evidence.lines;
  event.evidence.rateProvenance.selections.push({
    ...event.evidence.rateProvenance.selections[0],
    staffId: "owner",
  });
  const inputs = await f.load();
  assert.equal(inputs.staff.find((row) => row.staff.id === "staff")!.collection, "33.3300");
  assert.equal(inputs.staff.find((row) => row.staff.id === "owner")!.collection, "66.6700");
  const draft = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  f.data.packageHoldings[0].payrollPurchaseSnapshot = capturePayrollPackagePurchase({
    ...purchaseInput,
    commissionSettings: {
      ...purchaseInput.commissionSettings!,
      sale: { mode: "FIXED", amount: "15" },
    },
  });
  (event.evidence.lines[0] as { fixedCommission?: string }).fixedCommission = "4.9995";
  (event.evidence.lines[1] as { fixedCommission?: string }).fixedCommission = "10.0005";
  const changed = await f.load();
  assert.throws(
    () => approvePayrollClose(draft, 1, changed, owner, "2026-10-01T01:00:00.000Z", "Review"),
    /inputs changed/,
  );
});

test("package purchase uses historical package-sale rules and fixed award is not multiplied by units", async () => {
  const f = packagePurchaseFixture("FIXED");
  f.data.sales[0].lines[0].quantity = 2;
  const event = f.data.events[0];
  event.evidence.lines[0].units = "2.0000";
  event.evidence.lines[0].fallbackRatePct = "7";
  event.evidence.rateProvenance.selections[0].selection = {
    rate: "7",
    source: "PACKAGE",
    ruleId: "historical-package",
  };
  const rule = {
    id: "historical-package",
    tenantId: "salon",
    staffId: null,
    itemKind: "PACKAGE_SALE",
    scope: "PACKAGE",
    targetId: "service",
    rate: D("7"),
    effectiveAt: new Date("2026-09-01T00:00:00Z"),
    createdAt: new Date("2026-09-01T00:00:00Z"),
  };
  f.tx.commissionRule.findMany = (async () => [
    rule,
    { ...rule, id: "later-package", rate: D("90"), createdAt: new Date("2026-10-01T00:00:00Z") },
  ]) as unknown as typeof f.tx.commissionRule.findMany;
  const inputs = await f.load();
  assert.equal(inputs.staff[0].calculation.lines[0].fallbackRatePct, "7");
  assert.equal(inputs.staff[0].calculation.lines[0].fixedCommission, "12.3400");
  assert.equal(inputs.staff[0].calculation.lines[0].units, "2.0000");
  rule.itemKind = "SERVICE";
  await assert.rejects(f.load(), /RATE_PROVENANCE_UNCONFIRMED/);
});
function valuePurchaseFixture() {
  const f = loaderFixture();
  const line = f.data.sales[0].lines[0];
  line.itemType = "VALUE_PACKAGE";
  const event = f.data.events[0];
  event.sourceType = "COLLECTION";
  event.sourceId = "allocation";
  event.sourceKey = "collection:allocation";
  event.evidence.lines[0].commissionType = "VP_SALE";
  event.evidence.lines[0].fallbackRatePct = "0";
  event.evidence.rateProvenance.selections[0].selection = {
    rate: "0",
    source: "NONE",
    ruleId: null,
  };
  f.data.valueHoldings.push({
    tenantId: "salon",
    saleLineId: line.id,
    valuePackageId: line.itemId,
    amount: D("150"),
    payrollPurchaseSnapshot: {
      version: 1,
      saleId: "sale",
      saleLineId: "line",
      currency: "SGD",
      paidNet: "100.00",
      credit: "150.00",
      sellers: line.attribution.sellers,
    },
  });
  return f;
}

test("value purchase uses collected net cash, not bonus credit, and inventories its capture", async () => {
  const f = valuePurchaseFixture();
  const inputs = await f.load();
  assert.equal(inputs.staff[0].collection, "100.0000");
  assert.equal(inputs.staff[0].calculation.lines[0].commissionType, "VP_SALE");
  assert.equal(inputs.staff[0].calculation.lines[0].baseAmount, "100.0000");
  assert.equal(inputs.staff[0].calculation.lines[0].units, "1.0000");
  assert.equal(payrollInputHash(await f.load()), payrollInputHash(inputs));
  const query = f.queries.find((row) => row.model === "customerValuePackageHolding")!;
  assert.deepEqual(query.args, {
    where: { tenantId: "salon", saleLineId: "line" },
    orderBy: { id: "asc" },
  });
});

test("value purchase independently rejects missing, foreign, duplicate or mismatched evidence", async () => {
  for (const mutate of [
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.valueHoldings = [];
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.valueHoldings.push(f.data.valueHoldings[0]);
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.valueHoldings[0].tenantId = "other";
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.valueHoldings[0].saleLineId = "other";
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.valueHoldings[0].valuePackageId = "other";
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.valueHoldings[0].amount = D("151");
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.valueHoldings[0].payrollPurchaseSnapshot = null;
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.sales[0].lines[0].taxAmount = D("8");
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.sales[0].lines[0].attribution.sellers = [{ staffId: "other", share: 10000 }];
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.events[0].evidence.lines[0].baseAmount = "150.0000";
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.events[0].evidence.lines[0].units = "2.0000";
    },
    (f: ReturnType<typeof valuePurchaseFixture>) => {
      f.data.events[0].evidence.lines[0].mode = "EXCLUDE";
    },
  ]) {
    const f = valuePurchaseFixture();
    mutate(f);
    await assert.rejects(f.load(), /VALUE_PURCHASE_EVIDENCE_UNCONFIRMED/);
  }
});

test("value collections require capture and stored-credit historical rate, not service fallback", async () => {
  const missing = valuePurchaseFixture();
  missing.data.events = [];
  await assert.rejects(missing.load(), /VALUE_COLLECTION_CAPTURE_MISSING/);
  const rate = valuePurchaseFixture();
  rate.data.events[0].evidence.lines[0].fallbackRatePct = "10";
  await assert.rejects(rate.load(), /RATE_PROVENANCE_UNCONFIRMED/);
});

test("later value instalments retain purchase evidence and contribute zero repeated units", async () => {
  const f = valuePurchaseFixture();
  const prior = structuredClone(f.data.collections[0]);
  prior.id = "prior-collection";
  prior.sourceId = "prior-payment";
  prior.createdAt = prior.occurredAt = new Date("2026-08-15T00:00:00Z");
  prior.grossCents = 5450n;
  prior.allocations[0] = {
    ...prior.allocations[0],
    id: "prior-allocation",
    collectionId: prior.id,
    grossCents: 5450n,
    netCents: 5000n,
    taxCents: 450n,
  };
  const current = f.data.collections[0];
  current.grossCents = 5450n;
  Object.assign(current.allocations[0], { grossCents: 5450n, netCents: 5000n, taxCents: 450n });
  f.data.payments[0].amount = D("54.50");
  f.data.sales[0].soldAt = prior.occurredAt;
  f.data.events[0].evidence.lines[0].baseAmount = "50.0000";
  f.data.events[0].evidence.lines[0].units = "0.0000";
  f.tx.commissionCollection.findMany = (async (args: { where: { saleId?: string } }) =>
    args.where.saleId
      ? [prior, current]
      : [current]) as unknown as typeof f.tx.commissionCollection.findMany;
  const inputs = await f.load();
  assert.equal(inputs.staff[0].collection, "50.0000");
  assert.equal(inputs.staff[0].calculation.lines[0].units, "0.0000");
  f.data.events[0].evidence.lines[0].units = "1.0000";
  await assert.rejects(f.load(), /VALUE_PURCHASE_EVIDENCE_UNCONFIRMED/);
  f.data.events[0].evidence.lines[0].units = "0.0000";
  prior.createdAt = current.createdAt;
  await assert.rejects(f.load(), /VALUE_COLLECTION_ORDER_UNCONFIRMED/);
});

test("value purchase split residuals reconcile per seller and invalidate stale approval", async () => {
  const f = valuePurchaseFixture();
  const shares = [
    { staffId: "staff", share: 3333 },
    { staffId: "owner", share: 6667 },
  ];
  f.data.staff.push({ tenantId: "salon", id: "owner", name: "Owner", disabled: false });
  f.data.configuration.push(
    ...f.data.configuration
      .slice(1)
      .map((row) => ({ ...row, id: `${row.id}-owner`, targetId: "owner" })),
  );
  f.data.sales[0].lines[0].attribution.sellers = shares;
  f.data.collections[0].allocations[0].evidence.sellers = shares;
  const holding = f.data.valueHoldings[0];
  const snapshot = holding.payrollPurchaseSnapshot as { sellers: typeof shares; credit: string };
  snapshot.sellers = shares;
  const event = f.data.events[0];
  event.evidence.lines = [
    { ...event.evidence.lines[0], baseAmount: "33.3300", units: "0.3333" },
    {
      ...event.evidence.lines[0],
      id: "owner-base",
      staffId: "owner",
      baseAmount: "66.6700",
      units: "0.6667",
    },
  ];
  event.evidence.rateProvenance.selections.push({
    ...event.evidence.rateProvenance.selections[0],
    staffId: "owner",
  });
  const inputs = await f.load();
  assert.equal(inputs.staff.find((row) => row.staff.id === "staff")!.collection, "33.3300");
  assert.equal(inputs.staff.find((row) => row.staff.id === "owner")!.collection, "66.6700");
  const draft = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  holding.amount = D("151");
  snapshot.credit = "151.00";
  const changed = await f.load();
  assert.notEqual(payrollInputHash(inputs), payrollInputHash(changed));
  assert.throws(
    () => approvePayrollClose(draft, 1, changed, owner, "2026-10-01T01:00:00.000Z", "Review"),
    /inputs changed/,
  );
});

export function loaderFixture() {
  const previousInputs: PayrollCloseInputs = {
    periodKey: "2026-08",
    timeZone: "Asia/Singapore",
    currency: "SGD",
    startsAt: "2026-07-31T16:00:00.000Z",
    endsAt: "2026-08-31T16:00:00.000Z",
    evidence: { syntheticPrior: true },
    staff: [],
  };
  const priorDraft = calculatePayrollClose(
    openPayrollClose("2026-08"),
    0,
    previousInputs,
    owner,
    "2026-09-01T00:00:00.000Z",
  );
  const prior = approvePayrollClose(
    priorDraft,
    1,
    previousInputs,
    owner,
    "2026-09-01T00:00:00.000Z",
    "Reviewed prior month",
  );
  const event = (kind: string, targetId: string, payload: unknown) => ({
    id: `${kind}-${targetId}`,
    tenantId: "salon",
    kind,
    targetId,
    payload,
    revision: 1,
    createdAt: new Date("2026-08-01T00:00:00Z"),
  });
  const shares = [{ staffId: "staff", share: 10000 }];
  const line = {
    tenantId: "salon",
    id: "line",
    saleId: "sale",
    itemType: "SERVICE",
    itemId: "service",
    quantity: 1,
    lineTotal: D("109"),
    voucherDiscountAmount: D("0"),
    taxAmount: D("9"),
    payrollEconomics: null as unknown,
    attribution: { sellers: shares, performers: shares },
  };
  const sale = {
    tenantId: "salon",
    id: "sale",
    status: "COMPLETED",
    outletId: "branch",
    collectionCurrency: "SGD",
    customerId: null as string | null,
    soldAt: new Date("2026-09-15T00:00:00Z"),
    voidedAt: null,
    lines: [line],
  };
  const capture = {
    tenantId: "salon",
    id: "capture",
    sourceKey: "sale-line:line",
    sourceType: "SALE_LINE",
    sourceId: "line",
    saleId: "sale",
    outletId: "branch",
    occurredAt: sale.soldAt,
    createdAt: sale.soldAt,
    evidence: {
      version: 1,
      status: "CAPTURED",
      postingStatus: "PENDING_RELEASE",
      currency: "SGD",
      itemId: "service",
      rateProvenance: {
        version: 1,
        rateAt: sale.soldAt.toISOString(),
        itemId: "service",
        category: null as string | null,
        selections: [
          {
            staffId: "staff",
            legacyServiceRate: "10",
            selection: { rate: "10", source: "LEGACY_STAFF", ruleId: null as string | null },
          },
        ],
      },
      lines: [
        {
          id: "base",
          staffId: "staff",
          outletId: "branch",
          commissionType: "SVC",
          baseAmount: "100.0000",
          units: "1.0000",
          businessDate: "2026-09-15",
          mode: "FOLLOW_PLAN",
          status: "EARNED",
          fallbackRatePct: "10",
          ...({} as { fixedCommission?: string }),
        },
      ],
    },
  };
  const data = {
    sales: [sale],
    payments: [
      {
        tenantId: "salon",
        id: "payment",
        saleId: "sale",
        method: "CASH",
        sessionId: null as string | null,
        amount: D("109"),
        createdAt: sale.soldAt,
        sale,
      },
    ],
    outstanding: [] as unknown[],
    redemptions: [] as unknown[],
    refunds: [] as unknown[],
    events: [capture],
    legacy: [] as unknown[],
    packageHoldings: [] as {
      tenantId: string;
      saleLineId: string;
      packageId: string;
      quantity: number;
      payrollPurchaseSnapshot: unknown;
    }[],
    valueHoldings: [] as {
      tenantId: string;
      saleLineId: string;
      valuePackageId: string;
      amount: Prisma.Decimal;
      payrollPurchaseSnapshot: unknown;
    }[],
    configuration: [
      event("SETTINGS", "company", PAYROLL_DEFAULT_SETTINGS),
      event("STAFF", "staff", {
        joinDate: "2020-01-01",
        stageEndOverride: null,
        commissionRole: "NON_COMMISSION",
      }),
      event("PROFILE", "staff", {
        basicSalary: "2000",
        fixedOvertime: "0",
        levy: "0",
        salesAlertPct: "50",
      }),
    ],
    staff: [{ tenantId: "salon", id: "staff", name: "Staff", disabled: false }],
    prepaidSettlements: [] as {
      id: string;
      tenantId: string;
      itemType: "PACKAGE" | "VALUE_PACKAGE";
      holdingId: string;
      sourceKey: string;
    }[],
    collections: [
      {
        tenantId: "salon",
        id: "collection",
        createdAt: sale.soldAt,
        sourceType: "SALE_PAYMENT",
        sourceId: "payment",
        saleId: "sale",
        currency: "SGD",
        grossCents: 10900n,
        occurredAt: sale.soldAt,
        allocations: [
          {
            tenantId: "salon",
            id: "allocation",
            collectionId: "collection",
            saleLineId: "line",
            grossCents: 10900n,
            netCents: 10000n,
            taxCents: 900n,
            evidence: { version: 1, attributionStatus: "KNOWN", sellers: shares },
          },
        ],
      },
    ],
    prior: {
      id: "prior",
      tenantId: "salon",
      periodKey: "2026-08",
      status: "APPROVED",
      revision: prior.revision,
      state: prior,
    },
    usageCount: 0,
  };
  const queries: { model: string; args: unknown }[] = [];
  const many = (model: string, read: () => unknown) => ({
    findMany: async (args: unknown) => {
      queries.push({ model, args });
      return read();
    },
  });
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    tenant: { findUniqueOrThrow: async () => ({ id: "salon", timeZone: "Asia/Singapore" }) },
    user: {
      ...many("user", () => data.staff),
      findFirst: async () => ({
        id: owner.id,
        globalRole: "SUPER_ADMIN",
        disabled: false,
        twoFactorEnabled: true,
      }),
    },
    sale: {
      ...many("sale", () => data.sales),
      findFirstOrThrow: async () => sale,
      findFirst: async () => sale,
    },
    salePayment: many("salePayment", () => data.payments),
    customerOutstandingPayment: many("customerOutstandingPayment", () => data.outstanding),
    customerRedemption: {
      ...many("customerRedemption", () => data.redemptions),
      count: async (args: { where?: { itemType?: string } }) =>
        args.where?.itemType === "VALUE_PACKAGE" ? 0 : data.usageCount,
    },
    saleRefund: many("saleRefund", () => data.refunds),
    prepaidRefundSettlement: many("prepaidRefundSettlement", () => data.prepaidSettlements),
    commissionRedemptionSnapshot: many("commissionRedemptionSnapshot", () => []),
    payrollSourceEvent: many("payrollSourceEvent", () => data.events),
    payrollConfigurationEvent: many("payrollConfigurationEvent", () => data.configuration),
    payrollPlanVersion: many("payrollPlanVersion", () => []),
    commissionCollection: many("commissionCollection", () => data.collections),
    employeeCommission: many("employeeCommission", () => data.legacy),
    payrollClose: {
      ...many("payrollClose", () => [data.prior]),
      findFirst: async () => data.prior,
    },
    payrollCloseEvent: {
      findFirst: async () => ({
        stateHash: payrollInputHash(data.prior.state),
        state: data.prior.state,
      }),
    },
    payrollCarryAuthorization: many("payrollCarryAuthorization", () => []),
    commissionRule: many("commissionRule", () => []),
    customerValuePackageHolding: many("customerValuePackageHolding", () => data.valueHoldings),
    customerPackageHolding: {
      ...many("customerPackageHolding", () => data.packageHoldings),
      findFirst: async () => null,
    },
  } as unknown as PayrollCloseTransaction;
  const load = () =>
    runAsTenant(
      "salon",
      () => loadAuthoritativePayrollCloseInputs(tx, openPayrollClose("2026-09")),
      "owner",
    );
  return { data, tx, load, queries };
}

for (const paidType of ["SERVICE", "PRODUCT"] as const) {
  test(`cross-month ${paidType} refund retains FOC lineage, refuses corrupt inventories and invalidates approval`, async () => {
    const f = loaderFixture();
    const { data, tx } = f;
    const sale = Object.assign(data.sales[0], {
      totalAmount: D("109"),
      paidAmount: D("109"),
      taxAmount: D("9"),
    });
    const paid = sale.lines[0];
    paid.itemType = paidType;
    const original = data.events[0];
    if (paidType === "PRODUCT") {
      original.evidence.lines[0].commissionType = "PRD";
      original.evidence.lines[0].fallbackRatePct = "0";
      original.evidence.rateProvenance.selections[0].selection = {
        rate: "0",
        source: "NONE",
        ruleId: null,
      };
    }
    sale.lines.push({
      ...paid,
      id: "foc",
      itemType: "SERVICE",
      itemId: "free-service",
      quantity: 2,
      lineTotal: D("0"),
      taxAmount: D("0"),
      payrollEconomics: {
        version: 1,
        saleId: sale.id,
        saleLineId: "foc",
        itemId: "free-service",
        itemType: "SERVICE",
        soldAt: sale.soldAt.toISOString(),
        listUnitPrice: "49.20",
        netLineAmount: "0.00",
        originalQuantity: 2,
        coveredPackageQuantity: 0,
        category: null,
      },
    });
    const free = {
      ...original,
      id: "free-capture",
      sourceId: "foc",
      sourceKey: "sale-line:foc",
      evidence: {
        ...original.evidence,
        itemId: "free-service",
        rateProvenance: {
          ...original.evidence.rateProvenance,
          itemId: "free-service",
          selections: [
            {
              staffId: "staff",
              legacyServiceRate: "10",
              selection: { rate: "5", source: "FOC_DEFAULT", ruleId: null },
            },
          ],
        },
        lines: [
          {
            ...original.evidence.lines[0],
            id: "free-base",
            commissionType: "FOC",
            fallbackRatePct: "5",
            baseAmount: "98.4000",
            units: "2.0000",
          },
        ],
      },
    };
    data.events.push(free);
    const at = new Date("2026-10-02T00:00:00Z");
    const refund = {
      id: "refund",
      tenantId: "salon",
      saleId: sale.id,
      amount: D("109"),
      refundedAt: at,
      refundedById: "owner",
      reason: "Full refund",
      payouts: [{ method: "CASH", amount: "109.00" }],
    };
    data.refunds.push(refund);
    for (const event of [original, free])
      data.events.push({
        ...event,
        id: `reverse-${event.id}`,
        sourceType: "REVERSAL",
        sourceId: event.id,
        sourceKey: `refund:sale:${event.id}`,
        occurredAt: at,
        createdAt: at,
        ...{ actorId: "owner", reason: refund.reason },
        evidence: {
          ...event.evidence,
          ...{ originalEventId: event.id },
          lines: event.evidence.lines.map((line) => ({
            ...line,
            id: `reverse-${line.id}`,
            businessDate: "2026-10-02",
            baseAmount: `-${line.baseAmount}`,
            units: `-${line.units}`,
          })),
        },
      });
    const zero = { ...data.payments[0], id: "zero-tender", method: "CARD", amount: D("0") };
    data.payments.push(zero);
    type Range = { gte: Date; lt: Date };
    const inRange = (date: Date, range?: Range) => !range || (date >= range.gte && date < range.lt);
    tx.sale.findMany = (async (args: { where: { OR: { soldAt?: Range; voidedAt?: Range }[] } }) =>
      data.sales.filter((row) =>
        args.where.OR.some((part) => (part.soldAt ? inRange(row.soldAt, part.soldAt) : false)),
      )) as unknown as typeof tx.sale.findMany;
    tx.salePayment.findMany = (async (args: {
      where: { createdAt?: Range };
      include?: { sale?: boolean };
    }) =>
      data.payments
        .filter((row) => inRange(row.createdAt, args.where.createdAt))
        .map(({ sale: _sale, ...row }) =>
          args.include?.sale ? { ...row, sale } : row,
        )) as typeof tx.salePayment.findMany;
    tx.payrollSourceEvent.findMany = (async (args: { where: { occurredAt?: Range } }) =>
      data.events.filter((row) =>
        inRange(row.occurredAt, args.where.occurredAt),
      )) as unknown as typeof tx.payrollSourceEvent.findMany;
    tx.commissionCollection.findMany = (async (args: { where: { occurredAt?: Range } }) =>
      data.collections.filter((row) =>
        inRange(row.occurredAt, args.where.occurredAt),
      )) as unknown as typeof tx.commissionCollection.findMany;
    tx.saleRefund.findMany = (async (args: { where: { refundedAt?: Range } }) =>
      [refund].filter((row) =>
        inRange(row.refundedAt, args.where.refundedAt),
      )) as unknown as typeof tx.saleRefund.findMany;
    Object.assign(tx, { customerOutstanding: { findMany: async () => [] } });
    const september = await f.load();
    assert.equal(september.staff[0].collection, "100.0000");
    assert.equal(september.staff[0].calculation.lines.length, 2);
    const approved = approvePayrollClose(
      calculatePayrollClose(
        openPayrollClose("2026-09"),
        0,
        september,
        owner,
        "2026-10-01T00:00:00.000Z",
      ),
      1,
      september,
      owner,
      "2026-10-01T00:00:00.000Z",
      "Reviewed September",
    );
    Object.assign(data.prior, {
      periodKey: "2026-09",
      revision: approved.revision,
      state: approved,
    });
    const loadOctober = () =>
      runAsTenant(
        "salon",
        () => loadAuthoritativePayrollCloseInputs(tx, openPayrollClose("2026-10")),
        "owner",
      );
    const october = await loadOctober();
    assert.equal(october.staff[0].collection, "-100.0000");
    assert.equal(october.staff[0].calculation.lines.length, 2);
    assert(october.staff[0].calculation.lines.every((row) => row.baseAmount.startsWith("-")));
    const hash = payrollInputHash(october);
    const draft = calculatePayrollClose(
      openPayrollClose("2026-10"),
      0,
      october,
      owner,
      "2026-11-01T00:00:00.000Z",
    );
    const frozen = approvePayrollClose(
      draft,
      1,
      october,
      owner,
      "2026-11-01T00:00:00.000Z",
      "Reviewed October",
    );
    const frozenHash = payrollInputHash(frozen);
    zero.method = "NETS";
    const changed = await loadOctober();
    assert.notEqual(payrollInputHash(changed), hash);
    assert.throws(
      () => approvePayrollClose(draft, 1, changed, owner, "2026-11-01T00:00:00.000Z", "Review"),
      /inputs changed/,
    );
    assert.equal(payrollInputHash(frozen), frozenHash);
    zero.method = "CARD";
    const findEvents = tx.payrollSourceEvent.findMany;
    type Event = (typeof data.events)[number];
    const corruptions: ((rows: Event[]) => Event[])[] = [
      (rows) => rows.slice(1),
      (rows) => [...rows, rows[0]],
      (rows) => rows.map((row, i) => (i ? row : { ...row, reason: "Changed month only" })),
      (rows) => rows.map((row, i) => (i ? row : { ...row, tenantId: "foreign" })),
      (rows) => rows.map((row, i) => (i ? row : { ...row, outletId: "foreign" })),
      (rows) => rows.map((row, i) => (i ? row : { ...row, sourceId: "foreign" })),
      (rows) =>
        rows.map((row, i) => (i ? row : { ...row, evidence: { ...row.evidence, lines: [] } })),
      (rows) => [...rows, original],
    ];
    for (const corrupt of corruptions) {
      tx.payrollSourceEvent.findMany = (async (...args: Parameters<typeof findEvents>) => {
        const rows = await findEvents(...args);
        return args[0]?.where?.occurredAt ? corrupt(rows as unknown as Event[]) : rows;
      }) as typeof findEvents;
      await assert.rejects(loadOctober);
    }
    tx.payrollSourceEvent.findMany = findEvents;
    assert.equal(payrollInputHash(await loadOctober()), hash);
    assert.equal(payrollInputHash(frozen), frozenHash);
  });
}

test("direct authoritative loader takes prepaid before tenant and inventory reads", async () => {
  const f = loaderFixture();
  const calls: string[] = [];
  f.tx.$executeRaw = (async (_sql: TemplateStringsArray, key: string) => {
    calls.push(`prepaid:${key}`);
    return 1;
  }) as typeof f.tx.$executeRaw;
  f.tx.$queryRaw = (async (sql: TemplateStringsArray) => {
    calls.push(sql.join("").includes("FOR UPDATE") ? "tenant" : "context");
    return [];
  }) as typeof f.tx.$queryRaw;
  const readActor = f.tx.user.findFirst;
  f.tx.user.findFirst = (async (...args: Parameters<typeof readActor>) => {
    assert.deepEqual(calls, ["prepaid:prepaid:salon", "context", "tenant"]);
    return readActor(...args);
  }) as typeof readActor;
  await f.load();
  assert.deepEqual(calls, ["prepaid:prepaid:salon", "context", "tenant"]);
});

test("transactional loader reconciles independent ordinary economics and GST-exclusive cash", async () => {
  const f = loaderFixture();
  const inputs = await f.load();
  assert.equal(inputs.staff[0].collection, "100.0000");
  const close = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(close.calculation!.statements[0].payroll.takeHome, "2010.00");
  assert.equal(payrollInputHash(await f.load()), payrollInputHash(inputs));
  assert.doesNotThrow(() => payrollInputHash(inputs));
  for (const query of f.queries) {
    const args = query.args as { where: { tenantId: string }; take?: number; skip?: number };
    assert.equal(args.where.tenantId, "salon");
    assert.equal(args.take, undefined);
    assert.equal(args.skip, undefined);
  }
  const saleQuery = f.queries.find((query) => query.model === "sale")!;
  const where = (saleQuery.args as { where: { OR: { soldAt?: { gte: Date; lt: Date } }[] } }).where;
  assert.equal(where.OR[0].soldAt!.gte.toISOString(), "2026-08-31T16:00:00.000Z");
  assert.equal(where.OR[0].soldAt!.lt.toISOString(), "2026-09-30T16:00:00.000Z");
});

test("missing operational captures and cash allocations cannot become empty payroll", async () => {
  for (const mutate of [
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.events = [];
    },
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.collections = [];
    },
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.payments = [];
    },
  ]) {
    const f = loaderFixture();
    mutate(f);
    await assert.rejects(f.load(), /UNAVAILABLE/);
  }
});

test("independent sale economics reject captures with fabricated bases or staff", async () => {
  for (const mutate of [
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.events[0].evidence.lines[0].baseAmount = "999.0000";
    },
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.events[0].evidence.lines[0].staffId = "other";
    },
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.events[0].evidence.lines[0].units = "2.0000";
    },
  ]) {
    const f = loaderFixture();
    mutate(f);
    await assert.rejects(f.load(), /ORDINARY_SOURCE_ECONOMICS_MISMATCH/);
  }
});

test("uncertain settlement, usage, refunds and package inputs fail closed independently", async () => {
  for (const [mutate, expected] of [
    [
      (f) => {
        f.data.payments[0].sessionId = "pending";
      },
      /GATEWAY_SETTLEMENT_UNCONFIRMED/,
    ],
    [
      (f) => {
        f.data.redemptions.push({ id: "uncaptured" });
      },
      /REDEMPTION_WORKFLOW_NOT_LOADED/,
    ],
    [
      (f) => {
        f.data.refunds.push({ id: "uncaptured" });
      },
      /REFUND_OR_VOID_WORKFLOW_NOT_LOADED/,
    ],
    [
      (f) => {
        f.data.usageCount = 1;
      },
      /SALE_PACKAGE_COVERAGE_UNCONFIRMED/,
    ],
    [
      (f) => {
        f.data.sales[0].lines[0].itemType = "PACKAGE";
      },
      /PACKAGE_PURCHASE_EVIDENCE_UNCONFIRMED/,
    ],
    [
      (f) => {
        f.data.sales[0].lines[0].lineTotal = D("0");
      },
      /FOC_OPERATIONAL_LIST_PRICE_NOT_LOADED/,
    ],
  ] as [(f: ReturnType<typeof loaderFixture>) => void, RegExp][]) {
    const f = loaderFixture();
    mutate(f);
    await assert.rejects(f.load(), expected);
  }
});

test("loader rejects missing history, legacy payout overlap and changed attribution", async () => {
  const missing = loaderFixture();
  missing.tx.payrollClose.findFirst = (async () =>
    null) as unknown as typeof missing.tx.payrollClose.findFirst;
  await assert.rejects(missing.load(), /PERSISTED_OPENING_REQUIRED/);
  const legacy = loaderFixture();
  legacy.data.legacy.push({
    id: "legacy",
    tenantId: "salon",
    userId: "staff",
    saleId: "sale",
    saleLineId: "line",
    sourceType: null,
    sourceId: null,
    ledgerVersion: null,
    amount: D("0"),
    paidAt: null,
    reversesId: null,
    reconciliationRequired: false,
  });
  await assert.rejects(legacy.load(), /SOURCES_UNAVAILABLE/);
  const attribution = loaderFixture();
  attribution.data.collections[0].allocations[0].evidence.sellers = [
    { staffId: "other", share: 10000 },
  ];
  await assert.rejects(attribution.load(), /HISTORICAL_CASH_ATTRIBUTION_UNCONFIRMED/);
});

test("loader denies unauthenticated, outlet and staff contexts", async () => {
  const f = loaderFixture();
  await assert.rejects(
    loadAuthoritativePayrollCloseInputs(f.tx, openPayrollClose("2026-09")),
    /authenticated/,
  );
  await assert.rejects(
    runAsTenant(
      "salon",
      () =>
        runAtOutlet("branch", () =>
          loadAuthoritativePayrollCloseInputs(f.tx, openPayrollClose("2026-09")),
        ),
      "owner",
    ),
    /salon-wide/,
  );
  f.tx.user.findFirst = (async () => ({
    id: "staff",
    globalRole: "STAFF",
  })) as unknown as typeof f.tx.user.findFirst;
  await assert.rejects(f.load(), /not permitted/);
});

test("collection net cannot be fabricated by moving GST into cash", async () => {
  const f = loaderFixture();
  f.data.collections[0].allocations[0].netCents = 10900n;
  f.data.collections[0].allocations[0].taxCents = 0n;
  await assert.rejects(f.load(), /OPERATIONAL_COLLECTION_TAX_MISMATCH/);
});

test("orphan captures and mismatched prior audit fail closed", async () => {
  const orphan = loaderFixture();
  orphan.data.sales = [];
  await assert.rejects(orphan.load(), /INVENTORY_UNAVAILABLE/);
  const audit = loaderFixture();
  audit.tx.payrollCloseEvent.findFirst = (async () => ({
    stateHash: "tampered",
    state: audit.data.prior.state,
  })) as unknown as typeof audit.tx.payrollCloseEvent.findFirst;
  await assert.rejects(audit.load(), /audit does not match/);
});

test("authoritative loader blocks ordinary captured fallback tampering", async () => {
  const f = loaderFixture();
  f.data.events[0].evidence.lines[0].fallbackRatePct = "90";
  await assert.rejects(f.load(), /RATE_PROVENANCE_UNCONFIRMED/);
  const legacy = loaderFixture();
  Reflect.deleteProperty(legacy.data.events[0].evidence, "rateProvenance");
  await assert.rejects(legacy.load(), /RATE_PROVENANCE_UNCONFIRMED/);
});

function focFixture() {
  const f = loaderFixture();
  const line = f.data.sales[0].lines[0];
  line.lineTotal = D("0");
  line.taxAmount = D("0");
  line.quantity = 2;
  line.payrollEconomics = {
    version: 1,
    saleId: "sale",
    saleLineId: "line",
    itemId: "service",
    itemType: "SERVICE",
    soldAt: f.data.sales[0].soldAt.toISOString(),
    listUnitPrice: "492.00",
    netLineAmount: "0.00",
    originalQuantity: 2,
    coveredPackageQuantity: 0,
    category: null,
  };
  const capture = f.data.events[0].evidence;
  Object.assign(capture.lines[0], {
    commissionType: "FOC",
    baseAmount: "984.0000",
    units: "2.0000",
    fallbackRatePct: "5",
  });
  capture.rateProvenance.selections[0].selection = {
    rate: "5",
    source: "FOC_DEFAULT",
    ruleId: null,
  };
  f.data.payments = [];
  f.data.collections = [];
  return f;
}

test("FOC independent checkout list price produces activity and default commission without cash", async () => {
  const f = focFixture();
  const inputs = await f.load();
  assert.equal(inputs.staff[0].collection, "0.0000");
  assert.equal(inputs.staff[0].calculation.lines[0].baseAmount, "984.0000");
  const draft = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(draft.calculation!.statements[0].payroll.takeHome, "2049.20");
  assert.equal(
    approvePayrollClose(draft, 1, inputs, owner, "2026-10-01T00:00:00.000Z", "FOC review complete")
      .status,
    "APPROVED",
  );
});

test("FOC absent, foreign, malformed or changed operational economics cannot be replaced by a capture assertion", async () => {
  for (const change of [
    { listUnitPrice: null },
    { listUnitPrice: "-492.00" },
    { originalQuantity: 3 },
    { saleId: "foreign" },
    { saleLineId: "foreign" },
    { itemId: "foreign" },
    { soldAt: "2026-09-14T00:00:00.000Z" },
    { coveredPackageQuantity: 1 },
    { netLineAmount: "1.00" },
    { itemType: "PRODUCT" },
  ]) {
    const f = focFixture();
    Object.assign(f.data.sales[0].lines[0].payrollEconomics as object, change);
    await assert.rejects(f.load(), /FOC_OPERATIONAL_LIST_PRICE_NOT_LOADED/);
  }
  const missing = focFixture();
  missing.data.sales[0].lines[0].payrollEconomics = null;
  Object.assign(missing.data.events[0].evidence, { sourceSnapshot: { listUnitPrice: "492.00" } });
  await assert.rejects(missing.load(), /FOC_OPERATIONAL_LIST_PRICE_NOT_LOADED/);
  const tax = focFixture();
  tax.data.sales[0].lines[0].taxAmount = D("1");
  await assert.rejects(tax.load(), /FOC_OPERATIONAL_TAX_MISMATCH/);
});

test("FOC captures must reconcile independent price, category, type and performer shares", async () => {
  for (const change of [
    { baseAmount: "492.0000" },
    { units: "1.0000" },
    { commissionType: "SVC" },
    { staffId: "other" },
  ]) {
    const f = focFixture();
    Object.assign(f.data.events[0].evidence.lines[0], change);
    await assert.rejects(f.load(), /ORDINARY_SOURCE_ECONOMICS_MISMATCH/);
  }
  const category = focFixture();
  Object.assign(category.data.sales[0].lines[0].payrollEconomics as object, {
    category: "department",
  });
  await assert.rejects(category.load(), /FOC_OPERATIONAL_CATEGORY_MISMATCH/);
  const rate = focFixture();
  rate.data.events[0].evidence.lines[0].fallbackRatePct = "10";
  await assert.rejects(rate.load(), /RATE_PROVENANCE_UNCONFIRMED/);
  const missingCapture = focFixture();
  missingCapture.data.events = [];
  await assert.rejects(missingCapture.load(), /INVENTORY_UNAVAILABLE/);
});

test("unverified FOC usage and prepaid-credit tenders remain blocked even with list-price evidence", async () => {
  const usage = focFixture();
  usage.data.usageCount = 1;
  await assert.rejects(usage.load(), /SALE_PACKAGE_COVERAGE_UNCONFIRMED/);
  const prepaid = focFixture();
  prepaid.data.payments = [
    { ...loaderFixture().data.payments[0], method: "PREPAID_CREDIT", sale: prepaid.data.sales[0] },
  ];
  await assert.rejects(prepaid.load(), /PREPAID_PAYMENT_WORKFLOW_NOT_LOADED/);
});

test("package tenders without independently verified usage cannot disappear from cash inventory", async () => {
  const f = loaderFixture();
  f.data.payments[0].method = "PACKAGE";
  await assert.rejects(f.load(), /PACKAGE_TENDER_UNCONFIRMED/);
});

test("FOC exact multi-performer residuals are retained with no fabricated cash", async () => {
  const f = focFixture();
  const shares = [
    { staffId: "staff", share: 3333 },
    { staffId: "other", share: 6667 },
  ];
  f.data.sales[0].lines[0].attribution.performers = shares;
  f.data.staff.push({ tenantId: "salon", id: "other", name: "Other performer", disabled: true });
  for (const event of f.data.configuration.filter((row) => row.targetId === "staff"))
    f.data.configuration.push({ ...event, id: `${event.id}-other`, targetId: "other" });
  const original = f.data.events[0].evidence.lines[0];
  f.data.events[0].evidence.lines = [
    { ...original, baseAmount: "327.9672", units: "0.6666" },
    { ...original, id: "base-other", staffId: "other", baseAmount: "656.0328", units: "1.3334" },
  ];
  f.data.events[0].evidence.rateProvenance.selections.push({
    staffId: "other",
    legacyServiceRate: "0",
    selection: { rate: "5", source: "FOC_DEFAULT", ruleId: null },
  });
  const inputs = await f.load();
  assert.equal(inputs.staff.length, 2);
  assert.equal(inputs.staff.find((row) => row.staff.id === "other")!.staff.disabled, true);
  for (const person of inputs.staff) assert.equal(person.collection, "0.0000");
  const changed = focFixture();
  const draft = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    await changed.load(),
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  Object.assign(changed.data.sales[0].lines[0].payrollEconomics as object, {
    listUnitPrice: "493.00",
  });
  changed.data.events[0].evidence.lines[0].baseAmount = "986.0000";
  const changedInputs = await changed.load();
  assert.throws(
    () =>
      approvePayrollClose(
        draft,
        1,
        changedInputs,
        owner,
        "2026-10-01T00:00:00.000Z",
        "Changed FOC refused",
      ),
    /inputs changed/,
  );
});

test("operational changes invalidate a calculated draft at approval", async () => {
  const f = loaderFixture();
  const inputs = await f.load();
  const draft = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  f.data.configuration.push({
    ...f.data.configuration[2],
    id: "profile-2",
    revision: 2,
    payload: { basicSalary: "2100", fixedOvertime: "0", levy: "0", salesAlertPct: "50" },
  });
  const changed = await f.load();
  assert.throws(
    () =>
      approvePayrollClose(draft, 1, changed, owner, "2026-10-01T00:00:00.000Z", "Approved review"),
    /inputs changed/,
  );
});

test("persisted opening and exact settlement compose authoritative inputs and invalidate stale approval", async () => {
  const f = loaderFixture();
  const opening: PayrollOpeningCarry = {
    id: "opening",
    tenantId: "salon",
    periodKey: "2026-09",
    revision: 1,
    timeZone: "Asia/Singapore",
    effectiveAt: "2026-08-31T16:00:00.000Z",
    firstClose: true,
    completeInventory: true,
    approval: { actorId: "owner", at: "2026-08-01T00:00:00.000Z", reason: "Complete cutover debt" },
    evidence: { reference: "audited-opening" },
    staff: [{ staffId: "staff", carryForward: [], fallbackCarryCommission: "-5.1234567890" }],
  };
  const row = (
    payload: PayrollOpeningCarry | import("./payroll-close-settlements.js").PayrollCarrySettlement,
    kind: string,
    targetId: string,
  ) => ({
    id: payload.id,
    tenantId: "salon",
    periodKey: payload.periodKey,
    revision: payload.revision,
    kind,
    targetId,
    actorId: payload.approval.actorId,
    reason: payload.approval.reason,
    createdAt: new Date(payload.approval.at),
    payloadHash: payrollInputHash(payload),
    payload,
  });
  const records = [row(opening, "OPENING", "opening")];
  f.tx.payrollClose.findFirst = (async () => null) as unknown as typeof f.tx.payrollClose.findFirst;
  f.tx.payrollClose.findMany = (async () => []) as unknown as typeof f.tx.payrollClose.findMany;
  f.tx.payrollClose.count = (async () => 0) as unknown as typeof f.tx.payrollClose.count;
  f.tx.payrollCarryAuthorization.findMany = (async () =>
    records) as unknown as typeof f.tx.payrollCarryAuthorization.findMany;
  const inputs = await f.load();
  assert.equal(inputs.staff[0].calculation.fallbackCarryCommission, "-5.1234567890");
  const draft = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(draft.calculation!.statements[0].payroll.takeHome, "2004.88");
  records.push(
    row(
      {
        id: "settlement",
        tenantId: "salon",
        periodKey: "2026-09",
        revision: 1,
        staffId: "staff",
        balanceHash: payrollInputHash(opening.staff[0]),
        components: [],
        fallbackWriteOff: { amount: "-5.1234567890" },
        evidence: { reference: "owner-write-off" },
        approval: {
          actorId: "owner",
          at: "2026-09-20T00:00:00.000Z",
          reason: "Exact debt writeoff",
        },
      },
      "SETTLEMENT",
      "staff",
    ),
  );
  const settled = await f.load();
  assert.equal(settled.staff[0].calculation.fallbackCarryCommission, "0.0000000000");
  assert.throws(
    () =>
      approvePayrollClose(
        draft,
        1,
        settled,
        owner,
        "2026-10-01T00:00:00.000Z",
        "Changed settlement denied",
      ),
    /inputs changed/,
  );
  const recalculated = calculatePayrollClose(draft, 1, settled, owner, "2026-10-01T00:00:00.000Z");
  assert.equal(recalculated.calculation!.statements[0].payroll.takeHome, "2010.00");
  assert.equal(
    approvePayrollClose(
      recalculated,
      2,
      settled,
      owner,
      "2026-10-01T00:00:00.000Z",
      "Settled payroll review",
    ).status,
    "APPROVED",
  );
  records[0].payloadHash = "0".repeat(64);
  await assert.rejects(f.load(), /audit mismatch/);
});

const prepaidSettlement = (id: string, holdingId: string, sourceKey: string) => ({
  id,
  tenantId: "salon",
  itemType: "PACKAGE" as const,
  holdingId,
  sourceKey,
});

test("prepaid settlements reject ambiguous, orphaned and unbacked monthly evidence", async () => {
  const duplicateHolding = loaderFixture();
  duplicateHolding.data.prepaidSettlements.push(
    prepaidSettlement("s1", "holding", "package-refund:a"),
    prepaidSettlement("s2", "holding", "package-refund:b"),
  );
  await assert.rejects(duplicateHolding.load(), /PREPAID_SETTLEMENT_DUPLICATE/);

  const duplicateKey = loaderFixture();
  duplicateKey.data.prepaidSettlements.push(
    prepaidSettlement("s1", "holding-a", "package-refund:a"),
    prepaidSettlement("s2", "holding-b", "package-refund:a"),
  );
  await assert.rejects(duplicateKey.load(), /PREPAID_SETTLEMENT_DUPLICATE/);

  // A settlement whose holding cannot be inventoried as a confirmed refund is
  // rejected by the history loader before any payout is admitted.
  const orphan = loaderFixture();
  orphan.data.prepaidSettlements.push(prepaidSettlement("s1", "holding", "package-refund:a"));
  await assert.rejects(orphan.load(), /PACKAGE_REDEMPTION_HISTORY_UNCONFIRMED/);

  const missing = loaderFixture();
  const original = missing.data.events[0];
  missing.data.events.push({
    ...original,
    id: "refund-capture",
    sourceKey: "package-refund:a",
    sourceType: "PACKAGE_REFUND",
    sourceId: "holding",
    occurredAt: missing.data.sales[0].soldAt,
    createdAt: missing.data.sales[0].soldAt,
  });
  await assert.rejects(missing.load(), /PREPAID_SETTLEMENT_MISSING/);
});
