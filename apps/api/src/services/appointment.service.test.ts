/**
 * The appointment service's clash rule, against the real database (ADR 0014).
 *
 * The rule is "one person cannot be in two places at once", and the interesting
 * part of it is not the obvious overlap — it is the edges around it: two windows
 * that merely touch, a cancelled booking that freed its slot, a no-show that did
 * not, an unassigned booking with nobody to clash with, a patch that changes
 * nothing, and another tenant's stylist whose identical time must not block this
 * one. Each is a case where a naive
 * `where: { staffId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }`
 * either over- or under-refuses, so each is asserted against the real store.
 *
 * Skipped with a clear message when `DATABASE_URL` is absent, so `npm run verify`
 * still passes on a machine with no database running — the same rule every other
 * service suite here follows.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createAppointment, getAppointment, updateAppointment } from "./appointment.service.js";

const databaseUrl = process.env["DATABASE_URL"];

const TENANT_A = "appointment-clash-a";
const TENANT_B = "appointment-clash-b";

/** A fixed Wednesday, so no assertion depends on which day the suite runs. */
const DAY = new Date("2026-10-14T00:00:00.000Z");

/** An instant on that day at `hour`:`minute`, which every block below starts on. */
function at(hour: number, minute = 0): Date {
  return new Date(DAY.getTime() + (hour * 60 + minute) * 60_000);
}

interface Seeded {
  serviceId: string;
  customerId: string;
  /** `Kana` — the stylist the suite books, in the branch, so ADR 0013 never refuses her. */
  kanaId: string;
  /** `Ryo` — holds the 14:00 slot the "moved onto another performer" case takes. */
  ryoId: string;
  /** The id of Ryo's seeded booking, so the "within its own window" case can target it. */
  ryoSlotId: string;
  /** `Fenn` — tenant B's stylist, whose 08:00 must not block Kana's 08:00. */
  foreignStaffId: string;
  /** Tenant B's own service, so a foreign booking has a service to hang on. */
  foreignServiceId: string;
  /** A 90-minute service, so a resize can reach into the next block. */
  longServiceId: string;
  /** `Ola` — a tenant-A user in no branch, so the eligibility rule must refuse her. */
  outsiderId: string;
  /** `Dee` — a tenant-A user the salon has disabled. */
  disabledStaffId: string;
  /** `Mia` — a nails stylist, so a second line can have a different performer. */
  miaId: string;
  /** A 30-minute service in the nails branch, so a chain has two lengths. */
  manicureId: string;
}

let seeded: Seeded | undefined;

/** A tenant-A stylist's id, read unscoped. */
function staffIdOf(email: string): Promise<string> {
  return runAsPlatform(() =>
    prisma.user
      .findFirstOrThrow({ where: { email }, select: { id: true } })
      .then((user) => user.id),
  );
}

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    const ids = [TENANT_A, TENANT_B];
    await prisma.appointment.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.staffDepartment.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.department.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@appointment-clash.test" } } });
  });
}

