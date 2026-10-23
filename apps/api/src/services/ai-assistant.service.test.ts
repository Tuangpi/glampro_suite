import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
const { prisma } = await import("../lib/prisma.js");
const { Prisma } = await import("../../generated/prisma/client.js");
const { runAsTenant } = await import("../lib/tenant-context.js");
const { aiAssistantService: assistant } = await import("./ai-assistant.service.js");
const { assistantRangeSchema, rebookingQuerySchema, promoQuerySchema } =
  await import("../schemas/ai-assistant.js");

const restores: Array<() => void> = [];
function replace(target: object, key: string, implementation: unknown) {
  const record = target as Record<string, unknown>;
  const original = record[key];
  record[key] = implementation;
  restores.push(() => {
    record[key] = original;
  });
}
const scoped = <T>(fn: () => T) => runAsTenant("assistant-unit", fn);
const now = new Date("2026-10-23T17:00:00Z"); // October 24 at the salon.

beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now });
  replace(prisma.tenant, "findUnique", async () => ({
    timeZone: "Asia/Singapore",
    lowStockThreshold: 4,
  }));
});
afterEach(() => {
  restores.reverse().forEach((restore) => restore());
  restores.length = 0;
  mock.timers.reset();
});

describe("assistant query contracts", () => {
  it("rejects invalid, repeated, reversed and unknown query values", () => {
    for (const query of [
      { from: "2026-02-30" },
      { from: "bad" },
      { from: ["2026-01-01"] },
      { from: "2026-10-24", to: "2026-10-23" },
      { tenantId: "foreign" },
      { from: "2026-10-24T00:00:00Z", to: "2026-10-23T00:00:00+00:00" },
    ])
      assert.equal(assistantRangeSchema.safeParse(query).success, false);
    for (const value of ["", "NaN", "Infinity", "0", "-1", "1.5", "3651"])
      assert.equal(rebookingQuerySchema.safeParse({ daysThreshold: value }).success, false);
    for (const value of ["", "NaN", "Infinity", "0", "-5", "101"])
      assert.equal(promoQuerySchema.safeParse({ discountPercentage: value }).success, false);
    assert.equal(rebookingQuerySchema.parse({ daysThreshold: "90" }).daysThreshold, 90);
    assert.equal(promoQuerySchema.parse({ discountPercentage: "12.5" }).discountPercentage, 12.5);
  });
});

describe("owner summary", () => {
  function metrics() {
    replace(prisma.sale, "aggregate", async (args: unknown) => {
      const { where } = args as { where: { status: string; soldAt: { gte: Date; lt: Date } } };
      assert.equal(where.status, "COMPLETED");
      return { _sum: { paidAmount: new Prisma.Decimal("100.01") }, _count: { _all: 3 } };
    });
    replace(prisma.appointment, "count", async () => 8);
    replace(prisma.customer, "count", async () => 2);
    replace(prisma.saleRefund, "aggregate", async () => ({
      _sum: { amount: new Prisma.Decimal("5.25") },
    }));
    replace(prisma.product, "count", async (args: unknown) => {
      assert.deepEqual(args, { where: { status: "ACTIVE", quantity: { lte: 4 } } });
      return 1;
    });
  }
  it("defaults every time-based metric to the same salon-local day and divides by receipts", async () => {
    metrics();
    const window = { gte: new Date("2026-10-23T16:00:00Z"), lt: new Date("2026-10-24T16:00:00Z") };
    replace(prisma.sale, "aggregate", async (args: unknown) => {
      assert.deepEqual(args, {
        where: { status: "COMPLETED", soldAt: window },
        _sum: { paidAmount: true },
        _count: { _all: true },
      });
      return { _sum: { paidAmount: new Prisma.Decimal("100.01") }, _count: { _all: 3 } };
    });
    replace(prisma.appointment, "count", async (args: unknown) => {
      assert.deepEqual(args, { where: { startsAt: window, status: { not: "CANCELLED" } } });
      return 8;
    });
    replace(prisma.customer, "count", async (args: unknown) => {
      assert.deepEqual(args, { where: { createdAt: window } });
      return 2;
    });
    replace(prisma.saleRefund, "aggregate", async (args: unknown) => {
      assert.deepEqual(args, { where: { refundedAt: window }, _sum: { amount: true } });
      return { _sum: { amount: new Prisma.Decimal("5.25") } };
    });
    assert.deepEqual(await scoped(() => assistant.ownerSummary({})), {
      incomeToday: "100.01",
      appointmentsToday: 8,
      newCustomersToday: 2,
      lowStockCount: 1,
      refundsToday: "5.25",
      averageTicket: "33.34",
    });
  });
  it("includes the full date-only end day and handles a DST day", async () => {
    metrics();
    replace(prisma.tenant, "findUnique", async () => ({
      timeZone: "America/New_York",
      lowStockThreshold: 4,
    }));
    replace(prisma.sale, "aggregate", async (args: unknown) => {
      const window = (args as { where: { soldAt: unknown } }).where.soldAt;
      assert.deepEqual(window, {
        gte: new Date("2026-11-01T04:00:00Z"),
        lt: new Date("2026-11-02T05:00:00Z"),
      });
      return { _sum: { paidAmount: null }, _count: { _all: 0 } };
    });
    assert.equal(
      (await scoped(() => assistant.ownerSummary({ from: "2026-11-01", to: "2026-11-01" })))
        .averageTicket,
      "0.00",
    );
  });
  it("rejects missing tenant scope and resolved reversed mixed edges", async () => {
    await assert.rejects(assistant.ownerSummary({}), /tenant scope/);
    await assert.rejects(
      scoped(() => assistant.ownerSummary({ from: "2026-10-24T17:00:00Z", to: "2026-10-24" })),
      { statusCode: 400 },
    );
  });
});

