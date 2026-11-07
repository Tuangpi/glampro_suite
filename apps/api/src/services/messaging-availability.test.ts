import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { messagingSettingsSchema } from "@glampro_suite/shared";
import { runAsTenant } from "../lib/tenant-context.js";
import { queueReceipt, saveMessagingSettings } from "./messaging.service.js";

let previous: string | undefined;
beforeEach(() => {
  previous = process.env.MESSAGING_ENABLED;
  process.env.MESSAGING_ENABLED = "false";
});
afterEach(() => {
  if (previous === undefined) delete process.env.MESSAGING_ENABLED;
  else process.env.MESSAGING_ENABLED = previous;
});

it("rejects direct receipt send requests before accessing records when system messaging is disabled", async () => {
  for (const channel of ["SMS", "WHATSAPP"] as const)
    await assert.rejects(
      runAsTenant("salon", () => queueReceipt("sale", channel)),
      {
        statusCode: 503,
        message: "This messaging channel is not available yet.",
      },
    );
});

it("rejects direct activation requests for either system-disabled channel", async () => {
  for (const settings of [{ smsEnabled: true }, { whatsappEnabled: true }])
    await assert.rejects(
      runAsTenant("salon", () => saveMessagingSettings(messagingSettingsSchema.parse(settings))),
      { statusCode: 503 },
    );
});
