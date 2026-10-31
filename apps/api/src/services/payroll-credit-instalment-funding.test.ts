import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { payrollCreditInstalmentFunding as funding } from "./payroll-credit-instalment-funding.js";

const decimal = (amount: string) => new Prisma.Decimal(amount);
const sale = {
  collectionCurrency: "SGD",
  paymentStatus: "UNPAID",
  totalAmount: decimal("90"),
  paidAmount: decimal("30"),
};
const lines = [
  {
    id: "line",
    itemType: "SERVICE",
    lineTotal: decimal("90"),
    voucherDiscountAmount: decimal("0"),
    taxAmount: decimal("7.43"),
  },
];
const payments = [
  { id: "credit", method: "PREPAID_CREDIT", amount: decimal("30"), sessionId: null },
];

test("credit instalment contract freezes debt separately without inventing cash", () => {
  assert.deepEqual(funding(sale, lines, payments, []), {
    version: 1,
    paymentIds: ["credit"],
    creditGrossCents: "3000",
    unpaidGrossCents: "6000",
    collections: [],
  });
  assert.equal(payments.length, 1);
  assert.equal(sale.paymentStatus, "UNPAID");
});

test("credit instalments reject inconsistent checkout, malformed economics and duplicate inventory", () => {
  for (const changed of [
    { ...sale, collectionCurrency: null },
    { ...sale, paymentStatus: "PAID" },
    { ...sale, paidAmount: decimal("29") },
    { ...sale, paidAmount: decimal("90") },
    { ...sale, paidAmount: decimal("0") },
  ])
    assert.equal(funding(changed, lines, payments, []), null);
  for (const changed of [
    [],
    [lines[0], lines[0]],
    [{ ...lines[0], itemType: "PACKAGE" }],
    [{ ...lines[0], lineTotal: decimal("91") }],
    [{ ...lines[0], taxAmount: decimal("91") }],
    [{ ...lines[0], taxAmount: decimal("7.431") }],
  ])
    assert.equal(funding(sale, changed, payments, []), null);
  for (const changed of [
    [],
    [payments[0], payments[0]],
    [{ ...payments[0], method: "CASH" }],
    [{ ...payments[0], amount: decimal("30.001") }],
    [{ ...payments[0], sessionId: "session" }],
    [{ ...payments[0], id: "payroll-uncollected-balance" }],
  ])
    assert.equal(funding(sale, lines, changed, []), null);
});

test("credit instalments reconcile independently allocated checkout cash and exact tax", () => {
  const cash = { id: "cash", method: "CASH", amount: decimal("30"), sessionId: null };
  const receipts = [
    {
      id: "receipt",
      sourceType: "SALE_PAYMENT",
      sourceId: "cash",
      grossCents: 3000n,
      allocations: [
        {
          id: "allocation",
          saleLineId: "line",
          grossCents: 3000n,
          netCents: 2752n,
          taxCents: 248n,
        },
      ],
    },
  ];
  const mixed = { ...sale, paidAmount: decimal("60") };
  const result = funding(mixed, lines, [...payments, cash], receipts);
  assert.equal(result?.unpaidGrossCents, "3000");
  assert.equal(result?.collections[0].allocations[0].netCents, "2752");
  assert.equal(funding(mixed, lines, [...payments, cash], []), null);
  assert.equal(
    funding(
      mixed,
      lines,
      [...payments, cash],
      [{ ...receipts[0], sourceType: "OUTSTANDING_PAYMENT" }],
    ),
    null,
  );
  assert.equal(
    funding(
      mixed,
      lines,
      [...payments, cash],
      [{ ...receipts[0], allocations: [{ ...receipts[0].allocations[0], netCents: 2753n }] }],
    ),
    null,
  );
});