/** A branch per tenant, and a 45-minute service hanging off A's branch. */
async function seed(): Promise<void> {
  await purge();

  await runAsPlatform(async () => {
    await prisma.tenant.create({
      data: {
        id: TENANT_A,
        name: `Salon ${TENANT_A}`,
        slug: TENANT_A,
        // Deliberately not the host's zone: a message formatted in the server's
        // clock cannot satisfy an assertion written against this one.
        timeZone: "America/Los_Angeles",
      },
    });
    await prisma.tenant.create({
      data: { id: TENANT_B, name: `Salon ${TENANT_B}`, slug: TENANT_B },
    });

    for (const id of [TENANT_A, TENANT_B]) {
      const owner = await prisma.user.create({
        data: {
          tenantId: id,
          email: `owner-${id}@appointment-clash.test`,
          name: `Owner ${id}`,
          passwordHash: "not-a-real-hash",
        },
      });
      await prisma.tenant.update({ where: { id }, data: { ownerUserId: owner.id } });
    }

    const branch = await prisma.department.create({ data: { tenantId: TENANT_A, name: "Hair" } });

    for (const [name, email] of [
      ["Kana Kelsey", "kana@appointment-clash.test"],
      ["Ryo Rivas", "ryo@appointment-clash.test"],
    ] as const) {
      const staff = await prisma.user.create({
        data: { tenantId: TENANT_A, email, name, passwordHash: "not-a-real-hash" },
      });
      await prisma.staffDepartment.create({
        data: { tenantId: TENANT_A, userId: staff.id, departmentId: branch.id },
      });
    }

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

    // A second, longer service in the same branch: moving a booking onto it is
    // the "resize" half of the clash rule, and the first block below must reach
    // into the second when it grows.
    const longService = await prisma.service.create({
      data: {
        tenantId: TENANT_A,
        departmentId: branch.id,
        name: "Colour and gloss",
        memberPrice: "60.00",
        nonmemberPrice: "70.00",
        durationMinutes: 90,
      },
    });

    // A second branch with its own stylist and its own length: a multi-service
    // booking exists so line 1 can be somebody else's job, and that needs two
    // departments to be a real case.
    const nails = await prisma.department.create({ data: { tenantId: TENANT_A, name: "Nails" } });
    const mia = await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: "mia@appointment-clash.test",
        name: "Mia Moss",
        passwordHash: "not-a-real-hash",
      },
    });
    await prisma.staffDepartment.create({
      data: { tenantId: TENANT_A, userId: mia.id, departmentId: nails.id },
    });
    const manicure = await prisma.service.create({
      data: {
        tenantId: TENANT_A,
        departmentId: nails.id,
        name: "Manicure",
        memberPrice: "25.00",
        nonmemberPrice: "28.00",
        durationMinutes: 30,
      },
    });

    const outsider = await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: "outsider@appointment-clash.test",
        name: "Ola Outsider",
        passwordHash: "not-a-real-hash",
      },
    });
    const disabledStaff = await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: "disabled@appointment-clash.test",
        name: "Dee Disabled",
        passwordHash: "not-a-real-hash",
        disabled: true,
      },
    });

    const customer = await prisma.customer.create({
      data: { tenantId: TENANT_A, name: "Casey Client" },
    });

    // Ryo holds the afternoon slot the "moved onto another performer" case
    // tries to take, so the merge is what is being judged rather than the read.
    const ryoId = await staffIdOf("ryo@appointment-clash.test");
    const kanaId = await staffIdOf("kana@appointment-clash.test");
    const ryoSlot = await prisma.appointment.create({
      data: {
        tenantId: TENANT_A,
        staffId: ryoId,
        serviceId: service.id,
        startsAt: at(14),
        endsAt: at(14, 45),
        durationMinutes: 45,
      },
      select: { id: true },
    });

    // The other salon's stylist, booked at the very instant Kana takes — the
    // identical time that must not block her.
    const foreignBranch = await prisma.department.create({
      data: { tenantId: TENANT_B, name: "Hair" },
    });
    const foreignService = await prisma.service.create({
      data: {
        tenantId: TENANT_B,
        departmentId: foreignBranch.id,
        name: "Cut and finish",
        memberPrice: "35.00",
        nonmemberPrice: "40.00",
        durationMinutes: 45,
      },
    });
    const foreignStaff = await prisma.user.create({
      data: {
        tenantId: TENANT_B,
        email: "foreign@appointment-clash.test",
        name: "Fenn Foreign",
        passwordHash: "not-a-real-hash",
      },
    });
    await prisma.staffDepartment.create({
      data: { tenantId: TENANT_B, userId: foreignStaff.id, departmentId: foreignBranch.id },
    });
    await prisma.appointment.create({
      data: {
        tenantId: TENANT_B,
        staffId: foreignStaff.id,
        serviceId: foreignService.id,
        startsAt: at(9),
        endsAt: at(9, 45),
        durationMinutes: 45,
      },
    });

    seeded = {
      serviceId: service.id,
      customerId: customer.id,
      kanaId,
      ryoId,
      ryoSlotId: ryoSlot.id,
      foreignStaffId: foreignStaff.id,
      foreignServiceId: foreignService.id,
      longServiceId: longService.id,
      outsiderId: outsider.id,
      disabledStaffId: disabledStaff.id,
      miaId: mia.id,
      manicureId: manicure.id,
    };
  });
}

/** The suite's shared seed, or a loud failure rather than a silent `undefined`. */
function requireSeeded(): Seeded {
  if (!seeded) throw new Error("the suite's `before(seed)` did not run");
  return seeded;
}

