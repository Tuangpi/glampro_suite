import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "./http-error.js";
import { assertHoldingLive, packageExpiry } from "./package-expiry.js";

describe("package expiry", () => {
  const soldAt = new Date("2026-10-22T03:04:05.123Z");

  it("preserves null and omitted rules as no expiry", () => {
    assert.equal(packageExpiry(null, soldAt), null);
    assert.equal(packageExpiry(undefined, soldAt), null);
    assert.doesNotThrow(() => assertHoldingLive(null, "Package", soldAt));
  });

  it("adds exact 24-hour days without changing the purchase timestamp", () => {
    assert.equal(packageExpiry(30, soldAt)?.toISOString(), "2026-11-21T03:04:05.123Z");
    assert.equal(soldAt.toISOString(), "2026-10-22T03:04:05.123Z");
    const leapDay = new Date("2028-02-28T23:30:00Z");
    assert.equal(packageExpiry(2, leapDay)?.toISOString(), "2028-03-01T23:30:00.000Z");
  });

  it("does not shorten or extend an existing snapshot when the catalogue rule changes", () => {
    const original = packageExpiry(30, soldAt);
    const futurePurchase = packageExpiry(90, soldAt);
    assert.equal(original?.toISOString(), "2026-11-21T03:04:05.123Z");
    assert.notEqual(original?.getTime(), futurePurchase?.getTime());
  });

  it("refuses invalid validity rules rather than generating an invalid expiry", () => {
    for (const days of [0, -1, 1.5, 36_501, NaN, Infinity]) {
      assert.throws(() => packageExpiry(days, soldAt), RangeError);
    }
    assert.ok(packageExpiry(36_500, soldAt) instanceof Date);
  });

  it("allows the last millisecond but refuses the exact expiry boundary and later", () => {
    const expiry = packageExpiry(1, soldAt)!;
    assert.doesNotThrow(() => assertHoldingLive(expiry, "Package", new Date(+expiry - 1)));
    for (const at of [expiry, new Date(+expiry + 1)]) {
      assert.throws(
        () => assertHoldingLive(expiry, "Package", at),
        (error: unknown) =>
          error instanceof HttpError &&
          error.statusCode === 409 &&
          error.code === "HOLDING_EXPIRED",
      );
    }
  });
});
