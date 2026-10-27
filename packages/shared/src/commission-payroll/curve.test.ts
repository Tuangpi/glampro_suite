import assert from "node:assert/strict";
import { test } from "node:test";
import { hairPayrollExample } from "./examples.js";
import { comparePayrollMethods, payrollCommissionCurve } from "./component.js";

test("chart uses the same selected-stage options as calculator comparisons", () => {
  const component = hairPayrollExample().components[0]!;
  const options = { stageKey: "new", units: "2" };
  const curve = payrollCommissionCurve(component, "4000", 4, options);
  for (const point of curve)
    assert.deepEqual(point.methods, comparePayrollMethods(component, point.base, options));
  assert.equal(curve.at(-1)!.methods[0]!.result.amount, "160.00");
  assert.equal(
    payrollCommissionCurve(component, "4000", 4).at(-1)!.methods[0]!.result.amount,
    "0.00",
  );
});
