import assert from "node:assert/strict";
import { test } from "node:test";
import { outletPredicate } from "./outlet-policy.js";
import { currentOutletId, runAsTenant, runAsPlatform, runAtOutlet } from "./tenant-context.js";

test("outlet context preserves tenant identity and restores nested scopes", async () => {
  assert.throws(() => runAtOutlet("a", () => null));
  runAsPlatform(() => assert.throws(() => runAtOutlet("a", () => null)));
  await runAsTenant("tenant", async () => {
    assert.equal(currentOutletId(), undefined);
    await runAtOutlet("a", async () => {
      await Promise.resolve();
      assert.equal(currentOutletId(), "a");
      assert.deepEqual(outletPredicate("Sale"), { outletId: "a" });
      assert.deepEqual(outletPredicate("Package"), { OR: [{ outletId: null }, { outletId: "a" }] });
      assert.deepEqual(outletPredicate("Product"), { OR: [{ outletId: null }, { outletId: "a" }] });
      assert.deepEqual(outletPredicate("SaleRefund"), { sale: { outletId: "a" } });
      for (const model of [
        "Customer",
        "CustomerPackageHolding",
        "CustomerValuePackageHolding",
        "User",
        "Outlet",
      ]) {
        assert.equal(outletPredicate(model), undefined);
      }
    });
    assert.equal(currentOutletId(), undefined);
    assert.equal(outletPredicate("Sale"), undefined);
  });
});
