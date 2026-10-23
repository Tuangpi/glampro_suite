import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MODULE_CODES } from "@glampro_suite/shared";

import { runAsPlatform, runAsTenant, currentScope, requireScope } from "./tenant-context.js";

describe("tenant context", () => {
  it("reports no scope outside runAsTenant and runAsPlatform", () => {
    assert.equal(currentScope(), undefined);
  });

  it("carries the tenant id through runAsTenant, including across await", async () => {
    await runAsTenant("tenant-a", async () => {
      assert.deepEqual(currentScope(), { kind: "tenant", tenantId: "tenant-a" });
      await Promise.resolve();
      assert.equal(requireScope("payment").kind, "tenant");
    });
  });

  it("does not leak a tenant scope into code that runs after it", () => {
    runAsTenant("tenant-a", () => undefined);
    assert.equal(currentScope(), undefined);
  });

  it("carries the authenticated audit actor across await without leaking it", async () => {
    await runAsTenant(
      "tenant-a",
      async () => {
        await Promise.resolve();
        assert.deepEqual(currentScope(), {
          kind: "tenant",
          tenantId: "tenant-a",
          actorId: "actor-a",
        });
        runAsTenant("tenant-b", () =>
          assert.deepEqual(currentScope(), { kind: "tenant", tenantId: "tenant-b" }),
        );
        const scope = currentScope();
        assert.equal(scope?.kind === "tenant" && scope.actorId, "actor-a");
      },
      "actor-a",
    );
    assert.equal(currentScope(), undefined);
  });

  it("marks an explicit platform run, which is not a tenant", () => {
    runAsPlatform(() => {
      assert.deepEqual(currentScope(), { kind: "platform" });
    });
  });

  it("keeps concurrent tenant scopes separate", async () => {
    const seen = await Promise.all(
      ["tenant-a", "tenant-b"].map(async (tenantId) =>
        runAsTenant(tenantId, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return currentScope();
        }),
      ),
    );

    assert.deepEqual(seen, [
      { kind: "tenant", tenantId: "tenant-a" },
      { kind: "tenant", tenantId: "tenant-b" },
    ]);
  });
});

describe("requireScope", () => {
  it("throws rather than defaulting to an unscoped query", () => {
    assert.throws(() => requireScope("payment"), /No tenant scope.*payment/s);
  });
});

describe("module codes", () => {
  it("are unique, so a seeded code identifies exactly one Module row", () => {
    assert.equal(new Set(MODULE_CODES).size, MODULE_CODES.length);
  });
});
