import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ownerSummarySchema } from "./ai-assistant.js";

const facts = {
  incomeToday: "100.01",
  completedSalePaid: "100.01",
  refundsToday: "5.25",
  netPaid: "94.76",
  salesToday: 3,
  averageTicket: "33.34",
  appointmentsToday: 8,
  newCustomersToday: 2,
  lowStockCount: 1,
  lowStockThreshold: 4,
  timeZone: "Asia/Singapore",
  from: "2026-10-23T16:00:00.000Z",
  to: "2026-10-24T16:00:00.000Z",
  asOf: "2026-10-23T17:00:00.000Z",
};

describe("owner summary contract", () => {
  it("preserves legacy values and explicit reporting evidence", () => {
    assert.deepEqual(ownerSummarySchema.parse(facts), facts);
    assert.equal(ownerSummarySchema.parse({ ...facts, netPaid: "-5.25" }).netPaid, "-5.25");
  });
  it("rejects malformed money, counts and reporting boundaries", () => {
    for (const change of [
      { completedSalePaid: 100.01 },
      { netPaid: "NaN" },
      { refundsToday: "-1.00" },
      { averageTicket: "33.333" },
      { salesToday: -1 },
      { lowStockCount: 1.5 },
      { asOf: "2026-10-23" },
      { to: facts.from },
      { from: facts.to, to: facts.from },
    ])
      assert.equal(ownerSummarySchema.safeParse({ ...facts, ...change }).success, false);
  });
});
