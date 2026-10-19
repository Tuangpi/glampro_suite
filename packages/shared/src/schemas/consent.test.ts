import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { configurePrivacyNoticeSchema, recordCustomerConsentSchema } from "./consent.js";

describe("consent contracts", () => {
  it("requires both notice texts and a version, trimming whitespace", () => {
    assert.equal(
      configurePrivacyNoticeSchema.parse({
        version: " v1 ",
        dataConsentText: " Data ",
        marketingConsentText: " Marketing ",
      }).version,
      "v1",
    );
    for (const field of ["version", "dataConsentText", "marketingConsentText"]) {
      assert.equal(
        configurePrivacyNoticeSchema.safeParse({
          version: "1",
          dataConsentText: "data",
          marketingConsentText: "marketing",
          [field]: " ",
        }).success,
        false,
      );
    }
  });
  it("rejects implicit booleans, forged audit fields and missing revisions", () => {
    const input = {
      pdpaConsent: false,
      marketingOptIn: false,
      expectedRevision: 0,
      noticeId: null,
    };
    assert.equal(recordCustomerConsentSchema.safeParse(input).success, true);
    assert.equal(
      recordCustomerConsentSchema.safeParse({ ...input, marketingOptIn: "false" }).success,
      false,
    );
    assert.equal(
      recordCustomerConsentSchema.safeParse({ ...input, recordedById: "forged" }).success,
      false,
    );
    assert.equal(
      recordCustomerConsentSchema.safeParse({ ...input, expectedRevision: undefined }).success,
      false,
    );
  });
  it("keeps marketing optional and prevents marketing without data consent", () => {
    const input = { pdpaConsent: true, marketingOptIn: false, expectedRevision: 0, noticeId: "n1" };
    assert.equal(recordCustomerConsentSchema.safeParse(input).success, true);
    assert.equal(
      recordCustomerConsentSchema.safeParse({ ...input, pdpaConsent: false, marketingOptIn: true })
        .success,
      false,
    );
  });
});
