import assert from "node:assert/strict";
import { test } from "node:test";
import { saveDepartmentSchema } from "./department.js";

test("department names are trimmed and required for creation and renaming", () => {
  assert.deepEqual(saveDepartmentSchema.parse({ name: "  Hair  " }), { name: "Hair" });
  for (const value of [
    {},
    { name: " " },
    { name: "a".repeat(101) },
    { name: "Hair", tenantId: "foreign" },
  ]) {
    assert.equal(saveDepartmentSchema.safeParse(value).success, false);
  }
});
