import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPrepaidFamilySchema,
  changePrepaidMembershipSchema,
  sharePrepaidSchema,
} from "./prepaid.js";

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

test("holding sharing requires explicit family/null, a current snapshot and confirmation", () => {
  const input = {
    familyId: "family-a",
    expectedUpdatedAt: "2026-10-23T01:00:00.000Z",
    reason: " Share ",
    confirmed: true,
  };
  assert.equal(sharePrepaidSchema.parse(input).reason, "Share");
  assert.equal(sharePrepaidSchema.safeParse({ ...input, familyId: null }).success, true);
  for (const invalid of [
    { ...input, familyId: undefined },
    { ...input, familyId: "" },
    { ...input, expectedUpdatedAt: "yesterday" },
    { ...input, confirmed: false },
    { ...input, actorId: "spoofed" },
    { ...input, reason: " " },
  ])
    assert.equal(sharePrepaidSchema.safeParse(invalid).success, false);
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
