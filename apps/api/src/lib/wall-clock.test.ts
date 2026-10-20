import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addWeeksInZone,
  formatMinuteOfDay,
  formatShiftTime,
  salonDayBounds,
  wallClockAt,
} from "./wall-clock.js";

/**
 * The bridge between a shift (minutes past local midnight) and a booking (a UTC
 * instant). Every case below exists because of a way this could be wrong in
 * production while still passing a naive fixture:
 *
 * - a **non-UTC zone**, because a UTC-pinned test cannot see a server-clock bug;
 * - a **day rollover**, because 08:00 UTC on Saturday is already Sunday 01:00 in
 *   Bangkok and the rota row for Sunday is the one that must match;
 * - **DST**, because a fixed offset reads winter hours into summer;
 * - **midnight itself**, because some ICU versions render `hour12: false` as
 *   `24` and `24:05` would be 1445 minutes into a day that has 1440.
 */
describe("wallClockAt", () => {
  it("reads the wall clock in a non-UTC zone, not the server's", () => {
    // 01:00 UTC is 08:00 in Bangkok — the start of a normal working day there.
    const { dayOfWeek, minutes } = wallClockAt(
      new Date("2026-10-14T01:00:00.000Z"),
      "Asia/Bangkok",
    );

    assert.equal(dayOfWeek, 3); // 2026-10-14 is a Wednesday in Bangkok too.
    assert.equal(minutes, 8 * 60);
  });

  it("rolls to the next day when the zone is already past midnight", () => {
    // 18:00 UTC Saturday is 01:00 Sunday in Bangkok.
    const { dayOfWeek, minutes } = wallClockAt(
      new Date("2026-10-17T18:00:00.000Z"),
      "Asia/Bangkok",
    );

    assert.equal(dayOfWeek, 0); // Sunday — 0, matching Date#getDay().
    assert.equal(minutes, 60);
  });

  it("applies the zone's own DST rules rather than a fixed offset", () => {
    // New York is UTC−04:00 in July and UTC−05:00 in January for the same instant hour.
    const summer = wallClockAt(new Date("2026-07-04T16:00:00.000Z"), "America/New_York");
    const winter = wallClockAt(new Date("2026-01-04T16:00:00.000Z"), "America/New_York");

    assert.equal(summer.minutes, 12 * 60); // 12:00 EDT
    assert.equal(winter.minutes, 11 * 60); // 11:00 EST
    assert.equal(summer.dayOfWeek, 6); // Saturday
    assert.equal(winter.dayOfWeek, 0); // Sunday
  });

  it("reads local midnight as minute 0 even when ICU renders the hour as 24", () => {
    // 15:00 UTC is exactly 00:00 the next day in Tokyo.
    const { dayOfWeek, minutes } = wallClockAt(new Date("2026-01-14T15:00:00.000Z"), "Asia/Tokyo");

    assert.equal(minutes, 0);
    assert.equal(dayOfWeek, 4); // Thursday, 2026-01-15.
  });
});

