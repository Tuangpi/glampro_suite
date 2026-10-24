import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSeedAdmin } from "./seed-security.js";

describe("production seed security", () => {
  const valid = {
    SEED_MODE: "production",
    ADMIN_EMAIL: "owner@studio.sg",
    ADMIN_PASSWORD: "a-long-private-passphrase",
  };
  it("requires explicit production credentials", () => {
    assert.throws(() => resolveSeedAdmin({ SEED_MODE: "production" }));
    assert.throws(() => resolveSeedAdmin({ ...valid, ADMIN_PASSWORD: undefined }));
    assert.throws(() => resolveSeedAdmin({ ...valid, ADMIN_EMAIL: "owner@glampro.test" }));
    assert.throws(() => resolveSeedAdmin({ ...valid, ADMIN_EMAIL: "admin@gmail.com" }));
    assert.throws(() => resolveSeedAdmin({ ...valid, ADMIN_PASSWORD: "password12345" }));
    assert.throws(() => resolveSeedAdmin({ ...valid, ADMIN_PASSWORD: "short" }));
  });
  it("does not allow development seed mode in a production runtime", () => {
    assert.throws(() => resolveSeedAdmin({ NODE_ENV: "production", SEED_MODE: "development" }));
  });
  it("accepts explicit non-default production credentials", () => {
    assert.equal(resolveSeedAdmin(valid).email, valid.ADMIN_EMAIL);
    assert.equal(resolveSeedAdmin(valid).globalRole, "SUPER_ADMIN");
  });
  it("preserves development-only defaults", () => {
    assert.deepEqual(resolveSeedAdmin({}), {
      email: "admin@gmail.com",
      name: "Glampro Administrator",
      password: "admin12345",
      globalRole: "SUPER_ADMIN",
    });
  });
});
