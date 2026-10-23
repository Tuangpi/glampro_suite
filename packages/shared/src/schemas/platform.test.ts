import assert from "node:assert/strict";
import { test } from "node:test";
import { platformLoginSchema, platformVerifySchema, platformAdminSchema } from "./platform.js";

test("platform credentials and code contracts reject malformed input", () => {
  assert.equal(platformLoginSchema.safeParse({ email: "invalid", password: "" }).success, false);
  assert.equal(
    platformVerifySchema.safeParse({ challenge: "short", code: "123456" }).success,
    false,
  );
  assert.equal(
    platformVerifySchema.safeParse({ challenge: "a".repeat(64), code: "abc123" }).success,
    false,
  );
  assert.equal(
    platformVerifySchema.safeParse({ challenge: "a".repeat(64), code: "123456" }).success,
    true,
  );
});
test("platform public profiles omit credentials and tenant privileges", () => {
  assert.deepEqual(
    platformAdminSchema.parse({
      id: "admin",
      email: "admin@example.test",
      name: "Admin",
      passwordHash: "private",
      globalRole: "SUPER_ADMIN",
      tenantId: "foreign",
    }),
    { id: "admin", email: "admin@example.test", name: "Admin" },
  );
});
