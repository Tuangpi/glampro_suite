import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { packageUtilisation } from "./package-utilisation.js";
const original = prisma.$transaction;
after(() => Reflect.set(prisma, "$transaction", original));
Reflect.set(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    user: { findFirst: async () => ({ globalRole: "MANAGER" }) },
    saleLine: {
      groupBy: async (query: { where: unknown }) => {
        assert.deepEqual(query.where, { itemType: "PACKAGE", sale: { status: "COMPLETED" } });
        return [{ itemId: "package", _sum: { quantity: 2 } }];
      },
    },
    customerRedemption: {
      groupBy: async (query: { where: unknown }) => {
        assert.deepEqual(query.where, { itemType: "PACKAGE", revertedAt: null });
        return [{ itemId: "package", _sum: { quantity: 7 } }];
      },
    },
    customerPackageHolding: {
      groupBy: async () => [{ packageId: "package", _sum: { quantityRemaining: 3 } }],
    },
    package: { findMany: async () => [{ id: "package", name: "Facial" }] },
  }),
);
test("utilisation reports independent pack and session counts without deriving false balances", async () => {
  const data = await runAsTenant("salon", () => packageUtilisation(), "manager");
  assert.deepEqual(data.rows, [
    { id: "package", name: "Facial", packsSold: 2, sessionsRedeemed: 7, sessionsExpiredUnused: 3 },
  ]);
});
test("utilisation refuses an outlet-filtered company report", async () => {
  await assert.rejects(
    runAsTenant("salon", () => runAtOutlet("outlet", packageUtilisation), "manager"),
    /company-wide/,
  );
});
