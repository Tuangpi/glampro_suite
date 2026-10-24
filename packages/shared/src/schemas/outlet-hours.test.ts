import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { outletOperatingHoursSchema, updateOutletSchema } from "./outlet.js";

const closed = {
  sunday: null,
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
};
describe("outlet hours contracts", () => {
  it("distinguishes inheritance from an explicitly closed week", () => {
    assert.ok(updateOutletSchema.safeParse({ operatingHours: null }).success);
    assert.ok(outletOperatingHoursSchema.safeParse(closed).success);
    assert.equal(outletOperatingHoursSchema.safeParse({ monday: null }).success, false);
  });
  it("refuses impossible times, overnight windows and unknown days", () => {
    for (const window of [
      { open: "25:00", close: "26:00" },
      { open: "09:60", close: "18:00" },
      { open: "18:00", close: "09:00" },
      { open: "09:00", close: "09:00" },
    ])
      assert.equal(
        outletOperatingHoursSchema.safeParse({ ...closed, monday: window }).success,
        false,
      );
    assert.equal(outletOperatingHoursSchema.safeParse({ ...closed, holiday: null }).success, false);
    assert.ok(
      outletOperatingHoursSchema.safeParse({ ...closed, monday: { open: "09:00", close: "18:00" } })
        .success,
    );
  });
});
