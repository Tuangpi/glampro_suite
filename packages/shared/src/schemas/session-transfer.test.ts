import assert from "node:assert/strict";
import { test } from "node:test";
import {
  transferSessionPackageSchema,
  sessionPackageTransferEventSchema,
} from "./session-transfer.js";

const input = {
  targetCustomerId: "receiver",
  expectedUpdatedAt: "2026-10-24T01:00:00.000Z",
  reason: " Customer request ",
  confirmed: true,
};
test("whole session transfer requires explicit confirmation, reason and version", () => {
  assert.equal(transferSessionPackageSchema.parse(input).reason, "Customer request");
  for (const change of [
    { confirmed: false },
    { reason: " " },
    { expectedUpdatedAt: "bad" },
    { targetCustomerId: "" },
    { quantity: 1 },
    { actorId: "forged" },
    { tenantId: "foreign" },
  ])
    assert.equal(transferSessionPackageSchema.safeParse({ ...input, ...change }).success, false);
});
test("session transfer evidence counts positive integer sessions, never monetary amounts", () => {
  const event = {
    id: "event",
    holdingId: "holding",
    fromCustomerId: "a",
    toCustomerId: "b",
    actorId: "manager",
    quantity: 3,
    expiresAt: null,
    reason: "Requested",
    createdAt: input.expectedUpdatedAt,
  };
  assert.equal(sessionPackageTransferEventSchema.safeParse(event).success, true);
  for (const quantity of [0, -1, 1.5, "3"])
    assert.equal(
      sessionPackageTransferEventSchema.safeParse({ ...event, quantity }).success,
      false,
    );
});
