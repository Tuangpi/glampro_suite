import assert from "node:assert/strict";
import { afterEach, beforeEach, it, mock } from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
const { prisma } = await import("../lib/prisma.js");
const { runAsTenant } = await import("../lib/tenant-context.js");
const { quietDayOpportunities } = await import("./quiet-day.service.js");
const { isAppointmentSlotAvailable } = await import("./appointment.service.js");
const restores: Array<() => void> = [];
function replace(target: object, key: string, implementation: unknown) {
  const object = target as Record<string, unknown>;
  const original = object[key];
  object[key] = implementation;
  restores.push(() => {
    object[key] = original;
  });
}
const scope = <T>(fn: () => T) => runAsTenant("quiet-test", fn);
const service = {
  id: "service",
  name: "Facial",
  status: "ACTIVE",
  departmentId: null,
  durationMinutes: 60,
};
const hours = Object.fromEntries(
  ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].flatMap((day) => [
    [`${day}Open`, "09:00"],
    [`${day}Close`, "12:00"],
  ]),
);
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T17:00:00Z") });
  replace(prisma.tenant, "findUnique", async () => ({ timeZone: "Asia/Singapore" }));
  replace(prisma.tenant, "findUniqueOrThrow", async () => ({ timeZone: "Asia/Singapore" }));
  replace(prisma.service, "findFirst", async () => service);
  replace(prisma.tenantOperatingHours, "findUnique", async () => hours);
  replace(prisma.user, "findMany", async () => [{ id: "staff" }]);
  replace(prisma.user, "findFirst", async () => ({
    id: "staff",
    disabled: false,
    departments: [],
  }));
  replace(prisma.staffShift, "findMany", async () => []);
  replace(prisma.appointmentLine, "findFirst", async () => null);
  replace(prisma.appointment, "findFirst", async () => null);
  replace(prisma.appointment, "count", async () => 0);
  replace(prisma.serviceResource, "findMany", async () => []);
});
afterEach(() => {
  restores.reverse().forEach((restore) => restore());
  restores.length = 0;
  mock.timers.reset();
});

