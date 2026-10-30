import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePayrollFocEconomics } from "./payroll-close-foc.js";

function fixture() {
  const soldAt = new Date("2026-09-15T00:00:00.000Z");
  const line = {
    id: "line",
    saleId: "sale",
    itemId: "service",
    itemType: "SERVICE",
    quantity: 3,
    payrollEconomics: {
      version: 1,
      saleId: "sale",
      saleLineId: "line",
      itemId: "service",
      itemType: "SERVICE",
      soldAt: soldAt.toISOString(),
      listUnitPrice: "492.00",
      netLineAmount: "0.00",
      originalQuantity: 3,
      coveredPackageQuantity: 1,
      category: "hair",
    },
  };
  return { line, soldAt };
}

test("partial package FOC uses original list price for uncovered units only", () => {
  const { line, soldAt } = fixture();
  assert.equal(resolvePayrollFocEconomics(line, soldAt, 1).baseAmount, "984.0000");
  line.payrollEconomics.coveredPackageQuantity = 0;
  assert.equal(resolvePayrollFocEconomics(line, soldAt).baseAmount, "1476.0000");
});

test("FOC refuses unverified coverage, full coverage and altered checkout economics", () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.line.payrollEconomics.coveredPackageQuantity = 0;
    },
    (f) => {
      f.line.payrollEconomics.coveredPackageQuantity = 2;
    },
    (f) => {
      f.line.payrollEconomics.coveredPackageQuantity = -1;
    },
    (f) => {
      f.line.payrollEconomics.coveredPackageQuantity = 0.5;
    },
    (f) => {
      f.line.payrollEconomics.saleId = "other";
    },
    (f) => {
      f.line.payrollEconomics.originalQuantity = 4;
    },
    (f) => {
      f.line.payrollEconomics.soldAt = "2026-09-16T00:00:00.000Z";
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.throws(() => resolvePayrollFocEconomics(f.line, f.soldAt, 1), /FOC_OPERATIONAL/);
  }
  const f = fixture();
  f.line.payrollEconomics.coveredPackageQuantity = 3;
  assert.throws(() => resolvePayrollFocEconomics(f.line, f.soldAt, 3), /FOC_OPERATIONAL/);
  const result = resolvePayrollFocEconomics(fixture().line, f.soldAt, 1);
  result.economics.listUnitPrice = "1.00";
  assert.equal(resolvePayrollFocEconomics(fixture().line, f.soldAt, 1).baseAmount, "984.0000");
});
