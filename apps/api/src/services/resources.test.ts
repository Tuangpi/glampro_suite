/**
 * Rooms and equipment — TK2610-0020 phase D — against the real database.
 *
 * The cases below are the ones that separate "a room is an attribute" from "a
 * room is occupied":
 *
 * - a line **takes** one resource from the service's eligible set, so the second
 *   overlapping booking of a one-room service is refused even when the second
 *   performer is free;
 * - a service linked to two rooms **fails over** to the one that is free;
 * - the overlap is **half-open** and a **cancelled** booking frees its room, the
 *   same rules the performer check keeps (ADR 0014 §3);
 * - a service the salon has not tied to anything books exactly as before, and an
 *   archived room produces `RESOURCE_UNAVAILABLE` rather than a silent booking;
 * - a reschedule does not trip over the room it already holds, and a series skips
 *   the occurrence whose room is taken instead of losing the whole run;
 * - another salon's rooms are invisible.
 *
 * Skipped with a clear message when `DATABASE_URL` is absent, like every other
 * database-backed suite here.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createAppointment, updateAppointment } from "./appointment.service.js";
import { listResources, updateResource } from "./resource.service.js";

const databaseUrl = process.env["DATABASE_URL"];

const TENANT_A = "resources-a";
const TENANT_B = "resources-b";

interface Seeded {
  colourServiceId: string;
  cutServiceId: string;
  consultServiceId: string;
  steamServiceId: string;
  customerId: string;
  miraId: string;
  niaId: string;
  room1Id: string;
  room2Id: string;
  steamerId: string;
}

let seeded: Seeded | undefined;

function requireSeeded(): Seeded {
  if (!seeded) throw new Error("the suite's `before(seed)` did not run");
  return seeded;
}

/** A booking's time on `DAY`, expressed as an instant so the assertions are exact. */
function at(day: string, hour: number, minute = 0): string {
  return `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    const ids = [TENANT_A, TENANT_B];
    await prisma.appointment.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.serviceResource.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.resource.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.department.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@resources.test" } } });
  });
}

async function seed(): Promise<void> {
  await purge();

  await runAsPlatform(async () => {
    await prisma.tenant.create({ data: { id: TENANT_A, name: "Salon A", slug: TENANT_A } });
    await prisma.tenant.create({ data: { id: TENANT_B, name: "Salon B", slug: TENANT_B } });

    for (const id of [TENANT_A, TENANT_B]) {
      const owner = await prisma.user.create({
        data: {
          tenantId: id,
          email: `owner-${id}@resources.test`,
          name: `Owner ${id}`,
          passwordHash: "not-a-real-hash",
        },
      });
      await prisma.tenant.update({ where: { id }, data: { ownerUserId: owner.id } });
    }

    const branch = await prisma.department.create({ data: { tenantId: TENANT_A, name: "Hair" } });
    const staff = async (name: string) =>
      prisma.user.create({
        data: {
          tenantId: TENANT_A,
          email: `${name}@resources.test`,
          name,
          passwordHash: "not-a-real-hash",
        },
      });
    const mira = await staff("mira");
    const nia = await staff("nia");
    await prisma.staffDepartment.createMany({
      data: [
        { tenantId: TENANT_A, userId: mira.id, departmentId: branch.id },
        { tenantId: TENANT_A, userId: nia.id, departmentId: branch.id },
      ],
    });

    const service = async (name: string, durationMinutes: number) =>
      prisma.service.create({
        data: {
          tenantId: TENANT_A,
          departmentId: branch.id,
          name,
          memberPrice: "35.00",
          nonmemberPrice: "40.00",
          durationMinutes,
        },
      });
    const colour = await service("Colour", 60);
    const cut = await service("Cut", 30);
    const consult = await service("Consultation", 30);
    const steam = await service("Steam treatment", 30);

    const resource = async (name: string, kind: "ROOM" | "EQUIPMENT") =>
      prisma.resource.create({ data: { tenantId: TENANT_A, name, kind } });
    const room1 = await resource("Room 1", "ROOM");
    const room2 = await resource("Room 2", "ROOM");
    const steamer = await resource("Steamer", "EQUIPMENT");

    // Colour happens in one room only: two overlapping colours cannot both book,
    // whoever performs them. Cut may use either room, so it fails over. Steam is
    // equipment, which is why a refusal there can say "equipment".
    await prisma.serviceResource.createMany({
      data: [
        { tenantId: TENANT_A, serviceId: colour.id, resourceId: room1.id },
        { tenantId: TENANT_A, serviceId: cut.id, resourceId: room1.id },
        { tenantId: TENANT_A, serviceId: cut.id, resourceId: room2.id },
        { tenantId: TENANT_A, serviceId: steam.id, resourceId: steamer.id },
      ],
    });

    const customer = await prisma.customer.create({
      data: { tenantId: TENANT_A, name: "Casey Client" },
    });

    seeded = {
      colourServiceId: colour.id,
      cutServiceId: cut.id,
      consultServiceId: consult.id,
      steamServiceId: steam.id,
      customerId: customer.id,
      miraId: mira.id,
      niaId: nia.id,
      room1Id: room1.id,
      room2Id: room2.id,
      steamerId: steamer.id,
    };
  });
}

describe(
  "rooms and equipment, against the database",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    before(seed);
    after(async () => {
      await purge();
      await prisma.$disconnect();
    });

    function asTenantA<T>(fn: () => Promise<T>): Promise<T> {
      return runAsTenant(TENANT_A, fn);
    }

    /** A distinct day per case, so one test's bookings cannot colour another's. */
    const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;

    function isResourceRefusal(error: unknown): boolean {
      assert.ok(error instanceof HttpError, "expected an HttpError");
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "RESOURCE_UNAVAILABLE");
      return true;
    }

    it("gives a line the room its service is tied to", async () => {
      const s = requireSeeded();

      const created = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.colourServiceId,
          startsAt: at(day(2), 10),
        }),
      );

      assert.equal(created.appointment.services[0]?.resourceId, s.room1Id);
      assert.equal(created.appointment.services[0]?.resourceName, "Room 1");
    });

    it("refuses a second booking in one room even when the performer is free", async () => {
      const s = requireSeeded();

      await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.colourServiceId,
          startsAt: at(day(3), 10),
        }),
      );

      // Nia is free at 10:30 — it is the room, not the person, that is taken.
      await assert.rejects(
        () =>
          asTenantA(() =>
            createAppointment({
              customerId: s.customerId,
              staffId: s.niaId,
              serviceId: s.colourServiceId,
              startsAt: at(day(3), 10, 30),
            }),
          ),
        isResourceRefusal,
      );
    });

    it("moves a two-room service to the room that is still free", async () => {
      const s = requireSeeded();

      const first = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.cutServiceId,
          startsAt: at(day(4), 10),
        }),
      );
      const second = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.niaId,
          serviceId: s.cutServiceId,
          startsAt: at(day(4), 10),
        }),
      );

      assert.equal(first.appointment.services[0]?.resourceName, "Room 1");
      assert.equal(second.appointment.services[0]?.resourceName, "Room 2");
    });

    it("treats back-to-back bookings as neighbours, not as a clash", async () => {
      const s = requireSeeded();

      const first = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.colourServiceId,
          startsAt: at(day(5), 10),
        }),
      );
      const second = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.niaId,
          serviceId: s.colourServiceId,
          // 11:00 is exactly when the first colour ends.
          startsAt: at(day(5), 11),
        }),
      );

      assert.equal(first.appointment.services[0]?.resourceName, "Room 1");
      assert.equal(second.appointment.services[0]?.resourceName, "Room 1");
    });

    it("frees the room when a booking is cancelled", async () => {
      const s = requireSeeded();

      const first = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.colourServiceId,
          startsAt: at(day(6), 10),
        }),
      );
      await asTenantA(() => updateAppointment(first.appointment.id, { status: "CANCELLED" }));

      const second = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.niaId,
          serviceId: s.colourServiceId,
          startsAt: at(day(6), 10),
        }),
      );
      assert.equal(second.appointment.services[0]?.resourceName, "Room 1");
    });

    it("leaves a service with no linked resources completely alone", async () => {
      const s = requireSeeded();

      await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.colourServiceId,
          startsAt: at(day(7), 10),
        }),
      );
      const consult = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.niaId,
          serviceId: s.consultServiceId,
          startsAt: at(day(7), 10),
        }),
      );

      assert.equal(consult.appointment.services[0]?.resourceId, null);
      assert.equal(consult.appointment.services[0]?.resourceName, null);
    });

    it("refuses a service whose only resource has been archived", async () => {
      const s = requireSeeded();

      await asTenantA(() => updateResource(s.room1Id, { status: "INACTIVE" }));
      try {
        await assert.rejects(
          () =>
            asTenantA(() =>
              createAppointment({
                customerId: s.customerId,
                staffId: s.miraId,
                serviceId: s.colourServiceId,
                startsAt: at(day(8), 10),
              }),
            ),
          isResourceRefusal,
        );
      } finally {
        // The room is the suite's fixture: put it back for the cases that follow.
        await asTenantA(() => updateResource(s.room1Id, { status: "ACTIVE" }));
      }
    });

    it("does not report a rescheduled booking as clashing with itself", async () => {
      const s = requireSeeded();

      const created = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.colourServiceId,
          startsAt: at(day(9), 10),
        }),
      );

      const moved = await asTenantA(() =>
        updateAppointment(created.appointment.id, { startsAt: at(day(9), 10, 15) }),
      );

      assert.equal(moved.services[0]?.resourceName, "Room 1");
      assert.equal(moved.startsAt, at(day(9), 10, 15));
    });

    it("skips the series occurrence whose room is taken and keeps the rest", async () => {
      const s = requireSeeded();

      // Nia already holds Room 1 a week after the anchor. Mira is free then, so the
      // only reason the second weekly booking cannot happen is the room — which is
      // exactly the case the series has to survive rather than fail on.
      await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.niaId,
          serviceId: s.colourServiceId,
          startsAt: at(day(17), 10),
        }),
      );

      const created = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.miraId,
          serviceId: s.colourServiceId,
          startsAt: at(day(10), 10),
          repeat: { intervalWeeks: 1, occurrences: 2 },
        }),
      );

      assert.equal(created.series?.created, 1);
      assert.deepEqual(
        created.series?.skipped.map((skipped) => skipped.startsAt),
        [at(day(17), 10)],
      );
      assert.match(created.series?.skipped[0]?.reason ?? "", /busy/);
    });

    it("keeps another salon's rooms out of the list", async () => {
      const foreign = await runAsTenant(TENANT_B, () => listResources());
      assert.deepEqual(foreign, []);

      const ours = await asTenantA(() => listResources());
      assert.deepEqual(
        ours.map((resource) => resource.name),
        ["Room 1", "Room 2", "Steamer"],
      );
      assert.equal(ours[2]?.kind, "EQUIPMENT");
    });

    it("assigns equipment and refuses overlapping use by another performer", async () => {
      const s = requireSeeded();
      const created = await asTenantA(() =>
        createAppointment({
          serviceId: s.steamServiceId,
          staffId: s.miraId,
          startsAt: at(day(18), 10),
        }),
      );
      assert.equal(created.appointment.services[0]?.resourceId, s.steamerId);
      await assert.rejects(
        () =>
          asTenantA(() =>
            createAppointment({
              serviceId: s.steamServiceId,
              staffId: s.niaId,
              startsAt: at(day(18), 10),
            }),
          ),
        isResourceRefusal,
      );
    });

    it("assigns each line and checks a clash on the later line's own window", async () => {
      const s = requireSeeded();
      const services = [
        { serviceId: s.colourServiceId, staffId: s.miraId },
        { serviceId: s.steamServiceId, staffId: s.miraId },
      ];
      const created = await asTenantA(() =>
        createAppointment({ services, startsAt: at(day(19), 10) }),
      );
      assert.deepEqual(
        created.appointment.services.map((line) => line.resourceId),
        [s.room1Id, s.steamerId],
      );
      assert.equal(created.appointment.services[1]?.startsAt, at(day(19), 11));

      await asTenantA(() =>
        createAppointment({
          serviceId: s.steamServiceId,
          staffId: s.niaId,
          startsAt: at(day(20), 11),
        }),
      );
      await assert.rejects(
        () =>
          asTenantA(() =>
            createAppointment({
              services,
              startsAt: at(day(20), 10),
            }),
          ),
        isResourceRefusal,
      );
    });

    it("retains archived resource history on notes-only and cancellation updates", async () => {
      const s = requireSeeded();
      const created = await asTenantA(() =>
        createAppointment({
          serviceId: s.colourServiceId,
          staffId: s.miraId,
          startsAt: at(day(21), 10),
        }),
      );
      await asTenantA(() => updateResource(s.room1Id, { status: "INACTIVE" }));
      try {
        const edited = await asTenantA(() =>
          updateAppointment(created.appointment.id, { comment: "Keep the original room" }),
        );
        assert.equal(edited.services[0]?.resourceId, s.room1Id);
        assert.equal(edited.services[0]?.resourceName, "Room 1");
        const cancelled = await asTenantA(() =>
          updateAppointment(created.appointment.id, { status: "CANCELLED" }),
        );
        assert.equal(cancelled.services[0]?.resourceId, s.room1Id);
        await assert.rejects(
          () => asTenantA(() => updateAppointment(created.appointment.id, { status: "SCHEDULED" })),
          isResourceRefusal,
        );
      } finally {
        await asTenantA(() => updateResource(s.room1Id, { status: "ACTIVE" }));
      }
    });

    it("reassigns a reschedule and rechecks occupancy on reactivation", async () => {
      const s = requireSeeded();
      const created = await asTenantA(() =>
        createAppointment({
          serviceId: s.cutServiceId,
          staffId: s.miraId,
          startsAt: at(day(22), 9),
        }),
      );
      await asTenantA(() =>
        createAppointment({
          serviceId: s.colourServiceId,
          staffId: s.niaId,
          startsAt: at(day(22), 10),
        }),
      );
      const moved = await asTenantA(() =>
        updateAppointment(created.appointment.id, { startsAt: at(day(22), 10) }),
      );
      assert.equal(moved.services[0]?.resourceId, s.room2Id);
      await asTenantA(() => updateAppointment(created.appointment.id, { status: "CANCELLED" }));
      const replacement = await asTenantA(() =>
        createAppointment({
          serviceId: s.cutServiceId,
          startsAt: at(day(22), 10),
        }),
      );
      assert.equal(replacement.appointment.services[0]?.resourceId, s.room2Id);
      await assert.rejects(
        () => asTenantA(() => updateAppointment(created.appointment.id, { status: "SCHEDULED" })),
        isResourceRefusal,
      );
      const unchanged = await asTenantA(() =>
        updateAppointment(created.appointment.id, { comment: "Still cancelled" }),
      );
      assert.equal(unchanged.status, "CANCELLED");
      assert.equal(unchanged.services[0]?.resourceId, s.room2Id);
    });
  },
);
