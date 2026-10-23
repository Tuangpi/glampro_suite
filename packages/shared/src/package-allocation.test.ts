import assert from "node:assert/strict";
import { test } from "node:test";
import { allocatePackage, type PackageRules } from "./package-allocation.js";
const rules: PackageRules = {
  mode: "SERVICE_SET",
  requirements: [
    { serviceId: "a", quantity: 2 },
    { serviceId: "b", quantity: 1 },
  ],
};
const line = (itemId: string, quantity: number, totalCents: number) => ({
  itemType: "SERVICE",
  itemId,
  quantity,
  totalCents,
});
test("a complete configured service set consumes one session; extras are not covered", () => {
  assert.deepEqual(
    allocatePackage(rules, 3, [line("a", 5, 5000), line("b", 2, 4000), line("extra", 1, 700)]),
    { cents: 8000, sessions: 2, units: [4, 2, 0] },
  );
  assert.deepEqual(allocatePackage(rules, 1, [line("a", 5, 5000), line("b", 2, 4000)]), {
    cents: 4000,
    sessions: 1,
    units: [2, 1],
  });
});
test("incomplete, empty and exhausted sets cover nothing", () => {
  for (const result of [
    allocatePackage(rules, 5, [line("a", 1, 1000), line("b", 1, 1000)]),
    allocatePackage(rules, 0, [line("a", 2, 1000), line("b", 1, 1000)]),
    allocatePackage({ mode: "SERVICE_SET", requirements: [] }, 5, []),
  ]) {
    assert.equal(result.sessions, 0);
    assert.equal(result.cents, 0);
  }
});
test("split lines match by IDs and quantities, never cover a unit twice, and preserve cents", () => {
  const lines = [line("a", 1, 333), line("b", 3, 1000), line("a", 3, 1000)];
  const first = allocatePackage(rules, 1, lines);
  assert.deepEqual(first, { cents: 1001, sessions: 1, units: [1, 1, 1] });
  const second = allocatePackage(rules, 1, lines, first.units);
  assert.deepEqual(second, { cents: 999, sessions: 1, units: [1, 2, 3] });
  assert.equal(allocatePackage(rules, 1, lines, second.units).sessions, 0);
});
