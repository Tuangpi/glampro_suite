import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCompanySchema,
  acceptOwnerInvitationSchema,
  companyListQuerySchema,
} from "./company.js";
const input = {
  name: "Salon A",
  slug: "salon-a",
  ownerName: "Owner",
  ownerEmail: "Owner@example.test",
};
test("company creation validates identity and refuses privilege/status injection", () => {
  assert.equal(createCompanySchema.parse(input).ownerEmail, "owner@example.test");
  for (const value of [
    { ...input, slug: "BAD SLUG" },
    { ...input, name: " " },
    { ...input, status: "ACTIVE" },
    { ...input, globalRole: "SUPER_ADMIN" },
    { ...input, ownerEmail: "invalid" },
  ])
    assert.equal(createCompanySchema.safeParse(value).success, false);
});
test("invitation passwords and tokens have strict bounds", () => {
  const value = { token: "a".repeat(43), password: "a-private-owner-passphrase" };
  assert.equal(acceptOwnerInvitationSchema.safeParse(value).success, true);
  assert.equal(
    acceptOwnerInvitationSchema.safeParse({ ...value, password: "short" }).success,
    false,
  );
  assert.equal(
    acceptOwnerInvitationSchema.safeParse({ ...value, password: "😀".repeat(20) }).success,
    false,
  );
  assert.equal(
    acceptOwnerInvitationSchema.safeParse({ ...value, token: "a".repeat(44) }).success,
    false,
  );
  assert.equal(
    acceptOwnerInvitationSchema.safeParse({ ...value, tenantId: "foreign" }).success,
    false,
  );
});
test("company pagination rejects unbounded requests", () => {
  assert.equal(companyListQuerySchema.safeParse({ pageSize: 100000 }).success, false);
  assert.equal(companyListQuerySchema.parse({}).page, 1);
});
