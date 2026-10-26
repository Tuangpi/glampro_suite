import assert from "node:assert/strict";
import { test } from "node:test";
import { commissionAmount, commissionSubtotal } from "./commission-ledger.js";

test("ten decimal storage preserves minimum base/rate/share without premature rounding", () => {
  assert.equal(commissionAmount("0.01", "0.01", 1), "0.0000000001");
  assert.equal(commissionAmount("100.00", "12.50", 10000), "12.5000000000");
  assert.equal(commissionAmount("9999999999.99", "100.00", 10000), "9999999999.9900000000");
});
test("split amounts reconcile exactly and reversals cancel before subtotal rounding", () => {
  const shares = [3333, 3333, 3334].map((share) => commissionAmount("0.03", "50.00", share));
  assert.equal(commissionSubtotal(shares), "0.02");
  assert.equal(commissionSubtotal([...shares, ...shares.map((v) => `-${v}`)]), "0.00");
  assert.equal(commissionSubtotal(["-0.0150000000"]), "-0.02");
});
test("aggregate tiny earnings before half-up cents", () => {
  const amount = commissionAmount("0.01", "50.00", 10000);
  assert.equal(commissionSubtotal([amount, amount, amount]), "0.02");
});
test("precision inputs reject negatives, excessive scale and invalid split", () => {
  for (const args of [
    ["-1.00", "5.00", 10000],
    ["1.001", "5.00", 10000],
    ["1.00", "100.01", 10000],
    ["1.00", "5.00", 10001],
  ] as const)
    assert.throws(() => commissionAmount(args[0], args[1], args[2]));
});
