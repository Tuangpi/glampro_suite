import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { payrollSessionCreditFunding } from "./payroll-session-credit-funding.js";

function fixture() {
  const D = (value: string) => new Prisma.Decimal(value);
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
      paymentStatus: "PAID",
      totalAmount: D("100"),
      paidAmount: D("100"),
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
        amount: D("90"),
        sessionId: null,
      },
    ],
    coverage: [
      { saleLineId: "session", coveredQuantity: 1, remainingQuantity: 0 },
      { saleLineId: "ordinary", coveredQuantity: 0, remainingQuantity: 1 },
    ],
  };
}

test("session/credit funding freezes disjoint exact tender inventory without fresh cash", () => {
  const f = fixture();
  const funding = payrollSessionCreditFunding(f.sale, f.lines, f.payments, [], f.coverage, 1)!;
  assert.equal(funding.packageGrossCents, "1000");
  assert.deepEqual(funding.packagePaymentIds, ["package"]);
  assert.deepEqual(funding.funding, {
    version: 1,
    paymentIds: ["credit"],
    creditGrossCents: "9000",
    externalNetCents: "0",
  });
});

test("session/credit funding never infers unpaid, missing or corrupt tender coverage", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.sale.paidAmount = new Prisma.Decimal("99");
    },
    (f: ReturnType<typeof fixture>) => {
      f.payments[1].amount = new Prisma.Decimal("89.99");
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(payrollSessionCreditFunding(f.sale, f.lines, f.payments, [], f.coverage, 1), null);
  }
  const f = fixture();
  const corruptCoverage = fixture();
  corruptCoverage.lines[0].quantity = 2;
  corruptCoverage.coverage[0].remainingQuantity = 1;
  assert.throws(
    () =>
      payrollSessionCreditFunding(
        corruptCoverage.sale,
        corruptCoverage.lines,
        corruptCoverage.payments,
        [],
        corruptCoverage.coverage,
        1,
      ),
    /PACKAGE_TENDER_UNCONFIRMED/,
  );
  assert.throws(
    () => payrollSessionCreditFunding(f.sale, f.lines, f.payments.slice(1), [], f.coverage, 1),
    /PACKAGE_TENDER_UNCONFIRMED/,
  );
  assert.throws(
    () => payrollSessionCreditFunding(f.sale, f.lines, f.payments, [], f.coverage.slice(1), 1),
    /PACKAGE_TENDER_UNCONFIRMED/,
  );
  assert.equal(
    payrollSessionCreditFunding(
      f.sale,
      f.lines,
      f.payments,
      [
        {
          id: "bad",
          sourceType: "SALE_PAYMENT",
          sourceId: "bad",
          grossCents: 1n,
          allocations: [
            { id: "bad", saleLineId: "session", grossCents: 1n, netCents: 1n, taxCents: 0n },
          ],
        },
      ],
      f.coverage,
      1,
    ),
    null,
  );
});

test("partial session coverage freezes remaining credit and explicitly allocated cash", () => {
  const f = fixture();
  f.lines[0].quantity = 2;
  f.lines[0].lineTotal = new Prisma.Decimal("20");
  f.coverage[0].remainingQuantity = 1;
  f.sale.totalAmount = new Prisma.Decimal("110");
  f.sale.paidAmount = new Prisma.Decimal("110");
  f.payments[1].amount = new Prisma.Decimal("95");
  const cash = { ...f.payments[1], id: "cash", method: "CASH", amount: new Prisma.Decimal("5") };
  const receipt = {
    id: "receipt",
    sourceType: "SALE_PAYMENT",
    sourceId: "cash",
    grossCents: 500n,
    allocations: [
      { id: "allocation", saleLineId: "session", grossCents: 500n, netCents: 500n, taxCents: 0n },
    ],
  };
  const funding = payrollSessionCreditFunding(
    f.sale,
    f.lines,
    [...f.payments, cash],
    [receipt],
    f.coverage,
    1,
  )!;
  assert.equal(funding.version, 2);
  assert.equal(funding.packageGrossCents, "1000");
  assert.equal(funding.funding.creditGrossCents, "9500");
  // Cash may not consume the portion already covered by session tender.
  cash.amount = new Prisma.Decimal("11");
  f.payments[1].amount = new Prisma.Decimal("89");
  receipt.grossCents = 1100n;
  receipt.allocations[0].grossCents = 1100n;
  receipt.allocations[0].netCents = 1100n;
  assert.equal(
    payrollSessionCreditFunding(f.sale, f.lines, [...f.payments, cash], [receipt], f.coverage, 1),
    null,
  );
});
