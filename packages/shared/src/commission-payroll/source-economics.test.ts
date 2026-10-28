import assert from "node:assert/strict";
import { test } from "node:test";
import {
  payrollFixedSaleAward,
  payrollFixedSaleClawback,
  payrollSaleLineBase,
} from "./source-economics.js";
import { allocatePayrollSplit } from "./allocation.js";

const source = {
  foc: true,
  listUnitPrice: "492.00",
  quantity: 2,
  netAmount: "0",
  creditPaid: false,
  externalNetCents: null,
};
test("FOC full list price and quantity are independent of mixed-credit receipt collections", () => {
  for (const externalNetCents of [null, 0n, 12300n]) {
    assert.equal(
      payrollSaleLineBase({ ...source, creditPaid: true, externalNetCents }),
      "984.0000",
    );
  }
  assert.equal(payrollSaleLineBase(source), "984.0000");
  assert.equal(payrollSaleLineBase({ ...source, quantity: 1 }), "492.0000");
  assert.equal(payrollSaleLineBase({ ...source, listUnitPrice: null }), null);
  assert.throws(() => payrollSaleLineBase({ ...source, listUnitPrice: "-1" }));
  assert.throws(() => payrollSaleLineBase({ ...source, quantity: 0 }));
});
test("non-FOC external allocation remains explicit and missing credit evidence is unavailable", () => {
  assert.equal(payrollSaleLineBase({ ...source, foc: false, netAmount: "123.4567" }), "123.4567");
  assert.equal(payrollSaleLineBase({ ...source, foc: false, creditPaid: true }), null);
  assert.equal(
    payrollSaleLineBase({ ...source, foc: false, creditPaid: true, externalNetCents: 12345n }),
    "123.4500",
  );
  assert.throws(() =>
    payrollSaleLineBase({ ...source, foc: false, creditPaid: true, externalNetCents: -1n }),
  );
});
test("fixed award is once per sale line across instalments, with exact seller splits", () => {
  const first = payrollFixedSaleAward("100.01", 0);
  assert.equal(first, "100.0100");
  assert.equal(payrollFixedSaleAward("100.01", 1), "0.0000");
  assert.equal(payrollFixedSaleAward("100.01", 2), "0.0000");
  const split = allocatePayrollSplit(first, [
    { staffId: "b", share: 6667 },
    { staffId: "a", share: 3333 },
  ]);
  assert.equal(
    split.reduce((sum, row) => sum + BigInt(row.amount.replace(".", "")), 0n),
    1000100n,
  );
  assert.throws(() => payrollFixedSaleAward("-1", 0));
  assert.throws(() => payrollFixedSaleAward("100", -1));
});
test("refund claws back only the original fixed sale award proportion and cannot exceed it", () => {
  assert.equal(payrollFixedSaleClawback("100.0000", 290000n, 500000n), "-58.0000");
  assert.equal(payrollFixedSaleClawback("100.0100", 500000n, 500000n), "-100.0100");
  assert.equal(payrollFixedSaleClawback("100.0100", 0n, 500000n), "0.0000");
  assert.equal(payrollFixedSaleClawback("0.0000", 0n, 0n), "0.0000");
  assert.equal(payrollFixedSaleClawback("1.0000", 1n, 3n), "-0.3333");
  assert.throws(() => payrollFixedSaleClawback("100", 500001n, 500000n));
  assert.throws(() => payrollFixedSaleClawback("100", -1n, 500000n));
});
