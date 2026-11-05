import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCompanySchema,
  updateCompanySchema,
  acceptOwnerInvitationSchema,
  companyListQuerySchema,
  companyListSchema,
  companyUpdateResultSchema,
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
test("an edit reuses creation's identity rules and always demands a reason", () => {
  const change = { name: "Salon A", slug: "salon-a", reason: "Correcting the name" };
  assert.equal(updateCompanySchema.safeParse(change).success, true);

  for (const value of [
    { ...change, reason: "" },
    { ...change, reason: " no " },
    { ...change, slug: "BAD SLUG" },
    { ...change, name: " " },
    // Privilege, status and ownership are server decisions, not form fields: a
    // strict object refuses them rather than silently ignoring a smuggled one.
    { ...change, status: "ACTIVE" },
    { ...change, globalRole: "SUPER_ADMIN" },
    { ...change, ownerUserId: "somebody-else" },
  ])
    assert.equal(updateCompanySchema.safeParse(value).success, false);

  // The owner pair travels together: an address with no name cannot greet anyone,
  // and a name with no address cannot be invited.
  assert.equal(updateCompanySchema.safeParse({ ...change, ownerName: "Owner B" }).success, false);
  assert.equal(
    updateCompanySchema.safeParse({ ...change, ownerEmail: "owner-b@example.test" }).success,
    false,
  );
  assert.equal(
    updateCompanySchema.parse({
      ...change,
      ownerName: "Owner B",
      ownerEmail: "Owner-B@Example.test",
    }).ownerEmail,
    "owner-b@example.test",
  );
});
test("an edit's answer distinguishes a sent invitation from one never needed", () => {
  const detail = {
    id: "company-a",
    name: "Salon A",
    slug: "salon-a",
    status: "ACTIVE",
    subscriptionEndsAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    owner: null,
    invitation: null,
  };
  // `null` is "no invitation was needed", not "we forgot to say".
  assert.equal(
    companyUpdateResultSchema.parse({ company: detail, invitationDelivery: null })
      .invitationDelivery,
    null,
  );
  assert.equal(
    companyUpdateResultSchema.safeParse({ company: detail, invitationDelivery: "queued" }).success,
    false,
  );
  assert.equal(companyUpdateResultSchema.safeParse({ company: detail }).success, false);
});
test("company pagination rejects unbounded requests", () => {
  assert.equal(companyListQuerySchema.safeParse({ pageSize: 100000 }).success, false);
  assert.equal(companyListQuerySchema.parse({}).page, 1);
});
const summary = {
  id: "company-a",
  name: "Salon A",
  slug: "salon-a",
  status: "ACTIVE",
  subscriptionEndsAt: "2027-03-31T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  owner: null,
};
const stats = { total: 5, active: 3, suspended: 2, expiringSoon: 1 };
test("the directory carries each company's expiry and the whole-directory totals", () => {
  const list = companyListSchema.parse({
    items: [summary, { ...summary, id: "company-b", subscriptionEndsAt: null }],
    total: 2,
    page: 1,
    pageSize: 20,
    stats,
  });
  // `null` is a company with no plan recorded — never a missing key.
  assert.equal(list.items[1].subscriptionEndsAt, null);
  assert.deepEqual(list.stats, stats);
});
test("a list without totals or an expiry is refused, so a page cannot guess them", () => {
  const items = [summary];
  assert.equal(
    companyListSchema.safeParse({ items, total: 1, page: 1, pageSize: 20 }).success,
    false,
  );
  assert.equal(
    companyListSchema.safeParse({
      items: [{ ...summary, subscriptionEndsAt: undefined }],
      total: 1,
      page: 1,
      pageSize: 20,
      stats,
    }).success,
    false,
  );
});
test("directory totals must be integers", () => {
  assert.equal(
    companyListSchema.safeParse({
      items: [summary],
      total: 1,
      page: 1,
      pageSize: 20,
      stats: { ...stats, active: 1.5 },
    }).success,
    false,
  );
});
