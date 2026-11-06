import { describe, expect, it } from "vitest";

import { packageSessionValue } from "@/lib/package-session-value";

describe("package session value", () => {
  it("backs GST out of the price and divides the net over the sessions", () => {
    // 100.00 × 9 / 109 = 8.2568… → S$8.26 of GST, so S$91.74 is divided by five.
    expect(packageSessionValue("100.00", 5, true)).toEqual({
      priceCents: 10000,
      taxCents: 826,
      netCents: 9174,
      sessionValue: "18.3480",
      residualSessions: 0,
    });
  });

  it("keeps the leftover ten-thousandths on the earliest sessions", () => {
    // 917400 ticks over seven sessions leaves one tick over; the first session holds it.
    expect(packageSessionValue("100.00", 7, true)).toMatchObject({
      sessionValue: "13.1057",
      residualSessions: 1,
    });
    // 100000 ticks over three sessions: 3.3333 each, one tick left for the first session.
    expect(packageSessionValue("10.00", 3, false)).toMatchObject({
      sessionValue: "3.3333",
      residualSessions: 1,
    });
  });

  it("treats the whole price as net when the salon is not GST-registered", () => {
    expect(packageSessionValue("100.00", 5, false)).toMatchObject({
      taxCents: 0,
      netCents: 10000,
      sessionValue: "20.0000",
    });
  });

  it("rounds the GST component half-up, like the receipt line it copies", () => {
    // 6.05 × 9 / 109 = S$0.4995 → S$0.50 of GST, not S$0.49.
    expect(packageSessionValue("6.05", 1, true)).toMatchObject({ taxCents: 50, netCents: 555 });
  });

  it("answers that a free session is worth nothing instead of staying silent", () => {
    expect(packageSessionValue("0", 5, true)).toEqual({
      priceCents: 0,
      taxCents: 0,
      netCents: 0,
      sessionValue: "0.0000",
      residualSessions: 0,
    });
  });

  it("has no answer before the form can give one", () => {
    expect(packageSessionValue("", 5, true)).toBeNull();
    expect(packageSessionValue("  ", 5, true)).toBeNull();
    expect(packageSessionValue("twelve", 5, true)).toBeNull();
    expect(packageSessionValue("100.00", 0, true)).toBeNull();
    expect(packageSessionValue("100.00", -3, true)).toBeNull();
    expect(packageSessionValue("100.00", 2.5, true)).toBeNull();
  });

  it("never previews a negative price, which the form itself refuses", () => {
    expect(packageSessionValue("-5.00", 2, false)).toMatchObject({
      priceCents: 0,
      sessionValue: "0.0000",
    });
  });
});