it("returns only future salon-local openings accepted by the existing booking checker", async () => {
  const result = await scope(() => quietDayOpportunities({ serviceId: "service", days: 2 }));
  assert.equal(result.from, "2026-10-24T16:00:00.000Z");
  assert.equal(result.to, "2026-10-26T16:00:00.000Z");
  assert.equal(result.opportunities.length, 2);
  assert.equal(result.opportunities[0]?.startsAt, "2026-10-25T01:00:00.000Z");
  assert.equal(result.discountPercentage, 0);
  assert.equal(result.requiresApproval, true);
  for (const opening of result.opportunities)
    assert.equal(
      await scope(() =>
        isAppointmentSlotAvailable(prisma, service.id, opening.staffId, new Date(opening.startsAt)),
      ),
      true,
    );
});
it("skips days with three non-cancelled starts and uses a half-open future window", async () => {
  replace(prisma.appointment, "count", async (args: unknown) => {
    assert.deepEqual(args, {
      where: {
        startsAt: { gte: new Date("2026-10-24T16:00:00Z"), lt: new Date("2026-10-25T16:00:00Z") },
        status: { not: "CANCELLED" },
      },
    });
    return 3;
  });
  const result = await scope(() => quietDayOpportunities({ serviceId: "service", days: 1 }));
  assert.deepEqual(result.opportunities, []);
  assert.equal(result.checkedSlots, 0);
});
it("does not invent openings without operating hours, eligible staff or active resources", async () => {
  replace(prisma.tenantOperatingHours, "findUnique", async () => null);
  assert.deepEqual(
    (await scope(() => quietDayOpportunities({ serviceId: "service", days: 1 }))).opportunities,
    [],
  );
  replace(prisma.tenantOperatingHours, "findUnique", async () => hours);
  replace(prisma.user, "findMany", async () => []);
  assert.deepEqual(
    (await scope(() => quietDayOpportunities({ serviceId: "service", days: 1 }))).opportunities,
    [],
  );
  replace(prisma.user, "findMany", async () => [{ id: "staff" }]);
  replace(prisma.serviceResource, "findMany", async () => [
    {
      serviceId: "service",
      resource: { id: "room", name: "Room", kind: "ROOM", status: "INACTIVE" },
    },
  ]);
  assert.deepEqual(
    (await scope(() => quietDayOpportunities({ serviceId: "service", days: 1 }))).opportunities,
    [],
  );
});
it("honours configured breaks, then half-open staff appointment conflicts", async () => {
  replace(prisma.staffShift, "findMany", async () => [
    {
      dayOfWeek: 0,
      kind: "WORK",
      startsAtMinute: 540,
      endsAtMinute: 720,
      effectiveFrom: null,
      effectiveTo: null,
    },
    {
      dayOfWeek: 0,
      kind: "BREAK",
      startsAtMinute: 540,
      endsAtMinute: 600,
      effectiveFrom: null,
      effectiveTo: null,
    },
  ]);
  replace(prisma.appointment, "findFirst", async (args: unknown) => {
    const where = (
      args as { where: { OR: Array<{ startsAt: { lt: Date }; endsAt: { gt: Date } }> } }
    ).where;
    const slot = where.OR[0]!;
    return slot.endsAt.gt < new Date("2026-10-25T02:30:00Z") &&
      slot.startsAt.lt > new Date("2026-10-25T02:00:00Z")
      ? {
          startsAt: new Date("2026-10-25T02:00:00Z"),
          endsAt: new Date("2026-10-25T02:30:00Z"),
          customer: null,
        }
      : null;
  });
  const result = await scope(() => quietDayOpportunities({ serviceId: "service", days: 1 }));
  assert.equal(result.opportunities[0]?.startsAt, "2026-10-25T02:30:00.000Z");
});
it("caps staff and slot work, reports partial results, and never calls offer writers", async () => {
  replace(prisma.tenantOperatingHours, "findUnique", async () =>
    Object.fromEntries(
      Object.keys(hours).map((key) => [key, key.endsWith("Open") ? "00:00" : "23:59"]),
    ),
  );
  replace(prisma.user, "findMany", async () =>
    Array.from({ length: 11 }, (_, i) => ({ id: `staff-${i}` })),
  );
  replace(prisma.serviceResource, "findMany", async () => [
    {
      serviceId: "service",
      resource: { id: "room", name: "Room", kind: "ROOM", status: "INACTIVE" },
    },
  ]);
  replace(prisma.voucher, "create", () => {
    throw new Error("must not publish");
  });
  replace(prisma.messageJob, "create", () => {
    throw new Error("must not send");
  });
  const result = await scope(() => quietDayOpportunities({ serviceId: "service", days: 7 }));
  assert.equal(result.checkedSlots, 120);
  assert.equal(result.searchLimited, true);
  assert.deepEqual(result.opportunities, []);
});
it("walks real instants across DST and preserves the booking fallback duration", async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T16:00:00Z") });
  replace(prisma.tenant, "findUnique", async () => ({ timeZone: "America/New_York" }));
  replace(prisma.service, "findFirst", async () => ({ ...service, durationMinutes: null }));
  replace(prisma.tenantOperatingHours, "findUnique", async () => ({
    sundayOpen: "01:00",
    sundayClose: "04:00",
  }));
  const result = await scope(() => quietDayOpportunities({ serviceId: "service", days: 1 }));
  assert.equal(result.from, "2026-11-01T04:00:00.000Z");
  assert.equal(result.to, "2026-11-02T05:00:00.000Z");
  assert.equal(result.durationMinutes, 60);
  assert.equal(result.opportunities[0]?.startsAt, "2026-11-01T05:00:00.000Z");
});
it("rejects unscoped access, missing services and unexpected database failures", async () => {
  await assert.rejects(quietDayOpportunities({ serviceId: "service", days: 1 }), /tenant scope/);
  replace(prisma.service, "findFirst", async () => null);
  await assert.rejects(
    scope(() => quietDayOpportunities({ serviceId: "foreign", days: 1 })),
    /Service not found/,
  );
  replace(prisma.service, "findFirst", async () => {
    throw new Error("database unavailable");
  });
  await assert.rejects(
    scope(() => quietDayOpportunities({ serviceId: "service", days: 1 })),
    /database unavailable/,
  );
});