describe("rebooking drafts", () => {
  it("uses latest completed visit, both consents, no upcoming booking and mandatory approval", async () => {
    replace(prisma.customer, "findMany", async (args: unknown) => {
      const query = args as { where: unknown; select: { appointments: unknown } };
      assert.deepEqual(query.where, {
        archivedAt: null,
        marketingOptIn: true,
        pdpaConsent: true,
        email: { not: null },
        appointments: {
          none: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, endsAt: { gt: now } },
        },
      });
      assert.deepEqual(query.select.appointments, {
        where: { status: "COMPLETED", endsAt: { lte: now } },
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        take: 1,
        select: { startsAt: true, service: { select: { name: true } } },
      });
      const customer = (id: string, startsAt: string, email = "person@example.test") => ({
        id,
        name: id,
        email,
        appointments: [{ startsAt: new Date(startsAt), service: { name: "Facial" } }],
      });
      return [
        customer("overdue", "2026-07-01T17:00:00Z"),
        customer("recent", "2026-10-22T17:00:00Z"),
        customer("blank", "2026-07-01T17:00:00Z", " "),
      ];
    });
    const result = await scoped(() => assistant.rebookingNudges({}));
    assert.equal(result.requiresApproval, true);
    assert.equal(result.nudges.length, 1);
    assert.equal(result.nudges[0]?.customerId, "overdue");
    assert.equal(result.nudges[0]?.lastServiceDate, "2026-07-02");
    assert.equal(result.nudges[0]?.suggestedRebookDate, "2026-11-23");
    assert.equal(result.nudges[0]?.daysSinceLastService, 114);
    assert.deepEqual(await scoped(() => assistant.rebookingNudges({ from: "2026-08-01" })), {
      nudges: [],
      requiresApproval: true,
    });
  });
});

describe("promo drafts", () => {
  it("uses a valid status filter and 30 full local days; draft validity is future, not historical", async () => {
    replace(prisma.appointment, "count", async (args: unknown) => {
      assert.deepEqual(args, {
        where: {
          startsAt: { gte: new Date("2026-09-23T16:00:00Z"), lt: new Date("2026-10-23T16:00:00Z") },
          status: { not: "CANCELLED" },
        },
      });
      return 0;
    });
    replace(prisma.service, "findMany", async () => [{ id: "s", name: "Facial" }]);
    replace(prisma.product, "findMany", async (args: unknown) => {
      assert.deepEqual((args as { where: unknown }).where, {
        status: "ACTIVE",
        quantity: { gt: 0 },
      });
      return [{ id: "p", name: "Cream" }];
    });
    const promos = await scoped(() => assistant.slowDayPromos({ discountPercentage: 20 }));
    assert.equal(promos.length, 2);
    assert.equal(promos[0]?.validFrom, "2026-10-25");
    assert.equal(promos[0]?.validTo, "2026-10-31");
    assert.equal(promos[0]?.discountPercentage, 20);
    assert.match(promos[0]!.description, /approval required/);
    assert.deepEqual(
      await scoped(() => assistant.slowDayPromos({ discountPercentage: 20 })),
      promos,
    );
  });
  it("does not propose promos when average volume reaches three per calendar day", async () => {
    replace(prisma.appointment, "count", async () => 6);
    replace(prisma.service, "findMany", () => {
      throw new Error("must not read catalogue");
    });
    assert.deepEqual(
      await scoped(() => assistant.slowDayPromos({ from: "2026-10-01", to: "2026-10-02" })),
      [],
    );
  });
});
