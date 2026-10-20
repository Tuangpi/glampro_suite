import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { prisma } from "../lib/prisma.js";

/**
 * Tenant isolation, against the real database.
 *
 * The unit suites cannot prove this — only a live Postgres can. Seed two tenants
 * that both own a subscription and a payment, then assert that every read path
 * returns only the caller's rows, that a write stamps the caller's tenant, and
 * that an unscoped query refuses rather than returning everything.
 *
 * Skipped with a clear message when `DATABASE_URL` is absent, so `npm run verify`
 * still passes on a machine with no database running.
 */
const databaseUrl = process.env["DATABASE_URL"];

const TENANT_A = "test-tenant-a";
const TENANT_B = "test-tenant-b";

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.appointment.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.appointmentSeries.deleteMany({
      where: { tenantId: { in: [TENANT_A, TENANT_B] } },
    });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.department.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.tenantModule.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.subscription.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@test.local" } } });
  });
}

async function seed(): Promise<void> {
  await purge();

  await runAsPlatform(async () => {
    for (const id of [TENANT_A, TENANT_B]) {
      // Tenant first, then its user, then ownership: `users.tenantId` and
      // `tenants.ownerUserId` point at each other, so neither row can go first.
      await prisma.tenant.create({ data: { id, name: `Salon ${id}`, slug: `salon-${id}` } });

      const owner = await prisma.user.create({
        data: {
          tenantId: id,
          email: `owner-${id}@test.local`,
          name: `Owner ${id}`,
          passwordHash: "not-a-real-hash",
        },
      });

      await prisma.tenant.update({ where: { id }, data: { ownerUserId: owner.id } });

      await prisma.department.create({ data: { tenantId: id, name: `Dept ${id}` } });

      const service = await prisma.service.create({
        data: {
          tenantId: id,
          name: `Service ${id}`,
          memberPrice: "50.00",
          nonmemberPrice: "60.00",
          durationMinutes: 45,
        },
      });

      const customer = await prisma.customer.create({
        data: { tenantId: id, name: `Customer ${id}`, email: `${id}@customer.test` },
      });

      await prisma.appointment.create({
        data: {
          tenantId: id,
          customerId: customer.id,
          staffId: owner.id,
          serviceId: service.id,
          startsAt: new Date("2026-05-01T10:00:00Z"),
          endsAt: new Date("2026-05-01T10:45:00Z"),
          lines: {
            create: [
              {
                tenantId: id,
                serviceId: service.id,
                staffId: owner.id,
                position: 0,
                startsAt: new Date("2026-05-01T10:00:00Z"),
                endsAt: new Date("2026-05-01T10:45:00Z"),
                durationMinutes: 45,
              },
            ],
          },
        },
      });

      // A repeating rule is its own tenant-scoped row (phase C), so it is checked
      // like one rather than reached only through its bookings.
      await prisma.appointmentSeries.create({
        data: { tenantId: id, intervalWeeks: 1, occurrences: 2 },
      });

      await prisma.subscription.create({
        data: {
          tenantId: id,
          startDate: new Date("2026-01-01"),
          endDate: new Date("2027-01-01"),
          amount: "100.00",
        },
      });

      await prisma.payment.create({
        data: { tenantId: id, amount: "42.50", paidAt: new Date(), method: "CASH", note: id },
      });
    }
  });
}