describe("salonDayBounds", () => {
  it("draws the day in the salon's zone, not UTC", () => {
    const { from, to } = salonDayBounds("2026-10-02", "Asia/Singapore");

    // 00:00 SGT is 16:00 UTC the previous day; the next local midnight is 24h later.
    assert.equal(from.toISOString(), "2026-10-01T16:00:00.000Z");
    assert.equal(to.toISOString(), "2026-10-02T16:00:00.000Z");
  });

  it("returns a 23-hour day across spring forward", () => {
    const { from, to } = salonDayBounds("2026-03-08", "America/New_York");

    assert.equal(from.toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(to.toISOString(), "2026-03-09T04:00:00.000Z");
    assert.equal(to.getTime() - from.getTime(), 23 * 60 * 60 * 1000);
  });

  it("returns a 25-hour day across fall back", () => {
    const { from, to } = salonDayBounds("2026-11-01", "America/New_York");

    assert.equal(from.toISOString(), "2026-11-01T04:00:00.000Z");
    assert.equal(to.toISOString(), "2026-11-02T05:00:00.000Z");
    assert.equal(to.getTime() - from.getTime(), 25 * 60 * 60 * 1000);
  });

  it("normalises month and year boundaries", () => {
    assert.deepEqual(salonDayBounds("2026-01-31", "UTC"), {
      from: new Date("2026-01-31T00:00:00.000Z"),
      to: new Date("2026-02-01T00:00:00.000Z"),
    });
    assert.deepEqual(salonDayBounds("2026-12-31", "UTC"), {
      from: new Date("2026-12-31T00:00:00.000Z"),
      to: new Date("2027-01-01T00:00:00.000Z"),
    });
  });
});

describe("addWeeksInZone", () => {
  it("moves a normal week by exactly 168 hours when the offset does not change", () => {
    const start = new Date("2026-10-14T17:00:00.000Z"); // 10:00 in Los Angeles
    const next = addWeeksInZone(start, 1, "America/Los_Angeles");

    assert.equal(next.toISOString(), "2026-10-21T17:00:00.000Z");
  });

  it("keeps the wall-clock time across spring forward instead of drifting an hour", () => {
    // 10:00 PST on 2026-03-04; a naive +168h lands at 11:00 PDT on 2026-03-11.
    const start = new Date("2026-03-04T18:00:00.000Z");
    const next = addWeeksInZone(start, 1, "America/Los_Angeles");

    assert.equal(wallClockAt(next, "America/Los_Angeles").minutes, 10 * 60);
    assert.equal(next.toISOString(), "2026-03-11T17:00:00.000Z");
  });

  it("keeps the wall-clock time across fall back too", () => {
    // 10:00 PDT on 2026-10-28; a naive +168h lands at 09:00 PST on 2026-11-04.
    const start = new Date("2026-10-28T17:00:00.000Z");
    const next = addWeeksInZone(start, 1, "America/Los_Angeles");

    assert.equal(wallClockAt(next, "America/Los_Angeles").minutes, 10 * 60);
    assert.equal(next.toISOString(), "2026-11-04T18:00:00.000Z");
  });

  it("reads a shift that crosses local midnight as an offset, not as a lost day", () => {
    // 23:30 PDT on 2026-10-28; across the fall back the wall clock reads 22:30, so
    // the correction is +60 minutes — the naive `00:30 − 23:30` would be −23h.
    const start = new Date("2026-10-29T06:30:00.000Z");
    const next = addWeeksInZone(start, 1, "America/Los_Angeles");

    assert.equal(wallClockAt(next, "America/Los_Angeles").minutes, 23 * 60 + 30);
    assert.equal(next.toISOString(), "2026-11-05T07:30:00.000Z");
  });

  it("steps several weeks at once, and returns the same instant for zero", () => {
    const start = new Date("2026-03-04T18:00:00.000Z");
    const fortnight = addWeeksInZone(start, 2, "America/Los_Angeles");

    assert.equal(fortnight.toISOString(), "2026-03-18T17:00:00.000Z");
    assert.equal(addWeeksInZone(start, 0, "America/Los_Angeles"), start);
  });
});

describe("formatMinuteOfDay", () => {
  it("pads both fields, so a form round-trips 09:05", () => {
    assert.equal(formatMinuteOfDay(545), "09:05");
    assert.equal(formatMinuteOfDay(0), "00:00");
    assert.equal(formatMinuteOfDay(24 * 60), "24:00");
  });
});

describe("formatShiftTime", () => {
  it("renders the chip's shape at the boundaries", () => {
    assert.equal(formatShiftTime(540), "9:00 AM");
    assert.equal(formatShiftTime(18 * 60), "6:00 PM");
    assert.equal(formatShiftTime(12 * 60), "12:00 PM");
    assert.equal(formatShiftTime(0), "12:00 AM");
    // A shift ending at midnight is 1440; it reads as midnight, not as 14:40.
    assert.equal(formatShiftTime(1440), "12:00 AM");
    assert.equal(formatShiftTime(13 * 60 + 5), "1:05 PM");
  });
});
