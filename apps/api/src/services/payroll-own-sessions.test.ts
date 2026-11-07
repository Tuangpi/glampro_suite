import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsTenant } from "../lib/tenant-context.js";
import { ownPayrollSessions } from "./payroll-own-sessions.js";

const original = prisma.$transaction;
after(() => {
  Reflect.set(prisma, "$transaction", original);
});
let role = "STAFF";
let snapshotsOverride: { redemptionId: string; evidence: unknown }[] | null = null;
let largeMonth = false;
const batchSizes: number[] = [];
const evidence = (staffId: string) => ({
  version: 1,
  coverage: [
    {
      saleLineId: "line",
      serviceId: "service",
      quantity: 1,
      performers: [{ staffId, share: 10000 }],
    },
  ],
  performers: [{ staffId, share: 10000 }],
  attributionStatus: "EXPLICIT_TENDER",
  valuation: null,
  evaluatedAt: "2026-11-06T00:00:00Z",
  rates: [],
  postingStatus: "PENDING_RELEASE",
  previousSnapshotId: null,
});
Reflect.set(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    user: { findFirst: async () => ({ globalRole: role }) },
    tenant: { findUniqueOrThrow: async () => ({ timeZone: "Asia/Singapore" }) },
    customerRedemption: {
      findMany: async ({ take, cursor }: { take: number; cursor?: { id: string } }) => {
        batchSizes.push(take);
        const ids = largeMonth
          ? Array.from({ length: 601 }, (_, index) => `session-${index}`)
          : ["own", "other", "legacy"];
        const start = cursor ? ids.indexOf(cursor.id) + 1 : 0;
        return ids.slice(start, start + take).map((id) => ({
          id,
          usedAt: new Date("2026-11-06T00:00:00Z"),
          quantity: 1,
          revertedAt: null,
          itemId: "package",
        }));
      },
    },
    commissionRedemptionSnapshot: {
      findMany: async ({ where }: { where: { redemptionId: { in: string[] } } }) =>
        largeMonth
          ? where.redemptionId.in.map((id) => ({
              redemptionId: id,
              evidence: evidence(Number(id.split("-")[1]) % 2 ? "colleague" : "actor"),
            }))
          : (snapshotsOverride ?? [
              { redemptionId: "own", evidence: evidence("actor") },
              { redemptionId: "other", evidence: evidence("colleague") },
            ]),
    },
  }),
);
test("own session history includes only the caller's recorded attribution", async () => {
  const data = await runAsTenant("salon", () => ownPayrollSessions({ period: "2026-11" }), "actor");
  assert.equal(data.scope, "SELF");
  assert.equal(data.total, 1);
  assert.equal(data.rows[0].id, "own");
  assert.ok(!JSON.stringify(data).includes("colleague"));
});
test("session self-service refuses caller-supplied staff identity and cashier roles", async () => {
  await assert.rejects(
    runAsTenant(
      "salon",
      () => ownPayrollSessions({ period: "2026-11", staffId: "colleague" }),
      "actor",
    ),
  );
  role = "CASHIER";
  await assert.rejects(
    runAsTenant("salon", () => ownPayrollSessions({ period: "2026-11" }), "actor"),
    /Forbidden/,
  );
  role = "STAFF";
});
test("latest corrections and malformed evidence never fall back to an older own attribution", async () => {
  snapshotsOverride = [
    { redemptionId: "own", evidence: evidence("colleague") },
    { redemptionId: "own", evidence: evidence("actor") },
    { redemptionId: "other", evidence: { version: "malformed" } },
    { redemptionId: "other", evidence: evidence("actor") },
  ];
  try {
    const data = await runAsTenant(
      "salon",
      () => ownPayrollSessions({ period: "2026-11" }),
      "actor",
    );
    assert.equal(data.total, 0);
    assert.deepEqual(data.rows, []);
  } finally {
    snapshotsOverride = null;
  }
});
test("large months scan bounded evidence batches and page only the caller's latest attribution", async () => {
  largeMonth = true;
  batchSizes.length = 0;
  try {
    const data = await runAsTenant(
      "salon",
      () => ownPayrollSessions({ period: "2026-11", page: 12 }),
      "actor",
    );
    assert.equal(data.total, 301);
    assert.equal(data.pages, 13);
    assert.equal(data.rows.length, 25);
    assert.equal(data.rows[0].id, "session-550");
    assert.deepEqual(batchSizes, [250, 250, 250]);
    const last = await runAsTenant(
      "salon",
      () => ownPayrollSessions({ period: "2026-11", page: 13 }),
      "actor",
    );
    assert.equal(last.rows.length, 1);
    assert.equal(last.rows[0].id, "session-600");
  } finally {
    largeMonth = false;
  }
});
