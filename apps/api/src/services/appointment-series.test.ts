/**
 * Repeating bookings — TK2610-0020 phase C — against the real database.
 *
 * A series is not one row with a rule attached: it is the rule row plus one
 * ordinary booking per occurrence, so the cases below are the ones a naive
 * implementation gets wrong:
 *
 * - the **step is a wall-clock step**, not 168 hours: a weekly 10:00 has to stay
 *   10:00 across a daylight-saving change (tenant A is deliberately in
 *   `America/Los_Angeles`, so the suite sees one);
 * - a later occurrence that **clashes** is skipped and named, while the anchor
 *   still has to be bookable — an empty series is never the answer;
 * - an occurrence outside the performer's **rota** is skipped for the same reason;
 * - **cancelling** the series stops only what is left, and cannot reach another
 *   salon's series at all.
 *
 * Skipped with a clear message when `DATABASE_URL` is absent, like every other
 * database-backed suite here.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { wallClockAt } from "../lib/wall-clock.js";
import {
  cancelAppointmentSeries,
  createAppointment,
  updateAppointment,
} from "./appointment.service.js";

const databaseUrl = process.env["DATABASE_URL"];

const TENANT_A = "appointment-series-a";
const TENANT_B = "appointment-series-b";
const ZONE = "America/Los_Angeles";

interface Seeded {
  serviceId: string;
  customerId: string;
  /** Mira performs every booking below, so a clash is always about one person. */
  miraId: string;
}

let seeded: Seeded | undefined;

/** The suite's shared seed, or a loud failure rather than a silent `undefined`. */
function requireSeeded(): Seeded {
  if (!seeded) throw new Error("the suite's `before(seed)` did not run");
  return seeded;
}

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    const ids = [TENANT_A, TENANT_B];
    await prisma.appointment.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.appointmentSeries.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.staffShift.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.staffDepartment.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.department.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@appointment-series.test" } } });
  });
}

async function seed(): Promise<void> {
  await purge();

  await runAsPlatform(async () => {
    await prisma.tenant.create({
      data: {
        id: TENANT_A,
        name: `Salon ${TENANT_A}`,
        slug: TENANT_A,
        // A DST zone on purpose: a weekly step added as fixed milliseconds drifts
        // an hour twice a year, and only a zone that changes offset can prove it.
        timeZone: ZONE,
      },
    });
    await prisma.tenant.create({
      data: { id: TENANT_B, name: `Salon ${TENANT_B}`, slug: TENANT_B },
    });

    for (const id of [TENANT_A, TENANT_B]) {
      const owner = await prisma.user.create({
        data: {
          tenantId: id,
          email: `owner-${id}@appointment-series.test`,
          name: `Owner ${id}`,
          passwordHash: "not-a-real-hash",
        },
      });
      await prisma.tenant.update({ where: { id }, data: { ownerUserId: owner.id } });
    }

    const branch = await prisma.department.create({ data: { tenantId: TENANT_A, name: "Hair" } });
    const mira = await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: "mira@appointment-series.test",
        name: "Mira Moss",
        passwordHash: "not-a-real-hash",
      },
    });
    await prisma.staffDepartment.create({
      data: { tenantId: TENANT_A, userId: mira.id, departmentId: branch.id },
    });

    const service = await prisma.service.create({
      data: {
        tenantId: TENANT_A,
        departmentId: branch.id,
        name: "Cut and finish",
        memberPrice: "35.00",
        nonmemberPrice: "40.00",
        durationMinutes: 45,
      },
    });
    const customer = await prisma.customer.create({
      data: { tenantId: TENANT_A, name: "Casey Client" },
    });

    seeded = { serviceId: service.id, customerId: customer.id, miraId: mira.id };
  });
}