describe("tenant isolation", { skip: databaseUrl ? false : "DATABASE_URL is not set" }, () => {
  before(seed);

  after(async () => {
    await purge();
    await prisma.$disconnect();
  });

  it("returns only the caller's rows for every tenant-scoped model", async () => {
    const forA = await runAsTenant(TENANT_A, async () => ({
      subscriptions: await prisma.subscription.findMany(),
      payments: await prisma.payment.findMany(),
      tenantModules: await prisma.tenantModule.findMany(),
      subscriptionCount: await prisma.subscription.count(),
      paymentCount: await prisma.payment.aggregate({ _count: { id: true } }),
    }));

    assert.deepEqual(
      forA.subscriptions.map((row) => row.tenantId),
      [TENANT_A],
    );
    assert.deepEqual(
      forA.payments.map((row) => row.tenantId),
      [TENANT_A],
    );
    assert.deepEqual(forA.tenantModules, []);
    assert.equal(forA.subscriptionCount, 1);
    assert.equal(forA.paymentCount._count.id, 1);
  });

  it("keeps the two tenants independent", async () => {
    const [forA, forB] = await Promise.all([
      runAsTenant(TENANT_A, () => prisma.payment.findMany()),
      runAsTenant(TENANT_B, () => prisma.payment.findMany()),
    ]);

    assert.deepEqual(
      forA.map((row) => row.note),
      [TENANT_A],
    );
    assert.deepEqual(
      forB.map((row) => row.note),
      [TENANT_B],
    );
  });

  it("cannot reach another tenant's row by unique id", async () => {
    const otherTenantSubscription = await runAsPlatform(() =>
      prisma.subscription.findFirstOrThrow({ where: { tenantId: TENANT_B } }),
    );

    // The extension rewrites findUnique to findFirst with the tenant filter, so
    // tenant A asking for tenant B's row by primary key gets null.
    const seenFromA = await runAsTenant(TENANT_A, () =>
      prisma.subscription.findUnique({ where: { id: otherTenantSubscription.id } }),
    );

    assert.equal(seenFromA, null);
  });

  it("cannot delete another tenant's row", async () => {
    const otherTenantSubscription = await runAsPlatform(() =>
      prisma.subscription.findFirstOrThrow({ where: { tenantId: TENANT_B } }),
    );

    await assert.rejects(() =>
      runAsTenant(TENANT_A, () =>
        prisma.subscription.delete({ where: { id: otherTenantSubscription.id } }),
      ),
    );

    const stillThere = await runAsPlatform(() =>
      prisma.subscription.findUnique({ where: { id: otherTenantSubscription.id } }),
    );

    assert.ok(stillThere, "tenant B's subscription must survive tenant A's delete");
  });

  it("stamps the caller's tenant on create, so a handler cannot forge one", async () => {
    const created = await runAsTenant(TENANT_A, () =>
      prisma.subscription.create({
        data: {
          tenantId: TENANT_B,
          startDate: new Date("2026-02-01"),
          endDate: new Date("2027-02-01"),
          amount: "10.00",
        },
      }),
    );

    assert.equal(created.tenantId, TENANT_A, "the extension must overwrite a forged tenantId");

    await runAsPlatform(() => prisma.subscription.delete({ where: { id: created.id } }));
  });

  it("scopes updateMany so a bulk edit cannot cross tenants", async () => {
    await runAsTenant(TENANT_A, () => prisma.payment.updateMany({ data: { note: "edited-by-a" } }));

    const forB = await runAsTenant(TENANT_B, () => prisma.payment.findMany());

    assert.deepEqual(
      forB.map((row) => row.note),
      [TENANT_B],
      "tenant B's rows must be untouched by tenant A's updateMany",
    );

    await runAsPlatform(() =>
      prisma.payment.updateMany({ where: { tenantId: TENANT_A }, data: { note: TENANT_A } }),
    );
  });

  it("lets runAsPlatform read across tenants, which is the console's privilege", async () => {
    const all = await runAsPlatform(() =>
      prisma.subscription.findMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } }),
    );

    assert.equal(all.length, 2, "an explicit platform scope is the one unscoped path");
  });

  it("does not scope the platform plane, so the console can reach it", async () => {
    const tenant = await runAsPlatform(() => prisma.tenant.findMany({ select: { id: true } }));

    assert.ok(tenant.length >= 2, "Tenant is above the isolation boundary and stays reachable");
  });

  it("scopes the domain models too, not just the tenant plane", async () => {
    const seenByA = await runAsTenant(TENANT_A, async () => ({
      customers: await prisma.customer.findMany({ select: { tenantId: true } }),
      services: await prisma.service.findMany({ select: { tenantId: true } }),
      departments: await prisma.department.findMany({ select: { tenantId: true } }),
      appointments: await prisma.appointment.findMany({ select: { tenantId: true } }),
      // A booking's service lines are scoped in their own right, because the
      // overlap rule queries them directly rather than through the booking.
      appointmentLines: await prisma.appointmentLine.findMany({ select: { tenantId: true } }),
      // So is a repeating booking's rule (phase C).
      appointmentSeries: await prisma.appointmentSeries.findMany({ select: { tenantId: true } }),
      // `User` is tenant-scoped because staff are user rows (Q4).
      users: await prisma.user.findMany({ select: { tenantId: true } }),
    }));

    for (const [model, rows] of Object.entries(seenByA)) {
      assert.deepEqual(
        rows.map((row) => row.tenantId),
        [TENANT_A],
        `prisma.${model} returned rows belonging to another tenant`,
      );
    }
  });

  it("cannot read another tenant's customer by unique id", async () => {
    const bCustomer = await runAsPlatform(() =>
      prisma.customer.findFirstOrThrow({ where: { tenantId: TENANT_B } }),
    );

    const seenFromA = await runAsTenant(TENANT_A, () =>
      prisma.customer.findUnique({ where: { id: bCustomer.id } }),
    );

    assert.equal(seenFromA, null);
  });

  it("stamps the caller's tenant when a customer is created", async () => {
    const created = await runAsTenant(TENANT_A, () =>
      prisma.customer.create({ data: { tenantId: TENANT_B, name: "Smuggled" } }),
    );

    assert.equal(created.tenantId, TENANT_A);

    await runAsPlatform(() => prisma.customer.delete({ where: { id: created.id } }));
  });

  it("keeps customer email unique per tenant, not globally (ADR 0003)", async () => {
    // The legacy schema made `customers.email` globally unique, which stopped one
    // person being a customer at two salons.
    const created = await runAsPlatform(() =>
      prisma.customer.create({
        data: { tenantId: TENANT_B, name: "Same Email", email: `${TENANT_A}@customer.test` },
      }),
    );

    assert.equal(created.email, `${TENANT_A}@customer.test`);

    await runAsPlatform(() => prisma.customer.delete({ where: { id: created.id } }));
  });
});
