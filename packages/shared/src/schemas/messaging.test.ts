import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { messagingSettingsSchema, channelConsentSchema, bookingActionSchema } from "./messaging.js";

describe("messaging contracts", () => {
  it("defaults both channels off and preserves approved timing defaults", () => {
    const settings = messagingSettingsSchema.parse({});
    assert.equal(settings.whatsappEnabled, false);
    assert.equal(settings.smsEnabled, false);
    assert.equal(settings.reminderHours, 24);
    assert.equal(settings.rebookingDays, 28);
    assert.equal(settings.quietStart, 20);
    assert.equal(settings.quietEnd, 9);
    assert.equal(settings.cancellationHours, 2);
  });
  it("rejects unsafe ranges, identical quiet boundaries and unknown settings", () => {
    for (const input of [
      { quietStart: 9, quietEnd: 9 },
      { reminderHours: 0 },
      { cancellationHours: -1 },
      { rebookingDays: 366 },
      { tenantId: "foreign" },
    ])
      assert.equal(messagingSettingsSchema.safeParse(input).success, false);
  });
  it("requires purpose-specific choices, revision and presented evidence", () => {
    assert.equal(channelConsentSchema.safeParse({ channel: "SMS", service: true }).success, false);
    assert.equal(
      channelConsentSchema.safeParse({
        channel: "SMS",
        service: true,
        marketing: false,
        preferred: true,
        expectedRevision: 0,
        noticeVersion: "v1",
        presented: true,
      }).success,
      true,
    );
  });
  it("limits public actions to confirm and cancel without arbitrary updates", () => {
    assert.equal(bookingActionSchema.safeParse({ action: "confirm" }).success, true);
    assert.equal(bookingActionSchema.safeParse({ action: "complete" }).success, false);
    assert.equal(
      bookingActionSchema.safeParse({ action: "cancel", status: "COMPLETED" }).success,
      false,
    );
  });
});
