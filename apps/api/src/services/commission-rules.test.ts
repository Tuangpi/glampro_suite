import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCommission, type RuleCandidate } from "./commission-rules.js";
const at = new Date("2026-10-23T12:00:00Z");
const input = {
  staffId: "amy",
  itemKind: "SERVICE" as const,
  itemId: "facial",
  departmentId: "skin",
  legacyServiceRate: "10",
};
function rule(
  scope: string,
  rate: string | null,
  extra: Partial<RuleCandidate> = {},
): RuleCandidate {
  return {
    id: scope,
    scope,
    rate,
    staffId: scope === "COMPANY" ? null : "amy",
    itemKind: "SERVICE",
    targetId: scope === "ITEM" ? "facial" : scope === "DEPARTMENT" ? "skin" : null,
    effectiveAt: new Date("2026-10-22T00:00:00Z"),
    createdAt: at,
    ...extra,
  };
}
test("item, department, staff and company precedence never stacks", () => {
  const rules = [
    rule("COMPANY", "8"),
    rule("STAFF", "10"),
    rule("DEPARTMENT", "12"),
    rule("ITEM", "15"),
  ];
  for (const [scope, rate] of [
    ["ITEM", "15"],
    ["DEPARTMENT", "12"],
    ["STAFF", "10"],
    ["COMPANY", "8"],
  ]) {
    assert.equal(resolveCommission(rules, input, at).rate, rate);
    const index = rules.findIndex((r) => r.scope === scope);
    rules[index] = { ...rules[index]!, rate: null };
  }
});
test("zero is explicit, null inherits and legacy zero remains zero", () => {
  assert.equal(
    resolveCommission([rule("ITEM", "0"), rule("DEPARTMENT", "12")], input, at).rate,
    "0",
  );
  assert.equal(
    resolveCommission([rule("COMPANY", "8")], { ...input, legacyServiceRate: "0" }, at).rate,
    "0",
  );
  assert.equal(resolveCommission([rule("STAFF", null), rule("COMPANY", "8")], input, at).rate, "8");
});
test("future events excluded, same-effective replacement uses publication order", () => {
  const original = rule("ITEM", "15", { id: "old", createdAt: new Date(at.getTime() - 1) });
  const replacement = rule("ITEM", null, { id: "new" });
  assert.equal(resolveCommission([original, replacement], input, at).source, "LEGACY_STAFF");
  assert.equal(
    resolveCommission([rule("ITEM", "99", { effectiveAt: new Date(at.getTime() + 1) })], input, at)
      .rate,
    "10",
  );
  assert.equal(resolveCommission([rule("ITEM", "15", { effectiveAt: at })], input, at).rate, "15");
});
test("foreign staff, kinds and targets ignored; products default to zero", () => {
  assert.equal(
    resolveCommission(
      [rule("ITEM", "99", { staffId: "bob" }), rule("ITEM", "88", { targetId: "other" })],
      input,
      at,
    ).rate,
    "10",
  );
  assert.equal(
    resolveCommission([rule("ITEM", "99")], { ...input, itemKind: "PRODUCT" }, at).rate,
    "0",
  );
  assert.equal(
    resolveCommission(
      [rule("COMPANY", "5", { itemKind: "PRODUCT" })],
      { ...input, itemKind: "PRODUCT" },
      at,
    ).rate,
    "5",
  );
});
