import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsTenant } from "../lib/tenant-context.js";
import { HttpError } from "../lib/http-error.js";
import { voidSale } from "./sale.service.js";

// Exercise the real void entry point without SQL. Only expected operations exist;
// an attempt to reverse stock, credit, earnings or points would fail the test.
const restorers: (() => void)[] = [];
function replace<T extends object>(target: T, key: keyof T, value: unknown) {
  const original = target[key];
  Reflect.set(target, key, value);
  restorers.push(() => {
    Reflect.set(target, key, original);
  });
}
let sourceType = "VALUE_PACKAGE_REFUND";
let calls: string[];
before(() => {
  const sale = {
    id: "purchase",
    status: "COMPLETED",
    customerId: "customer",
    lines: [],
    points: [],
  };
  replace(prisma.sale, "findFirst", async () => sale);
  replace(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      $executeRaw: async () => {
        calls.push("lock");
      },
      $queryRaw: async () => [],
      sale: {
        update: async () => {
          calls.push("sale serialization touch");
          return sale;
        },
        findFirst: async () => sale,
        updateMany: async () => {
          assert.fail("must not void refunded purchase");
        },
      },
      saleRefund: { findFirst: async () => null },
      payrollSourceEvent: {
        findFirst: async ({
          where,
        }: {
          where: { saleId: string; sourceType: { in: string[] } };
        }) => {
          assert.equal(where.saleId, "purchase");
          assert.ok(where.sourceType.in.includes(sourceType));
          calls.push("package refund guard");
          return { id: "refund-event", sourceType };
        },
      },
    }),
  );
});
after(() => {
  for (const restore of restorers.reverse()) restore();
});
for (const kind of ["PACKAGE_REFUND", "VALUE_PACKAGE_REFUND"])
  test(`${kind} prevents purchase void before status or ledger reversal`, async () => {
    sourceType = kind;
    calls = [];
    await assert.rejects(
      runAsTenant(
        "tenant",
        () => voidSale("purchase", { reason: "Attempt refunded purchase void" }, "manager"),
        "manager",
      ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        error.code === "SALE_ALREADY_REFUNDED",
    );
    assert.deepEqual(calls, ["lock", "sale serialization touch", "package refund guard"]);
  });
