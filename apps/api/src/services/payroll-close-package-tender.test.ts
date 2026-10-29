import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { verifyPayrollPackageTenders } from "./payroll-close-package-tender.js";

const D = (value: string) => new Prisma.Decimal(value);
function fixture() {
  const sale = {
    tenantId: "salon",
    id: "sale",
    status: "COMPLETED",
    collectionCurrency: "SGD",
    lines: [{ id: "line", quantity: 3, lineTotal: D("10.04"), voucherDiscountAmount: D("0.03") }],
  };
  const coverage = [{ saleLineId: "line", coveredQuantity: 2, remainingQuantity: 1 }];
  const payments = ["a", "b"].map((id) => ({
    id,
    tenantId: "salon",
    saleId: "sale",
    method: "PACKAGE",
    amount: D("3.34"),
    sessionId: null as string | null,
  }));
  const verify = () => verifyPayrollPackageTenders(sale, payments, coverage, 2);
  return { sale, coverage, payments, verify };
}

test("package tenders reconcile aggregate residual cents across holdings without adding cash", () => {
  const f = fixture();
  assert.deepEqual(f.verify(), { grossCents: "668", paymentIds: ["a", "b"] });
  f.payments.push({ ...f.payments[0], id: "cash", method: "CASH", amount: D("3.33") });
  assert.deepEqual(f.verify(), { grossCents: "668", paymentIds: ["a", "b"] });
});

test("package tender zero-value covered units require explicit zero tenders", () => {
  const f = fixture();
  f.sale.lines[0].lineTotal = D("0.03");
  f.payments.forEach((row) => {
    row.amount = D("0");
  });
  assert.equal(f.verify().grossCents, "0");
  f.payments.pop();
  assert.throws(f.verify, /PACKAGE_TENDER_UNCONFIRMED/);
});

test("package tender reconciliation rejects incomplete, foreign, unsupported or altered evidence", () => {
  const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.payments.pop();
    },
    (f) => {
      f.payments.push({ ...f.payments[0] });
    },
    (f) => {
      f.payments[0].amount = D("3.33");
    },
    (f) => {
      f.payments[0].amount = D("-3.34");
    },
    (f) => {
      f.payments[0].amount = D("3.341");
    },
    (f) => {
      f.payments[0].sessionId = "gateway";
    },
    (f) => {
      f.payments[0].tenantId = "foreign";
    },
    (f) => {
      f.payments[0].saleId = "other";
    },
    (f) => {
      f.payments[0].method = "CASH";
    },
    (f) => {
      f.payments[0].method = "PREPAID_CREDIT";
    },
    (f) => {
      f.sale.status = "VOID";
    },
    (f) => {
      f.sale.collectionCurrency = "USD";
    },
    (f) => {
      f.coverage[0].coveredQuantity = 4;
    },
    (f) => {
      f.coverage[0].remainingQuantity = 0;
    },
    (f) => {
      f.coverage[0].saleLineId = "other";
    },
    (f) => {
      f.coverage.push({ ...f.coverage[0] });
    },
    (f) => {
      f.sale.lines[0].lineTotal = D("0");
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.throws(f.verify, /PACKAGE_TENDER_UNCONFIRMED/);
  }
});

test("ordinary sales have no package tender or covered value", () => {
  const f = fixture();
  f.coverage[0] = { saleLineId: "line", coveredQuantity: 0, remainingQuantity: 3 };
  assert.deepEqual(verifyPayrollPackageTenders(f.sale, [], f.coverage, 0), {
    grossCents: "0",
    paymentIds: [],
  });
  assert.throws(
    () => verifyPayrollPackageTenders(f.sale, f.payments, f.coverage, 0),
    /PACKAGE_TENDER_UNCONFIRMED/,
  );
});
