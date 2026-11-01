import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { payrollSessionInstalmentFunding } from "./payroll-session-credit-funding.js";

const D = (value: string) => new Prisma.Decimal(value);

function fixture() {
  const lines = [
    {
      id: "session",
      itemType: "SERVICE",
      quantity: 1,
      lineTotal: D("10"),
      voucherDiscountAmount: D("0"),
      taxAmount: D("0"),
    },
    {
      id: "ordinary",
      itemType: "SERVICE",
      quantity: 1,
      lineTotal: D("90"),
      voucherDiscountAmount: D("0"),
      taxAmount: D("0"),
    },
  ];
  return {
    sale: {
      tenantId: "tenant",
      id: "sale",
      status: "COMPLETED",
      collectionCurrency: "SGD",
      paymentStatus: "UNPAID",
      totalAmount: D("100"),
      paidAmount: D("30"),
      lines,
    },
    lines,
    payments: [
      {
        id: "package",
        tenantId: "tenant",
        saleId: "sale",
        method: "PACKAGE",
        amount: D("10"),
        sessionId: null,
      },
      {
        id: "credit",
        tenantId: "tenant",
        saleId: "sale",
        method: "PREPAID_CREDIT",
        amount: D("20"),
        sessionId: null,
      },
    ],
    coverage: [
      { saleLineId: "session", coveredQuantity: 1, remainingQuantity: 0 },
      { saleLineId: "ordinary", coveredQuantity: 0, remainingQuantity: 1 },
    ],
  };
}

const cashTender = (amount: string) => ({
  id: "cash",
  tenantId: "tenant",
  saleId: "sale",
  method: "CASH",
  amount: D(amount),
  sessionId: null,
});

const receiptFor = (cents: bigint, saleLineId: string) => ({
  id: "receipt",
  sourceType: "SALE_PAYMENT",
  sourceId: "cash",
  grossCents: cents,
  allocations: [{ id: "allocation", saleLineId, grossCents: cents, netCents: cents, taxCents: 0n }],
});

test("session coverage plus credit instalments freezes coverage, credit and debt apart", () => {
  const f = fixture();
  const funding = payrollSessionInstalmentFunding(f.sale, f.lines, f.payments, [], f.coverage, 1)!;
  assert.deepEqual(funding, {
    version: 2,
    packagePaymentIds: ["package"],
    packageGrossCents: "1000",
    coverage: f.coverage,
    paymentIds: ["credit", "package"],
    creditGrossCents: "2000",
    unpaidGrossCents: "7000",
    collections: [],
  });
  // The uncollected balance is debt, not tender: tenders and status stay untouched.
  assert.equal(f.payments.length, 2);
  assert.equal(f.sale.paymentStatus, "UNPAID");
});

test("allocated checkout cash reconciles against original line tax economics", () => {
  const f = fixture();
  f.sale.paidAmount = D("60");
  const cash = cashTender("30");
  const receipts = [receiptFor(3000n, "ordinary")];
  const funding = payrollSessionInstalmentFunding(
    f.sale,
    f.lines,
    [...f.payments, cash],
    receipts,
    f.coverage,
    1,
  )!;
  assert.equal(funding.unpaidGrossCents, "4000");
  assert.equal(funding.creditGrossCents, "2000");
  assert.equal(funding.collections[0].allocations[0].netCents, "3000");
  // Cash with no recorded allocation inventory refuses instead of being inferred.
  assert.equal(
    payrollSessionInstalmentFunding(f.sale, f.lines, [...f.payments, cash], [], f.coverage, 1),
    null,
  );
  // Cash may not consume the portion already covered by session tender.
  assert.equal(
    payrollSessionInstalmentFunding(
      f.sale,
      f.lines,
      [...f.payments, cash],
      [receiptFor(3000n, "session")],
      f.coverage,
      1,
    ),
    null,
  );
});

test("partial session coverage keeps the covered segment out of the credit split", () => {
  const f = fixture();
  f.lines[0].quantity = 2;
  f.lines[0].lineTotal = D("20");
  f.coverage[0].remainingQuantity = 1;
  f.sale.totalAmount = D("110");
  f.sale.paidAmount = D("70");
  const funding = payrollSessionInstalmentFunding(
    f.sale,
    f.lines,
    [...f.payments, cashTender("40")],
    [receiptFor(4000n, "ordinary")],
    f.coverage,
    1,
  )!;
  assert.equal(funding.packageGrossCents, "1000");
  assert.equal(funding.unpaidGrossCents, "4000");
  assert.equal(funding.collections.length, 1);
});

test("session instalments reject inconsistent receipts, coverage and tender inventory", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.sale.paymentStatus = "PAID";
    },
    (f: ReturnType<typeof fixture>) => {
      f.sale.paidAmount = D("0");
    },
    (f: ReturnType<typeof fixture>) => {
      f.sale.paidAmount = D("100");
    },
    (f: ReturnType<typeof fixture>) => {
      f.payments[1].amount = D("19");
    },
    (f: ReturnType<typeof fixture>) => {
      f.payments[1].id = "payroll-uncollected-balance";
    },
    (f: ReturnType<typeof fixture>) => {
      f.lines[1].itemType = "PACKAGE";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(
      payrollSessionInstalmentFunding(f.sale, f.lines, f.payments, [], f.coverage, 1),
      null,
    );
  }
  const noRedemption = fixture();
  assert.equal(
    payrollSessionInstalmentFunding(
      noRedemption.sale,
      noRedemption.lines,
      noRedemption.payments,
      [],
      noRedemption.coverage,
      0,
    ),
    null,
  );
  const corruptCoverage = fixture();
  corruptCoverage.lines[0].quantity = 2;
  assert.throws(
    () =>
      payrollSessionInstalmentFunding(
        corruptCoverage.sale,
        corruptCoverage.lines,
        corruptCoverage.payments,
        [],
        corruptCoverage.coverage,
        1,
      ),
    /PACKAGE_TENDER_UNCONFIRMED/,
  );
  const wrongTender = fixture();
  assert.equal(
    payrollSessionInstalmentFunding(
      wrongTender.sale,
      wrongTender.lines,
      [wrongTender.payments[1]],
      [],
      wrongTender.coverage,
      1,
    ),
    null,
  );
});
