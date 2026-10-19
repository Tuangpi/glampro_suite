import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_PAGE_SIZE } from "../constants.js";
import {
  createCustomerSchema,
  customerListQuerySchema,
  customerSummarySchema,
  updateCustomerSchema,
} from "./customer.js";

describe("customerListQuerySchema", () => {
  it("inherits the pagination defaults", () => {
    const parsed = customerListQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 20);
    assert.equal(parsed.search, undefined);
  });

  it("coerces a query-string search", () => {
    assert.equal(customerListQuerySchema.parse({ search: "  loi  " }).search, "loi");
  });

  it("rejects an over-long search rather than truncating it", () => {
    assert.equal(customerListQuerySchema.safeParse({ search: "x".repeat(201) }).success, false);
  });

  it("still caps pageSize", () => {
    assert.equal(customerListQuerySchema.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success, false);
  });
});

describe("createCustomerSchema", () => {
  it("accepts a name on its own, because a walk-in has no other detail yet", () => {
    assert.equal(createCustomerSchema.safeParse({ name: "Mrs Loi" }).success, true);
  });

  it("requires a non-empty name", () => {
    assert.equal(createCustomerSchema.safeParse({ name: "   " }).success, false);
    assert.equal(createCustomerSchema.safeParse({}).success, false);
  });

  it("rejects a malformed email but accepts an absent one", () => {
    assert.equal(createCustomerSchema.safeParse({ name: "A", email: "nope" }).success, false);
    assert.equal(createCustomerSchema.safeParse({ name: "A", email: "a@b.test" }).success, true);
  });

  it("rejects a free-text date of birth, which legacy stored as a string", () => {
    assert.equal(
      createCustomerSchema.safeParse({ name: "A", dateOfBirth: "12/03/1980" }).success,
      false,
    );
    assert.equal(
      createCustomerSchema.safeParse({ name: "A", dateOfBirth: "1980-03-12" }).success,
      true,
    );
  });

  it("refuses a tenantId outright — the tenant comes from the JWT, never the body", () => {
    // Zod strips unknown keys rather than rejecting, so the guarantee is that the
    // parsed value carries no tenant, not that the call errors.
    const parsed = createCustomerSchema.parse({ name: "A", tenantId: "someone-elses" });
    assert.equal("tenantId" in parsed, false);
  });
});

describe("updateCustomerSchema", () => {
  it("normalizes emails and distinguishes absent, blank and null", () => {
    assert.equal(
      createCustomerSchema.parse({ name: "A", email: "  A@B.test  " }).email,
      "a@b.test",
    );
    assert.equal(createCustomerSchema.parse({ name: "A", email: "  " }).email, null);
    assert.equal(updateCustomerSchema.parse({ email: "  A@B.test " }).email, "a@b.test");
    assert.equal(updateCustomerSchema.parse({ email: " " }).email, null);
    assert.equal(updateCustomerSchema.parse({ email: null }).email, null);
    assert.equal("email" in updateCustomerSchema.parse({}), false);
  });
  it("distinguishes absent from explicit null, so a partial submit clears nothing", () => {
    const absent = updateCustomerSchema.parse({ name: "A" });
    assert.equal("phone" in absent, false);

    const cleared = updateCustomerSchema.parse({ phone: null });
    assert.equal(cleared.phone, null);
  });

  it("still enforces the name when one is supplied", () => {
    assert.equal(updateCustomerSchema.safeParse({ name: "" }).success, false);
  });
});

describe("customerSummarySchema", () => {
  const row = {
    id: "c1",
    code: null,
    name: "Mrs Loi",
    memberId: null,
    email: null,
    phone: "9030 9386",
    gender: null,
    dateOfBirth: null,
    address: null,
    comment: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a row whose optional fields are all null", () => {
    assert.deepEqual(customerSummarySchema.parse(row), row);
  });

  it("has no Last visit / Total spend / Tier field, because the model has none", () => {
    assert.equal("lastVisit" in customerSummarySchema.parse(row), false);
    assert.equal("totalSpend" in customerSummarySchema.parse(row), false);
    assert.equal("tier" in customerSummarySchema.parse(row), false);
  });
});
