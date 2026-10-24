import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activatePackageValuationSchema,
  packageValuationReportSchema,
} from "./package-valuation.js";

describe("package valuation activation contract", () => {
  const input = {
    policyVersion: 1,
    currency: "SGD",
    reason: " Confirm purchase currency ",
    confirmed: true,
  };

  it("requires explicit version, currency and confirmation and trims the reason", () => {
    assert.equal(activatePackageValuationSchema.parse(input).reason, "Confirm purchase currency");
    for (const key of Object.keys(input)) {
      const copy: Record<string, unknown> = { ...input };
      delete copy[key];
      assert.equal(activatePackageValuationSchema.safeParse(copy).success, false, key);
    }
  });

  it("rejects unsupported currencies, unconfirmed inputs and client-supplied evidence", () => {
    for (const extra of [
      { currency: "USD" },
      { currency: "sgd" },
      { policyVersion: 2 },
      { confirmed: false },
      { reason: " " },
      { reason: "x".repeat(2001) },
      { actorId: "forged" },
      { tenantId: "foreign" },
      { activatedAt: "2020-01-01T00:00:00Z" },
      { id: "client-chosen" },
    ])
      assert.equal(activatePackageValuationSchema.safeParse({ ...input, ...extra }).success, false);
  });
});

describe("current package valuation report contract", () => {
  const bucket = {
    holdings: 0,
    sessionsRemaining: 0,
    net: "0.00",
    originalTax: "0.00",
    gross: "0.00",
  };
  const report = {
    scope: "COMPANY",
    asOf: "2026-10-24T00:00:00.000Z",
    activation: null,
    active: bucket,
    expired: bucket,
    unvalued: {
      active: { holdings: 1, sessionsRemaining: 3 },
      expired: { holdings: 0, sessionsRemaining: 0 },
    },
    unpaidPurchases: { sales: 0, holdings: 0, sourceSaleOutstanding: "0.00" },
    reconciliation: { status: "RECONCILED", purchases: 0, movements: 0 },
  };
  it("keeps unknown sessions distinct from a known zero and requires explicit scope", () => {
    assert.equal(packageValuationReportSchema.parse(report).unvalued.active.sessionsRemaining, 3);
    for (const extra of [
      { scope: "OUTLET" },
      { asOf: "yesterday" },
      { activation: {} },
      { reconciliation: { status: "FAILED" } },
    ]) {
      assert.equal(packageValuationReportSchema.safeParse({ ...report, ...extra }).success, false);
    }
  });
  it("requires exact decimal money and nonnegative counts", () => {
    for (const net of [0, "0", "0.001", "-1.00", "NaN"]) {
      assert.equal(
        packageValuationReportSchema.safeParse({ ...report, active: { ...bucket, net } }).success,
        false,
      );
    }
    assert.equal(
      packageValuationReportSchema.safeParse({ ...report, expired: { ...bucket, holdings: -1 } })
        .success,
      false,
    );
  });
});
