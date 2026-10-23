import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canSignIn, canWrite, resolveTenantStatus } from "./tenant-status.js";

const DAY = 86_400_000;

describe("resolveTenantStatus", () => {
  it("keeps a stored status that is a deliberate operator action", () => {
    const future = new Date(Date.now() + DAY);

    assert.equal(resolveTenantStatus("CANCELLED", future), "CANCELLED");
    assert.equal(resolveTenantStatus("EXPIRED", null), "EXPIRED");
    // Suspension wins even when the subscription period is still running: nobody
    // accidentally lands in SUSPENDED, so it means what it says.
    assert.equal(resolveTenantStatus("SUSPENDED", future), "SUSPENDED");
  });

  it("leaves ACTIVE alone while the subscription has not lapsed", () => {
    assert.equal(resolveTenantStatus("ACTIVE", null), "ACTIVE");
    assert.equal(resolveTenantStatus("ACTIVE", new Date(Date.now() + DAY)), "ACTIVE");
  });

  it("treats ACTIVE with a lapsed subscription as expired", () => {
    assert.equal(resolveTenantStatus("ACTIVE", new Date(Date.now() - DAY)), "EXPIRED");
  });

  it("lets the caller pin 'now' so the boundary is exact", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    assert.equal(
      resolveTenantStatus("ACTIVE", new Date("2025-12-31T23:59:59.000Z"), now),
      "EXPIRED",
    );
    assert.equal(
      resolveTenantStatus("ACTIVE", new Date("2026-01-01T00:00:00.000Z"), now),
      "EXPIRED",
    );
  });
});

describe("canSignIn / canWrite", () => {
  it("lets an active salon in, and lets it write", () => {
    assert.equal(canSignIn("ACTIVE"), true);
    assert.equal(canWrite("ACTIVE"), true);
  });

  it("lets a suspended salon read but not write", () => {
    assert.equal(canSignIn("SUSPENDED"), true);
    assert.equal(canWrite("SUSPENDED"), false);
  });

  it("locks an expired or cancelled salon out entirely", () => {
    for (const status of ["EXPIRED", "CANCELLED"] as const) {
      assert.equal(canSignIn(status), false);
      assert.equal(canWrite(status), false);
    }
  });
});
