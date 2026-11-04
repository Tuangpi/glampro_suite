import { describe, expect, it } from "vitest";

import {
  cn,
  createSalonFormatters,
  dayToLocalInstant,
  formatDate,
  formatDateInputValue,
  formatDuration,
  formatMoney,
  formatPrice,
  formatStatus,
  getInitials,
} from "./utils";

describe("formatDate", () => {
  it("renders an em dash for missing values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("formats an ISO string", () => {
    expect(formatDate("2026-03-04T10:30:00.000Z")).toBe("4 Mar 2026");
  });
});

describe("formatDateInputValue", () => {
  it("keeps the local calendar day instead of shifting to UTC", () => {
    // 00:30 local on the 1st would become the previous day via toISOString().
    expect(formatDateInputValue(new Date(2026, 0, 1, 0, 30))).toBe("2026-01-01");
  });
});

describe("dayToLocalInstant", () => {
  it("turns a picked day into that day's local midnight with an explicit offset", () => {
    const instant = dayToLocalInstant("2026-10-23") ?? "";

    // The offset is the machine's, so the shape is asserted, not a fixed +08:00.
    expect(instant).toMatch(/^2026-10-23T00:00:00[+-]\d{2}:\d{2}$/);
    expect(new Date(instant).getTime()).toBe(new Date(2026, 9, 23).getTime());
    // And it round-trips: the day the operator picked is the day that comes back.
    expect(formatDateInputValue(new Date(instant))).toBe("2026-10-23");
  });

  it("refuses a day the calendar does not have, and anything that is not a day", () => {
    expect(dayToLocalInstant("2026-02-30")).toBeNull();
    expect(dayToLocalInstant("2026-10-23T00:00:00Z")).toBeNull();
    expect(dayToLocalInstant("23/10/2026")).toBeNull();
    expect(dayToLocalInstant("")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats minor units as currency", () => {
    expect(formatMoney(123456)).toBe("S$1,234.56");
    expect(formatMoney(0)).toBe("S$0.00");
  });

  it("renders an em dash for missing values", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
  });
});

describe("salon formatting", () => {
  const singapore = createSalonFormatters({ locale: "en-SG", timeZone: "Asia/Singapore" });
  const newYork = createSalonFormatters({ locale: "en-GB", timeZone: "America/New_York" });

  it("uses DD/MM/YYYY and the salon timezone rather than the browser day", () => {
    expect(singapore.formatDate("2026-03-04T23:30:00.000Z")).toBe("05/03/2026");
    expect(newYork.formatDate("2026-03-04T01:30:00.000Z")).toBe("03/03/2026");
    expect(singapore.formatDateTime("2026-03-04T23:30:00.000Z")).toBe("05/03/2026, 07:30");
    expect(singapore.formatTime("2026-03-04T23:30:00.000Z")).toBe("07:30");
  });

  it("handles DST changes when formatting instants", () => {
    expect(newYork.formatTime("2026-03-08T06:30:00Z")).toBe("01:30");
    expect(newYork.formatTime("2026-03-08T07:30:00Z")).toBe("03:30");
  });

  it("preserves date-only values even in zones on opposite sides of UTC", () => {
    expect(newYork.formatDate("2026-03-04")).toBe("04/03/2026");
    expect(singapore.formatDate("2026-03-04")).toBe("04/03/2026");
    expect(singapore.formatDate("2026-02-30")).toBe("—");
    expect(singapore.formatDate(null)).toBe("—");
    expect(singapore.formatDate("invalid")).toBe("—");
  });

  it("keeps major-unit prices separate from cents and explicit currencies compatible", () => {
    expect(singapore.formatPrice("12.50")).toBe("S$12.50");
    expect(singapore.formatMoney(1250)).toBe("S$12.50");
    expect(formatPrice("12.50")).toBe("S$12.50");
    expect(formatMoney(1250, "USD", "en-US")).toBe("$12.50");
    expect(singapore.formatPrice("")).toBe("—");
    expect(singapore.formatMoney(Infinity)).toBe("—");
  });

  it("uses the saved locale's number conventions without changing currency", () => {
    const french = createSalonFormatters({ locale: "fr-FR", timeZone: "Europe/Paris" });
    expect(french.formatPrice("1234.50")).toBe("1\u202f234,50\u00a0S$");
    expect(singapore.formatPrice("1234.50")).toBe("S$1,234.50");
  });
});

describe("formatDuration", () => {
  it("switches to hours once past 60 minutes", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h 0m");
    expect(formatDuration(75)).toBe("1h 15m");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("getInitials", () => {
  it("takes at most two initials", () => {
    expect(getInitials("Ava Owner")).toBe("AO");
    expect(getInitials("Rita")).toBe("R");
    expect(getInitials("  maya   manager  ")).toBe("MM");
    expect(getInitials("")).toBe("");
  });
});

describe("formatStatus", () => {
  it("humanises enum values", () => {
    expect(formatStatus("IN_PROGRESS")).toBe("in progress");
    expect(formatStatus(null)).toBe("—");
  });
});

describe("cn", () => {
  it("drops falsy entries", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });
});
