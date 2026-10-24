import assert from "node:assert/strict";
import { test } from "node:test";
import { createOutletSchema, updateOutletSchema, outletAssignmentSchema } from "./outlet.js";

test("outlet contracts reject forged ownership, bad locale, timezone and slug", () => {
  assert.equal(createOutletSchema.parse({ name: " Central ", slug: "central" }).name, "Central");
  for (const fields of [
    { tenantId: "foreign" },
    { slug: "Bad slug" },
    { timeZone: "not/a/zone" },
    { locale: "bad_locale" },
  ]) {
    assert.equal(
      createOutletSchema.safeParse({ name: "Central", slug: "central", ...fields }).success,
      false,
    );
  }
  assert.equal(updateOutletSchema.safeParse({}).success, false);
  assert.equal(updateOutletSchema.safeParse({ status: "SUSPENDED" }).success, true);
  assert.equal(
    outletAssignmentSchema.safeParse({ kind: "PRODUCT", id: "p", outletId: null }).success,
    true,
  );
  assert.equal(
    outletAssignmentSchema.safeParse({ kind: "CUSTOMER", id: "c", outletId: "a" }).success,
    false,
  );
});
