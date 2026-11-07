import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { assertChannelAvailable, messagingCapabilities } from "./messaging-provider.js";

describe("system messaging capabilities", () => {
  let previous: Record<string, string | undefined>;
  beforeEach(() => {
    previous = Object.fromEntries(
      ["MESSAGING_ENABLED", "MESSAGING_PUBLIC_ORIGIN", "MESSAGING_TENANTS_JSON"].map((key) => [
        key,
        process.env[key],
      ]),
    );
    process.env.MESSAGING_ENABLED = "true";
    process.env.MESSAGING_PUBLIC_ORIGIN = "https://salon.example.test";
    process.env.MESSAGING_TENANTS_JSON = JSON.stringify({
      salon: {
        accountSid: "test-account",
        authToken: "test-secret",
        smsFrom: "Salon",
        whatsappFrom: "whatsapp:+14155550100",
        templates: {
          CONFIRMATION: "template",
          REMINDER: "template",
          REBOOKING: "template",
          RECEIPT: "template",
        },
      },
    });
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  it("requires explicit system enablement even with complete provider configuration", () => {
    process.env.MESSAGING_ENABLED = "false";
    assert.deepEqual(messagingCapabilities("salon"), {
      whatsappAvailable: false,
      smsAvailable: false,
    });
    assert.throws(() => assertChannelAvailable("salon", "SMS"), /not available yet/);
  });
  it("reports only safe readiness and isolates tenant configuration", () => {
    assert.deepEqual(messagingCapabilities("salon"), {
      whatsappAvailable: true,
      smsAvailable: true,
    });
    assert.deepEqual(messagingCapabilities("another-salon"), {
      whatsappAvailable: false,
      smsAvailable: false,
    });
  });
  it("requires all WhatsApp templates independently of SMS", () => {
    const config = JSON.parse(process.env.MESSAGING_TENANTS_JSON!);
    delete config.salon.templates.RECEIPT;
    process.env.MESSAGING_TENANTS_JSON = JSON.stringify(config);
    assert.deepEqual(messagingCapabilities("salon"), {
      whatsappAvailable: false,
      smsAvailable: true,
    });
    assert.throws(() => assertChannelAvailable("salon", "WHATSAPP"));
    assert.doesNotThrow(() => assertChannelAvailable("salon", "SMS"));
  });
  it("fails closed on invalid JSON or missing public origin", () => {
    process.env.MESSAGING_TENANTS_JSON = "invalid-json";
    assert.deepEqual(messagingCapabilities("salon"), {
      whatsappAvailable: false,
      smsAvailable: false,
    });
    delete process.env.MESSAGING_PUBLIC_ORIGIN;
    assert.deepEqual(messagingCapabilities("salon"), {
      whatsappAvailable: false,
      smsAvailable: false,
    });
  });
});
