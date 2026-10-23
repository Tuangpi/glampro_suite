import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportLiabilitySchema } from "./report.js";

describe("current customer balance contract", () => {
  const snapshot = {
    packageSessions: { holdings: 1, sessionsRemaining: 4 },
    prepaidCredit: { holdings: 1, balance: "40.00" },
    giftCards: { holdings: 1, balance: "15.00" },
    outstanding: { customers: 2, balance: "15.00" },
    totalMoney: "55.00",
    asOf: "2026-10-23T05:00:00.000Z",
  };

  it("retains separate debt and credit figures with an explicit snapshot instant", () => {
    assert.deepEqual(reportLiabilitySchema.parse(snapshot), snapshot);
  });

  it("requires a valid snapshot instant rather than a historical date or missing timestamp", () => {
    for (const asOf of [undefined, "2026-10-01", "not-a-date"]) {
      assert.equal(reportLiabilitySchema.safeParse({ ...snapshot, asOf }).success, false);
    }
  });
});
