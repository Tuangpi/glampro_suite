import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { packageUtilisation } from "./package-utilisation.js";
const original = prisma.$transaction;
let actor: { globalRole: string } | null = { globalRole: "MANAGER" };
let empty = false;
after(() => Reflect.set(prisma, "$transaction", original));
Reflect.set(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    user: {
      findFirst: async (query: { where: unknown }) => {
        assert.deepEqual(query.where, { id: "manager", disabled: false });
        return actor;
      },
    },
    saleLine: {
      findMany: async () => (empty ? [] : [{ id: "line", saleId: "sale", itemId: "package" }]),
      groupBy: async (query: { where: unknown }) => {
        assert.deepEqual(query.where, { itemType: "PACKAGE", sale: { status: "COMPLETED" } });
        return empty ? [] : [{ itemId: "package", _sum: { quantity: 2 } }];
      },
    },
    customerRedemption: {
      groupBy: async (query: { where: unknown }) => {
        assert.deepEqual(query.where, { itemType: "PACKAGE", revertedAt: null });
        return empty ? [] : [{ itemId: "package", _sum: { quantity: 7 } }];
      },
    },
    customerPackageHolding: {
      findMany: async () => [],
      groupBy: async (query: {
        where: { expiresAt: { lte: Date }; quantityRemaining: { gt: number } };
      }) => {
        assert.ok(query.where.expiresAt.lte instanceof Date);
        assert.deepEqual(query.where.quantityRemaining, { gt: 0 });
        return empty ? [] : [{ packageId: "package", _sum: { quantityRemaining: 3 } }];
      },
    },
    packagePurchaseSnapshot: {
      findMany: async () => [{ saleLineId: "line", saleId: "sale", grantedSessions: 10 }],
    },
    package: { findMany: async () => [{ id: "package", name: "Facial" }] },
  }),
);
test("utilisation reports independent pack and session counts without deriving false balances", async () => {
  const data = await runAsTenant("salon", () => packageUtilisation(), "manager");
  assert.deepEqual(data.rows, [
    {
      id: "package",
      name: "Facial",
      packsSold: 2,
      sessionsSold: 10,
      knownSessionsSold: 10,
      unavailableSoldLines: 0,
      sessionsRedeemed: 7,
      sessionsExpiredUnused: 3,
    },
  ]);
});
test("utilisation refuses an outlet-filtered company report", async () => {
  await assert.rejects(
    runAsTenant("salon", () => runAtOutlet("outlet", packageUtilisation), "manager"),
    /company-wide/,
  );
});
test("utilisation rechecks the stored role, including missing or disabled actors", async () => {
  try {
    for (const value of [null, { globalRole: "STAFF" }, { globalRole: "CASHIER" }]) {
      actor = value;
      await assert.rejects(
        runAsTenant("salon", () => packageUtilisation(), "manager"),
        /Forbidden/,
      );
    }
  } finally {
    actor = { globalRole: "MANAGER" };
  }
});
test("utilisation returns an empty activity list rather than fabricating package balances", async () => {
  empty = true;
  try {
    const data = await runAsTenant("salon", () => packageUtilisation(), "manager");
    assert.deepEqual(data.rows, []);
    assert.ok(Number.isFinite(Date.parse(data.asOf)));
  } finally {
    empty = false;
  }
});
