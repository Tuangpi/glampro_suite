import assert from "node:assert/strict";
import { test } from "node:test";
import { payrollDetailLineage } from "./payroll-detail-lineage.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

test("recursive reversal roots resolve package collection, refund holding and correction redemption without receipt guessing", async () => {
  const event = (id: string, sourceType: string, sourceId: string, saleId = "sale") => ({
    id,
    sourceKey: id,
    sourceType,
    sourceId,
    saleId,
  });
  const events = [
    event("reverse", "REVERSAL", "middle"),
    event("middle", "REVERSAL", "collection"),
    event("collection", "COLLECTION", "allocation"),
    event("refund", "PACKAGE_REFUND", "holding"),
    event("correction", "CORRECTION", "redemption"),
    event("missing", "REVERSAL", "absent"),
    event("cycle", "REVERSAL", "cycle"),
    event("foreign", "REVERSAL", "wrong-sale"),
    event("wrong-sale", "COLLECTION", "allocation", "other-sale"),
  ];
  const tx = {
    payrollSourceEvent: {
      findMany: async ({
        where,
      }: {
        where: { sourceKey?: { in: string[] }; id?: { in: string[] } };
      }) => events.filter((row) => (where.sourceKey?.in ?? where.id?.in ?? []).includes(row.id)),
    },
    sale: { findMany: async () => [{ id: "sale", customerId: "buyer" }] },
    customerRedemption: { findMany: async () => [{ id: "redemption", itemId: "pkg" }] },
    commissionCollectionAllocation: {
      findMany: async () => [{ id: "allocation", saleLineId: "line" }],
    },
    customerPackageHolding: { findMany: async () => [{ id: "holding", packageId: "pkg" }] },
    saleLine: { findMany: async () => [{ id: "line", itemId: "pkg" }] },
  } as unknown as PayrollCloseTransaction;
  const data = await payrollDetailLineage(tx, [
    "reverse",
    "refund",
    "correction",
    "missing",
    "cycle",
    "foreign",
  ]);
  for (const key of ["reverse", "refund", "correction"])
    assert.equal(data.get(key)?.packageId, "pkg");
  assert.equal(data.get("reverse")?.originalSourceEventId, "collection");
  for (const key of ["missing", "cycle", "foreign"]) {
    assert.equal(data.get(key)?.lineageAvailable, false);
    assert.equal(data.get(key)?.packageId, null);
  }
});
