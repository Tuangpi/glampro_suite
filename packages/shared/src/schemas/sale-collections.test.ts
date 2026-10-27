import assert from "node:assert/strict";
import { test } from "node:test";
import { recordSaleCollectionSchema } from "./sale-collections.js";

const input = {
  idempotencyKey: "52a01230-b9ea-4dc6-8304-c0987fd8fd01",
  currency: "SGD",
  collected: true,
  grossCents: "10900",
  reason: "Collected at counter",
  allocations: [{ saleLineId: "line-a", grossCents: "10900" }],
};

test("later collections require explicit confirmation and exact positive integer cents", () => {
  assert.deepEqual(recordSaleCollectionSchema.parse(input), input);
  for (const change of [
    { currency: "USD" },
    { collected: false },
    { collected: undefined },
    { grossCents: "0" },
    { grossCents: "1.09" },
    { grossCents: "010900" },
    { grossCents: "1000000000000" },
    { actorId: "forged" },
    { paidAt: "2020-01-01" },
    { method: "PACKAGE" },
    { idempotencyKey: "retry" },
    { allocations: [] },
    { allocations: [{ saleLineId: "line-a", grossCents: "10899" }] },
    {
      allocations: [
        { saleLineId: "line-a", grossCents: "5450" },
        { saleLineId: "line-a", grossCents: "5450" },
      ],
    },
  ])
    assert.equal(recordSaleCollectionSchema.safeParse({ ...input, ...change }).success, false);
});

test("later collection allocations reconcile large cents without floating-point conversion", () => {
  assert.ok(
    recordSaleCollectionSchema.safeParse({
      ...input,
      grossCents: "999999999999",
      allocations: [
        { saleLineId: "a", grossCents: "999999999998" },
        { saleLineId: "b", grossCents: "1" },
      ],
    }).success,
  );
});