describe(
  "appointment series, against the database",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    before(seed);
    after(async () => {
      await purge();
      await prisma.$disconnect();
    });

    /** Every write below runs inside tenant A's scope, as a real handler would. */
    function asTenantA<T>(fn: () => Promise<T>): Promise<T> {
      return runAsTenant(TENANT_A, fn);
    }

    /** One series' bookings in order, read unscoped so the rows are the evidence. */
    function occurrencesOf(seriesId: string) {
      return runAsPlatform(() =>
        prisma.appointment.findMany({
          where: { seriesId },
          orderBy: { seriesIndex: "asc" },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            status: true,
            seriesIndex: true,
            durationMinutes: true,
            lines: { select: { position: true, startsAt: true, endsAt: true } },
          },
        }),
      );
    }

    function seriesCount(): Promise<number> {
      return runAsPlatform(() => prisma.appointmentSeries.count({ where: { tenantId: TENANT_A } }));
    }

    it("writes one booking per week and reports the rule it used", async () => {
      const s = requireSeeded();

      const created = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.serviceId,
          // 10:00 in Los Angeles, three weeks running — across the 10 March 2030
          // spring-forward, so the third occurrence is the same *clock* time.
          startsAt: "2030-03-06T18:00:00.000Z",
          repeat: { intervalWeeks: 1, occurrences: 3 },
        }),
      );

      assert.ok(created.series, "a repeat answers with its report");
      assert.equal(created.series.intervalWeeks, 1);
      assert.equal(created.series.occurrences, 3);
      assert.equal(created.series.created, 3);
      assert.deepEqual(created.series.skipped, []);
      // The anchor is the booking the desk asked for, and it knows its own place.
      assert.deepEqual(created.appointment.series, {
        id: created.series.id,
        intervalWeeks: 1,
        occurrences: 3,
        index: 0,
      });

      const rows = await occurrencesOf(created.series.id);
      assert.deepEqual(
        rows.map((row) => row.startsAt.toISOString()),
        [
          "2030-03-06T18:00:00.000Z",
          // Still 10:00 locally after the clocks moved: a fixed +168h would read
          // 19:00Z here and put the second week's booking at 11:00.
          "2030-03-13T17:00:00.000Z",
          "2030-03-20T17:00:00.000Z",
        ],
      );
      assert.deepEqual(
        rows.map((row) => wallClockAt(row.startsAt, ZONE).minutes),
        [10 * 60, 10 * 60, 10 * 60],
        "every occurrence keeps the salon's 10:00",
      );
      assert.deepEqual(
        rows.map((row) => row.seriesIndex),
        [0, 1, 2],
      );
      assert.deepEqual(
        rows.map((row) => row.durationMinutes),
        [45, 45, 45],
      );
      // Each occurrence is a normal booking with its own line — not a special case
      // every later reader would have to know about.
      for (const row of rows) {
        assert.deepEqual(
          row.lines.map((line) => [
            line.position,
            line.startsAt.toISOString(),
            line.endsAt.toISOString(),
          ]),
          [[0, row.startsAt.toISOString(), row.endsAt.toISOString()]],
        );
      }

      // The rule row belongs to the caller's salon, like every other scoped model.
      const seriesRow = await runAsPlatform(() =>
        prisma.appointmentSeries.findUniqueOrThrow({ where: { id: created.series!.id } }),
      );
      assert.equal(seriesRow.tenantId, TENANT_A);

      // A one-off is still a one-off: no rule, no report.
      const oneOff = await asTenantA(() =>
        createAppointment({
          staffId: s.miraId,
          serviceId: s.serviceId,
          startsAt: "2030-08-07T17:00:00.000Z",
        }),
      );
      assert.equal(oneOff.series, null);
      assert.equal(oneOff.appointment.series, null);
    });

    it("skips a date the book already holds and reports which one", async () => {
      const s = requireSeeded();

      // Mira is already busy on the would-be third week.
      const taken = await asTenantA(() =>
        createAppointment({
          staffId: s.miraId,
          serviceId: s.serviceId,
          startsAt: "2030-04-17T17:00:00.000Z",
        }),
      );

      const created = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.serviceId,
          startsAt: "2030-04-03T17:00:00.000Z",
          repeat: { intervalWeeks: 1, occurrences: 3 },
        }),
      );

      assert.ok(created.series);
      assert.equal(created.series.created, 2, "the anchor and the second week held");
      assert.equal(created.series.occurrences, 3, "the rule still says three");
      assert.deepEqual(
        created.series.skipped.map((skip) => skip.startsAt),
        ["2030-04-17T17:00:00.000Z"],
      );
      assert.match(created.series.skipped[0]!.reason, /already taken/i);

      const rows = await occurrencesOf(created.series.id);
      assert.deepEqual(
        rows.map((row) => row.seriesIndex),
        [0, 1],
        "index 2 was never written",
      );
      // The booking that held the slot is untouched and not part of the series.
      const blocker = await runAsPlatform(() =>
        prisma.appointment.findUniqueOrThrow({
          where: { id: taken.appointment.id },
          select: { seriesId: true, status: true },
        }),
      );
      assert.equal(blocker.seriesId, null);
      assert.equal(blocker.status, "SCHEDULED");
    });

    it("refuses the whole request when the anchor itself is taken", async () => {
      const s = requireSeeded();
      const before = await seriesCount();

      await assert.rejects(
        asTenantA(() =>
          createAppointment({
            customerId: s.customerId,
            staffId: s.miraId,
            serviceId: s.serviceId,
            // 17 April is held by the case above: the desk picked a busy time, and
            // must be told so rather than handed a series with no first booking.
            startsAt: "2030-04-17T17:00:00.000Z",
            repeat: { intervalWeeks: 1, occurrences: 2 },
          }),
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError, "expected an HttpError");
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "APPOINTMENT_CLASH");
          return true;
        },
      );

      assert.equal(await seriesCount(), before, "a refused anchor writes no rule row");
    });

    it("skips an occurrence that falls outside the performer's rota", async () => {
      const s = requireSeeded();

      // A rota that covers only the anchor's week: the later weeks have the row
      // but outside its effective window, which the availability gate refuses.
      const shift = await runAsPlatform(() =>
        prisma.staffShift.create({
          data: {
            tenantId: TENANT_A,
            userId: s.miraId,
            dayOfWeek: 3, // Wednesday
            startsAtMinute: 9 * 60,
            endsAtMinute: 11 * 60,
            effectiveFrom: new Date("2030-06-01T00:00:00.000Z"),
            effectiveTo: new Date("2030-06-09T00:00:00.000Z"),
          },
        }),
      );

      try {
        const created = await asTenantA(() =>
          createAppointment({
            customerId: s.customerId,
            staffId: s.miraId,
            serviceId: s.serviceId,
            startsAt: "2030-06-05T17:00:00.000Z",
            repeat: { intervalWeeks: 1, occurrences: 3 },
          }),
        );

        assert.ok(created.series);
        assert.equal(created.series.created, 1);
        assert.deepEqual(
          created.series.skipped.map((skip) => skip.startsAt),
          ["2030-06-12T17:00:00.000Z", "2030-06-19T17:00:00.000Z"],
        );
        for (const skip of created.series.skipped) {
          assert.match(skip.reason, /working hours|break/i);
        }
      } finally {
        await runAsPlatform(() => prisma.staffShift.delete({ where: { id: shift.id } }));
      }
    });

    it("cancels only what is left of the series, and only inside its salon", async () => {
      const s = requireSeeded();

      const created = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.serviceId,
          startsAt: "2030-05-01T17:00:00.000Z",
          repeat: { intervalWeeks: 1, occurrences: 3 },
        }),
      );
      const seriesId = created.series!.id;
      const [first] = await occurrencesOf(seriesId);

      // The first visit happened; the rest are still ahead.
      await asTenantA(() => updateAppointment(first!.id, { status: "COMPLETED" }));

      const outsideBefore = await runAsPlatform(() =>
        prisma.appointment.count({ where: { tenantId: TENANT_A, seriesId: null } }),
      );

      const result = await asTenantA(() => cancelAppointmentSeries(seriesId));
      assert.equal(result.cancelled, 2, "only the future occurrences were cancelled");

      const rows = await occurrencesOf(seriesId);
      assert.deepEqual(
        rows.map((row) => row.status),
        ["COMPLETED", "CANCELLED", "CANCELLED"],
      );

      const outsideAfter = await runAsPlatform(() =>
        prisma.appointment.count({ where: { tenantId: TENANT_A, seriesId: null } }),
      );
      assert.equal(outsideAfter, outsideBefore, "bookings outside the series are untouched");

      // Another salon cannot even see the rule, let alone stop it.
      await assert.rejects(
        runAsTenant(TENANT_B, () => cancelAppointmentSeries(seriesId)),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 404);
          assert.equal(error.code, "APPOINTMENT_SERIES_NOT_FOUND");
          return true;
        },
      );
    });
  },
);
