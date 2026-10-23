import assert from "node:assert/strict";
import { test } from "node:test";
import { createPrepaidFamilySchema, changePrepaidMembershipSchema } from "./prepaid.js";

test("prepaid family creation requires a bounded name, reason and explicit confirmation", () => {
  assert.deepEqual(
    createPrepaidFamilySchema.parse({ name: " Family ", reason: " Request ", confirmed: true }),
    {
      name: "Family",
      reason: "Request",
      confirmed: true,
    },
  );
  for (const input of [
    { name: " ", reason: "Request", confirmed: true },
    { name: "a".repeat(101), reason: "Request", confirmed: true },
    { name: "Family", reason: " ", confirmed: true },
    { name: "Family", reason: "Request", confirmed: false },
  ])
    assert.equal(createPrepaidFamilySchema.safeParse(input).success, false);
});

test("membership changes require a previous membership snapshot and allow explicit leaving", () => {
  const input = {
    familyId: null,
    expectedFamilyId: "family-a",
    reason: "Customer request",
    confirmed: true,
  };
  assert.equal(changePrepaidMembershipSchema.safeParse(input).success, true);
  assert.equal(
    changePrepaidMembershipSchema.safeParse({ ...input, expectedFamilyId: undefined }).success,
    false,
  );
  assert.equal(changePrepaidMembershipSchema.safeParse({ ...input, familyId: "" }).success, false);
  assert.equal(
    changePrepaidMembershipSchema.safeParse({ ...input, reason: "x".repeat(2001) }).success,
    false,
  );
});
