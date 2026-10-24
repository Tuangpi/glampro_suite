import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ownerSummarySchema, rebookingNudgeSchema } from "./ai-assistant.js";
import { createServiceSchema, updateServiceSchema } from "./catalogue.js";

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

it("validates explicit service rebooking days and null inheritance without requiring legacy clients to send it", () => {
  const service = { name: "Facial", memberPrice: 10, nonmemberPrice: 20 };
  assert.equal(createServiceSchema.safeParse(service).success, true);
  assert.equal(createServiceSchema.parse({ ...service, interval: null }).interval, null);
  assert.equal(updateServiceSchema.parse({ interval: 45 }).interval, 45);
  for (const interval of [0, -1, 366, 1.5, "45"])
    assert.equal(updateServiceSchema.safeParse({ interval }).success, false);
});

it("requires destination/channel evidence and bounded text in recommendation contracts", () => {
  const draft = {
    customerId: "customer",
    customerName: "Ava",
    email: "",
    appointmentId: "visit",
    lastServiceDate: "2026-07-02",
    serviceName: "Facial",
    suggestedRebookDate: "2026-10-25",
    daysSinceLastService: 114,
    serviceInterval: 45,
    intervalSource: "service",
    channel: "SMS",
    destination: "+6591234567",
    message: "Would you like to rebook?",
    draftId: "draft",
  };
  assert.equal(rebookingNudgeSchema.safeParse(draft).success, true);
  for (const change of [
    { channel: "EMAIL" },
    { destination: "91234567" },
    { intervalSource: "name" },
    { message: "x".repeat(2001) },
    { serviceInterval: 0 },
    { lastServiceDate: "bad" },
  ])
    assert.equal(rebookingNudgeSchema.safeParse({ ...draft, ...change }).success, false);
});
