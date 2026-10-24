import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitsOperatingHours } from "./booking-hours.service.js";

const hours = {
  sunday: null,
  monday: { open: "09:00", close: "18:00" },
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
};
describe("booking hours minute boundaries", () => {
  it("uses outlet local time and accepts exact closing but not overrun", () => {
    const fits = (start: string, end: string) =>
      fitsOperatingHours(hours, "Asia/Singapore", new Date(start), new Date(end));
    assert.equal(fits("2099-06-15T01:00:00Z", "2099-06-15T10:00:00Z"), true);
    assert.equal(fits("2099-06-15T00:59:59Z", "2099-06-15T02:00:00Z"), false);
    assert.equal(fits("2099-06-15T09:00:00Z", "2099-06-15T10:00:00.001Z"), false);
    assert.equal(fits("2099-06-16T01:00:00Z", "2099-06-16T02:00:00Z"), false);
  });
  it("checks real instants through repeated DST minutes and closed dates", () => {
    const sunday = { ...hours, sunday: { open: "01:00", close: "02:00" } };
    assert.equal(
      fitsOperatingHours(
        sunday,
        "America/New_York",
        new Date("2026-11-01T05:00:00Z"),
        new Date("2026-11-01T07:00:00Z"),
      ),
      true,
    );
    assert.equal(
      fitsOperatingHours(
        hours,
        "Asia/Singapore",
        new Date("2099-06-15T09:00:00Z"),
        new Date("2099-06-16T02:00:00Z"),
      ),
      false,
    );
  });
});
