import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PASSWORD_MIN_LENGTH } from "../constants.js";
import {
  createStaffSchema,
  staffListQuerySchema,
  staffSummarySchema,
  updateStaffSchema,
} from "./staff.js";

describe("staffListQuerySchema", () => {
  it("requires a compared start date only when changing or clearing that date", () => {
    assert.equal(updateStaffSchema.safeParse({ name: "Amy" }).success, true);
    assert.equal(updateStaffSchema.safeParse({ startDate: "2026-09-01" }).success, false);
    assert.equal(updateStaffSchema.safeParse({ startDate: null }).success, false);
    assert.equal(
      updateStaffSchema.safeParse({ startDate: "2026-09-01", expectedStartDate: null }).success,
      true,
    );
    assert.equal(
      updateStaffSchema.safeParse({ startDate: null, expectedStartDate: "2026-09-01" }).success,
      true,
    );
    assert.equal(
      updateStaffSchema.safeParse({ startDate: "2026-09-01", expectedStartDate: "invalid" })
        .success,
      false,
    );
  });
  it("defaults to showing everyone, disabled included", () => {
    assert.equal(staffListQuerySchema.parse({}).status, "all");
  });

  it("accepts the three states the screen's toolbar offers", () => {
    for (const status of ["all", "active", "disabled"] as const) {
      assert.equal(staffListQuerySchema.safeParse({ status }).success, true);
    }
  });
});

describe("createStaffSchema", () => {
  const payrollSetup = {
    startDate: "2026-09-01",
    payrollClassification: { commissionRole: "NON_COMMISSION", reason: "Employment agreement" },
  };
  it("rejects identity-only creation regardless of login role, title or legacy rate", () => {
    for (const globalRole of ["STAFF", "MANAGER", "SUPER_ADMIN"])
      assert.equal(
        createStaffSchema.safeParse({
          name: "Amy",
          email: "amy@example.test",
          password: "correct-horse-123",
          globalRole,
          position: "Non-commission",
          commissionRate: 0,
          startDate: "2026-09-01",
        }).success,
        false,
      );
  });
  it("requires a dated reasoned classification and initial plan for commission earners", () => {
    const identity = { name: "Amy", posPin: "123456" };
    const payrollClassification = {
      commissionRole: "COMMISSION_EARNING",
      reason: "Employment agreement",
    };
    assert.equal(
      createStaffSchema.safeParse({ ...identity, payrollClassification }).success,
      false,
    );
    assert.equal(
      createStaffSchema.safeParse({ ...identity, startDate: "2026-10-01", payrollClassification })
        .success,
      false,
    );
    const input = {
      ...identity,
      startDate: "2026-10-01",
      payrollClassification,
      payrollAssignment: {
        planId: "hair",
        expectedRevision: 0,
        fromDate: "2026-10-27",
        reason: "Initial assignment",
      },
    };
    assert.equal(createStaffSchema.safeParse(input).success, true);
    assert.equal(
      createStaffSchema.safeParse({
        ...input,
        payrollClassification: { ...payrollClassification, reason: " " },
      }).success,
      false,
    );
    assert.equal(
      createStaffSchema.safeParse({
        ...identity,
        startDate: "2026-10-01",
        payrollClassification: { ...payrollClassification, commissionRole: "NON_COMMISSION" },
      }).success,
      true,
    );
  });
  it("requires a join date, plan, assignment revision and reason for atomic payroll creation", () => {
    const identity = { name: "Amy", posPin: "123456" };
    const payrollAssignment = {
      planId: "plan",
      expectedRevision: 0,
      fromDate: "2026-10-27",
      reason: "Initial assignment",
    };
    assert.equal(createStaffSchema.safeParse({ ...identity, payrollAssignment }).success, false);
    const input = { ...identity, ...payrollSetup, payrollAssignment };
    assert.equal(createStaffSchema.safeParse(input).success, true);
    for (const patch of [
      { planId: null },
      { reason: " " },
      { expectedRevision: -1 },
      { fromDate: "bad" },
    ])
      assert.equal(
        createStaffSchema.safeParse({
          ...input,
          payrollAssignment: { ...payrollAssignment, ...patch },
        }).success,
        false,
      );
  });
  it("accepts PIN-only staff without email and prevents management roles", () => {
    assert.equal(
      createStaffSchema.safeParse({ ...payrollSetup, name: "Ava", posPin: "123456" }).success,
      true,
    );
    assert.equal(createStaffSchema.safeParse({ name: "Ava", posPin: "12345" }).success, false);
    assert.equal(
      createStaffSchema.safeParse({ name: "Ava", posPin: "123456", globalRole: "MANAGER" }).success,
      false,
    );
  });
  it("limits commission percentages to cent precision and the full revenue", () => {
    for (const commissionRate of [-1, 100.01, 1.234])
      assert.equal(updateStaffSchema.safeParse({ commissionRate }).success, false);
    assert.equal(updateStaffSchema.safeParse({ commissionRate: 12.5 }).success, true);
  });
  it("requires a login, because a staff member is a User row", () => {
    assert.equal(createStaffSchema.safeParse({ name: "Ava", email: "a@b.test" }).success, false);
    assert.equal(
      createStaffSchema.safeParse({
        ...payrollSetup,
        name: "Ava",
        email: "a@b.test",
        password: "longenough",
      }).success,
      true,
    );
  });

  it("enforces the shared minimum password length", () => {
    assert.equal(
      createStaffSchema.safeParse({
        name: "Ava",
        email: "a@b.test",
        password: "x".repeat(PASSWORD_MIN_LENGTH - 1),
      }).success,
      false,
    );
  });

  it("defaults to the least privileged role, so a client cannot mint an owner", () => {
    const parsed = createStaffSchema.parse({
      ...payrollSetup,
      name: "A",
      email: "a@b.test",
      password: "longenough",
    });
    assert.equal(parsed.globalRole, undefined);
  });
});

describe("updateStaffSchema", () => {
  it("carries no password field, so a manager cannot bypass change-password", () => {
    const parsed = updateStaffSchema.parse({ password: "something-else" });
    assert.equal("password" in parsed, false);
  });

  it("allows disabling without deleting the person's history", () => {
    assert.equal(updateStaffSchema.parse({ disabled: true }).disabled, true);
  });
});

describe("staffSummarySchema", () => {
  const row = {
    id: "u1",
    name: "Ava Owner",
    email: "ava@glampro.test",
    globalRole: "MANAGER",
    phone: null,
    position: null,
    color: null,
    avatar: null,
    startDate: null,
    endDate: null,
    disabled: false,
    lastLoginAt: null,
    departments: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("never carries credential material", () => {
    assert.equal("passwordHash" in staffSummarySchema.parse(row), false);
    // Zod strips unknown keys rather than rejecting them, so the guarantee is
    // that an unexpected field never reaches the caller — not that the call errors.
    // This matches createCustomerSchema's tenantId test.
    assert.equal("passwordHash" in staffSummarySchema.parse({ ...row, passwordHash: "x" }), false);
  });
});
