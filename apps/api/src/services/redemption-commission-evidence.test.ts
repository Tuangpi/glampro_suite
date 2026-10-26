import assert from "node:assert/strict";
import { test } from "node:test";
import { redemptionPerformers } from "./redemption-commission-evidence.js";

test("whole-set attribution requires identical splits or an explicit tender override", () => {
  const a = [
    { staffId: "a", share: 2500 },
    { staffId: "b", share: 7500 },
  ];
  const coverage = [
    { saleLineId: "one", serviceId: "s1", quantity: 2, performers: a },
    { saleLineId: "two", serviceId: "s2", quantity: 1, performers: [...a].reverse() },
  ];
  assert.deepEqual(redemptionPerformers(coverage), { performers: a, status: "CONSISTENT_LINES" });
  const conflicting = [
    coverage[0]!,
    { ...coverage[1]!, performers: [{ staffId: "c", share: 10000 }] },
  ];
  assert.equal(redemptionPerformers(conflicting).status, "UNKNOWN");
  assert.equal(redemptionPerformers([{ ...coverage[0]!, performers: null }]).performers, null);
  assert.deepEqual(redemptionPerformers(conflicting, a), {
    performers: a,
    status: "EXPLICIT_TENDER",
  });
  assert.throws(() => redemptionPerformers(coverage, [{ staffId: "a", share: 1 }]));
});
