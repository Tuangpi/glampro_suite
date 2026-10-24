import assert from "node:assert/strict";
import { afterEach, beforeEach, it, mock } from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused@127.0.0.1:1/unused";
const { prisma } = await import("../lib/prisma.js");
const { runAsTenant, runAsPlatform } = await import("../lib/tenant-context.js");
const { assistantDraftOutcome } = await import("./assistant-outcomes.service.js");
const restores: Array<() => void> = [];
function replace(target: object, key: string, value: unknown) {
  const record = target as Record<string, unknown>;
  const original = record[key];
  record[key] = value;
  restores.push(() => {
    record[key] = original;
  });
}
const scoped = () => runAsTenant("salon", () => assistantDraftOutcome("draft"), "manager");
let modules: string[];
let bookingQueries: unknown[];
let saleQueries: unknown[];
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-24T12:00:00Z") });
  modules = ["dashboard", "customers", "appointments", "sales"];
  bookingQueries = [];
  saleQueries = [];
  replace(prisma.user, "findFirst", async () => ({ globalRole: "MANAGER" }));
  replace(prisma.tenant, "findUniqueOrThrow", async () => ({
    status: "ACTIVE",
    timeZone: "UTC",
    subscriptions: [],
  }));
  replace(prisma.module, "findMany", async () => modules.map((code) => ({ code, isCore: true })));
  replace(prisma.tenantModule, "findMany", async () => []);
  replace(prisma.assistantDraft, "findFirst", async (query: { where: unknown }) => {
    assert.deepEqual(query.where, { id: "draft", tenantId: "salon" });
    return {
      customerId: "customer",
      job: { status: "ACCEPTED", createdAt: new Date("2026-10-01T00:00:00Z") },
    };
  });
  replace(prisma.appointment, "count", async (query: unknown) => {
    bookingQueries.push(query);
    return 2;
  });
  replace(prisma.sale, "count", async (query: unknown) => {
    saleQueries.push(query);
    return 1;
  });
});
afterEach(() => {
  restores.reverse().forEach((fn) => fn());
  restores.length = 0;
  mock.timers.reset();
});
it("reports same-customer observations with exact half-open bounds and no causal claim", async () => {
  const result = await scoped();
  assert.equal(result.delivery, "not_confirmed");
  assert.equal(result.bookingsCreated, 2);
  assert.equal(result.completedSales, 1);
  assert.deepEqual(bookingQueries, [
    {
      where: {
        tenantId: "salon",
        customerId: "customer",
        createdAt: { gte: new Date(result.from!), lt: new Date(result.to!) },
        status: { not: "CANCELLED" },
      },
    },
  ]);
  assert.deepEqual(saleQueries, [
    {
      where: {
        tenantId: "salon",
        customerId: "customer",
        soldAt: { gte: new Date(result.from!), lt: new Date(result.to!) },
        status: "COMPLETED",
      },
    },
  ]);
  assert.equal(result.to, "2026-10-24T12:00:00.000Z");
  assert.match(result.limitations.join(" "), /not attributed conversions/);
  assert.match(result.limitations.join(" "), /Do not sum across drafts/);
});
it("caps observations at 30 elapsed days without treating failure as conversion", async () => {
  replace(prisma.assistantDraft, "findFirst", async () => ({
    customerId: "customer",
    job: { status: "FAILED", createdAt: new Date("2026-09-01T00:00:00Z") },
  }));
  const result = await scoped();
  assert.equal(result.to, "2026-10-01T00:00:00.000Z");
  assert.equal(result.delivery, "not_confirmed");
});
it("does not query sales without sales entitlement", async () => {
  modules = modules.filter((code) => code !== "sales");
  const result = await scoped();
  assert.equal(result.salesVisible, false);
  assert.equal(result.completedSales, null);
  assert.equal(saleQueries.length, 0);
});
it("does not invent zero outcomes before queueing", async () => {
  replace(prisma.assistantDraft, "findFirst", async () => ({ customerId: "customer", job: null }));
  const result = await scoped();
  assert.equal(result.delivery, "not_queued");
  assert.equal(result.from, null);
  assert.equal(result.bookingsCreated, null);
  assert.equal(result.completedSales, null);
  assert.equal(bookingQueries.length, 0);
});
it("refuses platform scope, missing actors, staff and missing modules", async () => {
  await assert.rejects(runAsPlatform(() => assistantDraftOutcome("draft")));
  await assert.rejects(runAsTenant("salon", () => assistantDraftOutcome("draft")));
  replace(prisma.user, "findFirst", async () => ({ globalRole: "STAFF" }));
  await assert.rejects(scoped());
  replace(prisma.user, "findFirst", async () => ({ globalRole: "MANAGER" }));
  modules = ["dashboard"];
  await assert.rejects(scoped());
  assert.equal(bookingQueries.length, 0);
});
it("refuses missing/foreign drafts and propagates source failure instead of fabricated zeroes", async () => {
  replace(prisma.assistantDraft, "findFirst", async () => null);
  await assert.rejects(scoped());
  replace(prisma.assistantDraft, "findFirst", async () => ({
    customerId: "customer",
    job: { status: "DELIVERED", createdAt: new Date("2026-10-01T00:00:00Z") },
  }));
  replace(prisma.appointment, "count", async () => {
    throw new Error("source unavailable");
  });
  await assert.rejects(scoped(), /source unavailable/);
});