describe(
  "appointment.service's clash rule, against the database",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    before(seed);
    after(purge);

    /** Every write below runs inside tenant A's scope, as a real handler would. */
    function asTenantA<T>(fn: () => Promise<T>): Promise<T> {
      return runAsTenant(TENANT_A, fn);
    }

    /** Reads a row unscoped, so a refused write can be proved to have written nothing. */
    function readUnscoped(id: string) {
      return runAsPlatform(() =>
        prisma.appointment.findUniqueOrThrow({
          where: { id },
          select: { id: true, staffId: true, startsAt: true, endsAt: true, status: true },
        }),
      );
    }

    it("refuses a booking that overlaps the same stylist, naming the clash", async () => {
      const s = requireSeeded();

      // Kana's 09:00 is free in tenant A — Fenn's identical window belongs to
      // tenant B — so the blocker this case judges is booked right here.
      await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(9).toISOString(),
        }),
      );

      await assert.rejects(
        asTenantA(() =>
          createAppointment({
            customerId: s.customerId,
            staffId: s.kanaId,
            serviceId: s.serviceId,
            // 09:30 is inside the block just made, not merely touching it.
            startsAt: at(9, 30).toISOString(),
          }),
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError, "expected an HttpError");
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "APPOINTMENT_CLASH");
          assert.match(error.message, /already taken/i);
          return true;
        },
      );
    });

    it("allows back-to-back edges, because a 45-minute day is contiguous", async () => {
      const s = requireSeeded();

      // 09:45 is the instant Kana's first block ends, not an overlap of it.
      const created = await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(9, 45).toISOString(),
        }),
      );

      assert.equal(created.startsAt, at(9, 45).toISOString());
      assert.equal(created.endsAt, at(10, 30).toISOString());
    });

    it("refuses moving a booking onto another stylist who is already taken", async () => {
      const s = requireSeeded();

      // Drag Ryo's 14:00 block onto Kana's busy morning: the performer changed
      // as well as the time, and the merge is what the rule has to judge.
      await assert.rejects(
        asTenantA(() =>
          updateAppointment(s.ryoSlotId, { staffId: s.kanaId, startsAt: at(9).toISOString() }),
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "APPOINTMENT_CLASH");
          return true;
        },
      );

      const untouched = await readUnscoped(s.ryoSlotId);
      assert.equal(untouched.staffId, s.ryoId, "the refused move wrote nothing");
      assert.equal(untouched.startsAt.toISOString(), at(14).toISOString());
    });

    it("refuses moving a booking onto a slot its own stylist already holds", async () => {
      const s = requireSeeded();

      // Ryo's own late slot. The performer does not change in this move — only
      // the time does — so what is judged is Ryo clashing with Ryo, and the
      // self-exclusion in `assertNoClash` must not be loose enough to hide it.
      await asTenantA(() =>
        createAppointment({
          staffId: s.ryoId,
          serviceId: s.serviceId,
          startsAt: at(16).toISOString(),
        }),
      );

      await assert.rejects(
        asTenantA(() => updateAppointment(s.ryoSlotId, { startsAt: at(16).toISOString() })),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "APPOINTMENT_CLASH");
          return true;
        },
      );

      const untouched = await readUnscoped(s.ryoSlotId);
      assert.equal(untouched.startsAt.toISOString(), at(14).toISOString());
    });

    it("lets a cancelled blocker free its slot", async () => {
      const s = requireSeeded();

      const blocker = await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(11).toISOString(),
        }),
      );
      await asTenantA(() => updateAppointment(blocker.id, { status: "CANCELLED" }));

      const created = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(11).toISOString(),
        }),
      );

      assert.equal(created.startsAt, at(11).toISOString());
    });

    it("keeps a no-show occupying its slot, because the time was still held", async () => {
      const s = requireSeeded();

      const blocker = await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(13).toISOString(),
        }),
      );
      await asTenantA(() => updateAppointment(blocker.id, { status: "NO_SHOW" }));

      await assert.rejects(
        asTenantA(() =>
          createAppointment({
            staffId: s.kanaId,
            serviceId: s.serviceId,
            startsAt: at(13).toISOString(),
          }),
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.code, "APPOINTMENT_CLASH");
          return true;
        },
      );
    });

    it("never checks an unassigned booking, because nobody named is nobody double-booked", async () => {
      const s = requireSeeded();

      const walkIn = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          serviceId: s.serviceId,
          startsAt: at(16).toISOString(),
        }),
      );
      assert.equal(walkIn.staffId, null);

      // A second booking at the very same instant, still unassigned, is fine.
      const second = await asTenantA(() =>
        createAppointment({
          serviceId: s.serviceId,
          startsAt: at(16).toISOString(),
        }),
      );
      assert.equal(second.startsAt, walkIn.startsAt);
    });

    it("treats a reschedule within the booking's own window as a no-op", async () => {
      const s = requireSeeded();

      const moved = await asTenantA(() =>
        updateAppointment(s.ryoSlotId, { startsAt: at(14).toISOString() }),
      );

      assert.equal(moved.startsAt, at(14).toISOString());
      assert.equal(moved.endsAt, at(14, 45).toISOString());
    });

    it("does not let another tenant's stylist block this one", async () => {
      const s = requireSeeded();

      // Fenn holds 09:00–09:45 in tenant B. Tenant A's Kana takes the identical
      // window, and the assertion is that the other salon's booking is invisible
      // to her — the scope, not the clock, is what decides.
      const created = await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(20).toISOString(),
        }),
      );

      assert.equal(created.staffId, s.kanaId);
      assert.equal(created.startsAt, at(20).toISOString());
    });

    it("moves a booking freely when nothing occupies the target", async () => {
      const s = requireSeeded();

      const moved = await asTenantA(() =>
        updateAppointment(s.ryoSlotId, { staffId: s.kanaId, startsAt: at(21).toISOString() }),
      );

      assert.equal(moved.staffId, s.kanaId);
      assert.equal(moved.startsAt, at(21).toISOString());
      assert.equal(moved.endsAt, at(21, 45).toISOString(), "the slot resizes from the service");
    });

    it("refuses booking an inactive service but keeps its existing bookings editable", async () => {
      const s = requireSeeded();

      // A booking on the long service, made while both services are live, is the
      // row whose service is about to be retired underneath it.
      const booking = await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.longServiceId,
          startsAt: at(6).toISOString(),
        }),
      );

      await runAsPlatform(() =>
        prisma.service.update({ where: { id: s.serviceId }, data: { status: "INACTIVE" } }),
      );
      try {
        // Choosing it for a new booking is refused, and the refusal names the
        // control the drawer has to mark.
        await assert.rejects(
          asTenantA(() =>
            createAppointment({
              staffId: s.kanaId,
              serviceId: s.serviceId,
              startsAt: at(7).toISOString(),
            }),
          ),
          (error: unknown) => {
            assert.ok(error instanceof HttpError, "expected an HttpError");
            assert.equal(error.statusCode, 400);
            assert.equal(error.code, "SERVICE_INACTIVE");
            assert.deepEqual(error.details, [
              { path: "serviceId", message: "That service is not active." },
            ]);
            return true;
          },
        );

        // Editing the booking already on the retired service is still allowed:
        // the service is not re-chosen, so retirement cannot freeze it.
        const edited = await asTenantA(() =>
          updateAppointment(booking.id, { comment: "Kept after retirement." }),
        );
        assert.equal(edited.comment, "Kept after retirement.");

        // Moving a booking *onto* the inactive service is a new choice, refused.
        await assert.rejects(
          asTenantA(() => updateAppointment(booking.id, { serviceId: s.serviceId })),
          (error: unknown) => {
            assert.ok(error instanceof HttpError);
            assert.equal(error.code, "SERVICE_INACTIVE");
            return true;
          },
        );

        const untouched = await readUnscoped(booking.id);
        assert.equal(untouched.endsAt.toISOString(), at(7, 30).toISOString());
      } finally {
        await runAsPlatform(() =>
          prisma.service.update({ where: { id: s.serviceId }, data: { status: "ACTIVE" } }),
        );
      }
    });

    it("accepts a booking created cancelled even where a live one already sits", async () => {
      const s = requireSeeded();

      const occupant = await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(17).toISOString(),
        }),
      );

      // A row created already cancelled holds no slot (ADR 0014 §3), so it may
      // be recorded in a window somebody else occupies — the same rule PATCH
      // applies when a booking is cancelled after the fact.
      const cancelled = await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(17).toISOString(),
          status: "CANCELLED",
        }),
      );

      assert.equal(cancelled.status, "CANCELLED");
      assert.equal(cancelled.startsAt, occupant.startsAt);
      assert.equal(cancelled.endsAt, occupant.endsAt);
    });

    it("judges a reactivated booking against the slot it is asking for back", async () => {
      const s = requireSeeded();

      const cancelled = await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(18).toISOString(),
          status: "CANCELLED",
        }),
      );
      // The freed slot is given away while the cancelled row still remembers it.
      await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(18).toISOString(),
        }),
      );

      await assert.rejects(
        asTenantA(() => updateAppointment(cancelled.id, { status: "SCHEDULED" })),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "APPOINTMENT_CLASH");
          return true;
        },
      );

      const untouched = await readUnscoped(cancelled.id);
      assert.equal(untouched.status, "CANCELLED", "the refused reactivation wrote nothing");

      // The same move onto a free window still works, so the rule refuses the
      // occupancy and not reactivation itself.
      const free = await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(22).toISOString(),
          status: "CANCELLED",
        }),
      );
      const revived = await asTenantA(() => updateAppointment(free.id, { status: "SCHEDULED" }));
      assert.equal(revived.status, "SCHEDULED");
    });

    it("refuses a service change that would grow the block into the next booking", async () => {
      const s = requireSeeded();

      const first = await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(15).toISOString(),
        }),
      );
      await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(15, 45).toISOString(),
        }),
      );

      // The start does not move; the 90-minute service would end at 16:30 and
      // run through the block at 15:45, so the resize is what clashes.
      await assert.rejects(
        asTenantA(() => updateAppointment(first.id, { serviceId: s.longServiceId })),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "APPOINTMENT_CLASH");
          return true;
        },
      );

      const untouched = await readUnscoped(first.id);
      assert.equal(untouched.endsAt.toISOString(), at(15, 45).toISOString());
    });

    it("quotes the clashing window in the salon's zone, not the server's", async () => {
      const s = requireSeeded();

      await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(12).toISOString(),
        }),
      );

      await assert.rejects(
        asTenantA(() =>
          createAppointment({
            staffId: s.kanaId,
            serviceId: s.serviceId,
            startsAt: at(12, 15).toISOString(),
          }),
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          // 2026-10-14 is PDT (UTC−7): 12:00Z–12:45Z is 05:00–05:45 in the salon.
          assert.match(error.message, /05:00–05:45/);
          return true;
        },
      );
    });

    it("names the performer field when the chosen staff is disabled or out of the branch", async () => {
      const s = requireSeeded();

      await assert.rejects(
        asTenantA(() =>
          createAppointment({
            staffId: s.disabledStaffId,
            serviceId: s.serviceId,
            startsAt: at(19).toISOString(),
          }),
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 400);
          assert.equal(error.code, "STAFF_DISABLED");
          assert.deepEqual(error.details, [
            { path: "staffId", message: "That staff member is disabled." },
          ]);
          return true;
        },
      );

      await assert.rejects(
        asTenantA(() =>
          createAppointment({
            staffId: s.outsiderId,
            serviceId: s.serviceId,
            startsAt: at(19, 30).toISOString(),
          }),
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 400);
          assert.equal(error.code, "STAFF_NOT_IN_DEPARTMENT");
          assert.deepEqual(error.details, [
            {
              path: "staffId",
              message: "That staff member is not in the service's department.",
            },
          ]);
          return true;
        },
      );
    });

    it("chains several services end to end, each with its own performer", async () => {
      const s = requireSeeded();

      const created = await asTenantA(() =>
        createAppointment({
          customerId: s.customerId,
          startsAt: at(13, 45).toISOString(),
          services: [
            { serviceId: s.manicureId, staffId: s.miaId },
            { serviceId: s.serviceId, staffId: s.kanaId },
          ],
        }),
      );

      assert.equal(created.startsAt, at(13, 45).toISOString());
      assert.equal(created.endsAt, at(15).toISOString(), "30 + 45 minutes, chained");
      assert.equal(created.durationMinutes, 75);
      assert.deepEqual(
        created.services.map((line) => [
          line.serviceName,
          line.staffName,
          line.startsAt,
          line.endsAt,
          line.durationMinutes,
        ]),
        [
          ["Manicure", "Mia Moss", at(13, 45).toISOString(), at(14, 15).toISOString(), 30],
          ["Cut and finish", "Kana Kelsey", at(14, 15).toISOString(), at(15).toISOString(), 45],
        ],
      );

      // The flat columns mirror line 0, so a reader written before lines existed
      // (the day list, the receipt, the message payload) is still correct.
      assert.equal(created.serviceName, "Manicure");
      assert.equal(created.staffName, "Mia Moss");
      assert.equal(created.serviceDepartmentId, created.services[0]!.serviceDepartmentId);
    });

    it("judges a clash per line, not across the whole booking", async () => {
      const s = requireSeeded();

      // Kana holds 19:00–19:45 (made here). The chain starts at 18:45 and puts
      // her on the *second* line, so the clash is line 1's window and nothing
      // else — the manicure before it is Mia's and is free.
      await asTenantA(() =>
        createAppointment({
          staffId: s.kanaId,
          serviceId: s.serviceId,
          startsAt: at(19).toISOString(),
        }),
      );

      await assert.rejects(
        asTenantA(() =>
          createAppointment({
            startsAt: at(18, 45).toISOString(),
            services: [
              { serviceId: s.manicureId, staffId: s.miaId },
              { serviceId: s.serviceId, staffId: s.kanaId },
            ],
          }),
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 409);
          assert.equal(error.code, "APPOINTMENT_CLASH");
          return true;
        },
      );
    });

    it("checks each line's performer against that line's service", async () => {
      const s = requireSeeded();

      // Kana is a hair stylist: fine on line 0, refused on the manicure line.
      await assert.rejects(
        asTenantA(() =>
          createAppointment({
            startsAt: at(23).toISOString(),
            services: [
              { serviceId: s.serviceId, staffId: s.kanaId },
              { serviceId: s.manicureId, staffId: s.kanaId },
            ],
          }),
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 400);
          assert.equal(error.code, "STAFF_NOT_IN_DEPARTMENT");
          assert.deepEqual(error.details, [
            {
              path: "staffId",
              message: "That staff member is not in the service's department.",
            },
          ]);
          return true;
        },
      );
    });
    it("replaces the whole chain on a patch and re-chains the slot", async () => {
      const s = requireSeeded();

      const booking = await asTenantA(() =>
        createAppointment({
          staffId: s.miaId,
          serviceId: s.manicureId,
          startsAt: at(23).toISOString(),
        }),
      );
      assert.equal(booking.endsAt, at(23, 30).toISOString());

      const patched = await asTenantA(() =>
        updateAppointment(booking.id, {
          services: [
            { serviceId: s.manicureId, staffId: s.miaId },
            { serviceId: s.serviceId, staffId: s.kanaId },
          ],
        }),
      );

      assert.equal(patched.endsAt, at(24, 15).toISOString());
      assert.equal(patched.durationMinutes, 75);
      assert.deepEqual(
        patched.services.map((line) => [line.serviceName, line.staffName]),
        [
          ["Manicure", "Mia Moss"],
          ["Cut and finish", "Kana Kelsey"],
        ],
      );

      // A patch that touches nothing in the chain must not append a second copy
      // of it — the rewrite is a replace, not an insert.
      await asTenantA(() => updateAppointment(booking.id, { comment: "Noted." }));
      const rows = await runAsPlatform(() =>
        prisma.appointmentLine.findMany({
          where: { appointmentId: booking.id },
          select: { position: true },
          orderBy: { position: "asc" },
        }),
      );
      assert.deepEqual(
        rows.map((row) => row.position),
        [0, 1],
        "the chain is rewritten, never appended to",
      );
    });

    it("moves only the first line when the patch changes the booking's performer", async () => {
      const s = requireSeeded();

      const booking = await asTenantA(() =>
        createAppointment({
          startsAt: at(16, 45).toISOString(),
          services: [
            { serviceId: s.serviceId, staffId: s.ryoId },
            { serviceId: s.manicureId, staffId: s.miaId },
          ],
        }),
      );

      const moved = await asTenantA(() => updateAppointment(booking.id, { staffId: null }));

      assert.equal(moved.staffId, null, "the booking-level performer is line 0's");
      assert.deepEqual(
        moved.services.map((line) => line.staffId),
        [null, s.miaId],
        "line 1 keeps the person it was booked with",
      );
      assert.equal(moved.endsAt, booking.endsAt);
    });

    it("reads a booking written before service lines existed, and gives it one on the next patch", async () => {
      const s = requireSeeded();

      // A row from the pre-phase-B shape: a service and a window, no lines.
      const legacy = await runAsPlatform(() =>
        prisma.appointment.create({
          data: {
            tenantId: TENANT_A,
            staffId: s.ryoId,
            serviceId: s.serviceId,
            startsAt: at(6),
            endsAt: at(6, 45),
          },
          select: { id: true },
        }),
      );

      const read = await asTenantA(() => getAppointment(legacy.id));
      assert.deepEqual(read.services, [], "no lines yet");
      assert.equal(read.serviceName, "Cut and finish");
      assert.equal(read.staffName, "Ryo Rivas");

      const patched = await asTenantA(() =>
        updateAppointment(legacy.id, { comment: "Imported booking." }),
      );
      assert.equal(patched.services.length, 1);
      assert.deepEqual(
        [patched.services[0]!.startsAt, patched.services[0]!.endsAt],
        [at(6).toISOString(), at(6, 45).toISOString()],
        "the line takes the window the row already held",
      );
    });
  },
);
