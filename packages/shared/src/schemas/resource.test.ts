import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createResourceSchema,
  MAX_RESOURCE_SERVICES,
  resourceListQuerySchema,
  resourceSummarySchema,
  updateResourceSchema,
} from "./resource.js";

describe("createResourceSchema", () => {
  it("trims the name and defaults a new resource to a room", () => {
    const parsed = createResourceSchema.parse({ name: "  Room 1  " });
    assert.equal(parsed.name, "Room 1");
    // Rooms are the common case; equipment is a deliberate choice.
    assert.equal(parsed.kind, "ROOM");
  });

  it("rejects a blank name rather than storing a nameless room", () => {
    assert.equal(createResourceSchema.safeParse({ name: "   " }).success, false);
  });

  it("accepts only the two kinds the model has", () => {
    assert.equal(
      createResourceSchema.parse({ name: "Steamer", kind: "EQUIPMENT" }).kind,
      "EQUIPMENT",
    );
    assert.equal(
      createResourceSchema.safeParse({ name: "Sofa", kind: "FURNITURE" }).success,
      false,
    );
  });

  it("bounds the eligibility set instead of accepting an unbounded list", () => {
    const tooMany = Array.from(
      { length: MAX_RESOURCE_SERVICES + 1 },
      (_value, index) => `s${index}`,
    );
    assert.equal(
      createResourceSchema.safeParse({ name: "Room 1", serviceIds: tooMany }).success,
      false,
    );
  });
});

describe("updateResourceSchema", () => {
  it("keeps an omitted field omitted, so a PATCH cannot clear by accident", () => {
    assert.deepEqual(updateResourceSchema.parse({}), {});
    assert.equal(updateResourceSchema.parse({ status: "INACTIVE" }).status, "INACTIVE");
  });

  it("reads an empty service list as 'no service uses it', not as 'unchanged'", () => {
    assert.deepEqual(updateResourceSchema.parse({ serviceIds: [] }).serviceIds, []);
  });
});

describe("resourceListQuerySchema", () => {
  it("filters by the fields the settings card uses and nothing else", () => {
    assert.deepEqual(resourceListQuerySchema.parse({ kind: "EQUIPMENT", status: "ACTIVE" }), {
      kind: "EQUIPMENT",
      status: "ACTIVE",
    });
    assert.equal(resourceListQuerySchema.safeParse({ kind: "DESK" }).success, false);
  });
});

describe("resourceSummarySchema", () => {
  it("keeps the service set as ids and the timestamps as strings", () => {
    const row = resourceSummarySchema.parse({
      id: "resource-1",
      name: "Room 1",
      kind: "ROOM",
      status: "ACTIVE",
      serviceIds: ["service-1", "service-2"],
      createdAt: "2026-11-01T09:00:00.000Z",
      updatedAt: "2026-11-01T09:00:00.000Z",
    });
    assert.deepEqual(row.serviceIds, ["service-1", "service-2"]);
    assert.equal(row.status, "ACTIVE");
  });
});
