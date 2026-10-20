import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createShiftSchema, updateShiftSchema } from "./shift.js";

const work = { userId: "staff-1", dayOfWeek: 2, startsAtMinute: 540, endsAtMinute: 1080 };

describe("shift effective dates", () => {
  it("rejects reversed date bounds on create and update", () => {
    const dates = { effectiveFrom: "2026-11-30", effectiveTo: "2026-11-01" };
    for (const result of [
      createShiftSchema.safeParse({ ...work, ...dates }),
      updateShiftSchema.safeParse(dates),
    ]) {
      assert.equal(result.success, false);
      if (!result.success) assert.deepEqual(result.error.issues[0]?.path, ["effectiveTo"]);
    }
  });

  it("allows inclusive same-day bounds and open-ended windows", () => {
    assert.equal(
      createShiftSchema.safeParse({
        ...work,
        effectiveFrom: "2026-11-01",
        effectiveTo: "2026-11-01",
      }).success,
      true,
    );
    assert.equal(
      createShiftSchema.safeParse({ ...work, effectiveFrom: "2026-11-01" }).success,
      true,
    );
    assert.equal(
      updateShiftSchema.safeParse({ effectiveFrom: null, effectiveTo: null }).success,
      true,
    );
  });

  it("allows partial updates for service-side merged validation", () => {
    assert.equal(updateShiftSchema.safeParse({ startsAtMinute: 1200 }).success, true);
    assert.equal(updateShiftSchema.safeParse({ effectiveTo: "2026-10-01" }).success, true);
  });
});
