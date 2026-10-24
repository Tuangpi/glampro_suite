import assert from "node:assert/strict";
import { it } from "node:test";
import { rebookingChannel, rebookingInterval } from "./rebooking-policy.js";

const customer = {
  archivedAt: null,
  pdpaConsent: true,
  marketingOptIn: true,
  phone: "+65 9123 4567",
};
const choice = { channel: "SMS", destination: "+6591234567", marketing: true, preferred: true };
const settings = { smsEnabled: true, whatsappEnabled: false };

it("resolves explicit service, company and unconfigured company intervals", () => {
  assert.equal(rebookingInterval(45, 28), 45);
  assert.equal(rebookingInterval(null, 90), 90);
  assert.equal(rebookingInterval(undefined), 28);
});
it("uses only the currently preferred enabled channel and exact normalized destination", () => {
  assert.deepEqual(rebookingChannel(customer, [choice], settings), {
    channel: "SMS",
    destination: "+6591234567",
  });
  for (const choices of [
    [],
    [{ ...choice, preferred: false }],
    [{ ...choice, marketing: false }],
    [{ ...choice, destination: "+6599999999" }],
    [{ ...choice, channel: "EMAIL" }],
    [{ ...choice, channel: "WHATSAPP" }],
    [choice, { ...choice, channel: "WHATSAPP" }],
  ]) {
    assert.equal(rebookingChannel(customer, choices, settings), null);
  }
  assert.equal(rebookingChannel(customer, [choice], { ...settings, smsEnabled: false }), null);
});
it("never substitutes channel consent for current global consent or active customer status", () => {
  for (const change of [
    { pdpaConsent: false },
    { marketingOptIn: false },
    { phone: null },
    { phone: "91234567" },
    { archivedAt: new Date() },
  ]) {
    assert.equal(rebookingChannel({ ...customer, ...change }, [choice], settings), null);
  }
});
