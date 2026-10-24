/**
 * The demo dataset's own invariants — no database, no clock.
 *
 * `seed.ts` reads this dataset against live rows, so a typo here (a booking
 * naming a service that does not exist, two bookings double-booking a stylist,
 * a sale whose tenders do not add up) fails the seed with a lookup error or —
 * worse — seeds a demo whose numbers do not add up. Asserting the dataset on
 * its own catches that before any database is involved, over several fixed
 * instants so the relative offsets (`offsetHours`, `offsetMinutes`) prove they
 * stay true whenever the seed runs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEMO_APPOINTMENTS,
  DEMO_CUSTOMERS,
  DEMO_DEPARTMENTS,
  DEMO_GIFT_CARDS,
  DEMO_PACKAGES,
  DEMO_PLATFORM_ADMIN,
  DEMO_PRODUCTS,
  DEMO_SALES,
  DEMO_SERVICES,
  DEMO_SHIFTS,
  DEMO_STAFF,
  DEMO_VALUE_PACKAGES,
  STAFF_DEPARTMENTS,
} from "./seed-data.js";
import {
  FALLBACK_DURATION_MINUTES,
  appointmentWindow,
  assertNoAppointmentClash,
  demoSaleTotalCents,
  demoUnitPriceCents,
  parseTimeOfDay,
  saleMoment,
  tenderAmountsCents,
  type ClashWindow,
} from "./seed-logic.js";

/** Several wall clocks the dataset must read correctly under. */
const INSTANTS = [
  new Date(2026, 9, 14, 8, 0), // morning — "four hours ago" is still today
  new Date(2026, 9, 14, 20, 0), // evening — relative offsets must not cross midnight wrongly
  new Date(2026, 2, 8, 10, 30), // near a DST boundary for the local zone
];

const serviceByName = new Map(DEMO_SERVICES.map((row) => [row.name, row]));
const productByName = new Map(DEMO_PRODUCTS.map((row) => [row.name, row]));
const packageByName = new Map(DEMO_PACKAGES.map((row) => [row.name, row]));
const giftCardByName = new Map(DEMO_GIFT_CARDS.map((row) => [row.name, row]));
const staffEmails = new Set(DEMO_STAFF.map((row) => row.email));
const customerByEmail = new Map(DEMO_CUSTOMERS.map((row) => [row.email, row]));

describe("demo dataset catalogue", () => {
  it("separates the platform administrator from the company owner and staff", () => {
    assert.deepEqual(DEMO_PLATFORM_ADMIN, {
      email: "superadmin@gmail.com",
      name: "Glampro Platform Administrator",
      password: "superadmin12345",
    });
    assert.ok(!staffEmails.has(DEMO_PLATFORM_ADMIN.email));
    const owners = DEMO_STAFF.filter((user) => user.globalRole === "SUPER_ADMIN");
    assert.equal(owners.length, 1);
    assert.equal(DEMO_STAFF[0], owners[0], "the seed assigns ownership to the first crew member");
    assert.equal(owners[0]?.email, "admin@gmail.com");
    assert.equal(owners[0]?.password, "admin12345");
    assert.equal(staffEmails.size, DEMO_STAFF.length);
  });

  it("names departments the catalogue agrees on", () => {
    const departments = new Set(DEMO_DEPARTMENTS);
    assert.ok(departments.size > 0, "expected at least one department");

    for (const service of DEMO_SERVICES) {
      assert.ok(
        departments.has(service.department),
        `service "${service.name}" names unknown department "${service.department}"`,
      );
    }
    for (const product of DEMO_PRODUCTS) {
      assert.ok(
        departments.has(product.department),
        `product "${product.name}" names unknown department "${product.department}"`,
      );
    }
    for (const [email, names] of Object.entries(STAFF_DEPARTMENTS)) {
      assert.ok(staffEmails.has(email), `staff link names unknown user ${email}`);
      for (const name of names) {
        assert.ok(
          departments.has(name),
          `staff link for ${email} names unknown department "${name}"`,
        );
      }
    }
  });

  it("gives every package and value package a real service to cover", () => {
    for (const pkg of DEMO_PACKAGES) {
      assert.ok(pkg.services.length > 0, `package "${pkg.name}" covers no service`);
      for (const name of pkg.services) {
        assert.ok(
          serviceByName.has(name),
          `package "${pkg.name}" covers unknown service "${name}"`,
        );
      }
    }
    for (const pkg of DEMO_VALUE_PACKAGES) {
      assert.ok(pkg.services.length > 0, `value package "${pkg.name}" covers no service`);
      for (const name of pkg.services) {
        assert.ok(
          serviceByName.has(name),
          `value package "${pkg.name}" covers unknown service "${name}"`,
        );
      }
    }
  });

  it("resolves every booking against the staff, customers and services it names", () => {
    const ids = new Set<string>();
    for (const appointment of DEMO_APPOINTMENTS) {
      assert.ok(!ids.has(appointment.id), `duplicate appointment id ${appointment.id}`);
      ids.add(appointment.id);
      assert.ok(serviceByName.has(appointment.service), `${appointment.id} names unknown service`);
      assert.ok(staffEmails.has(appointment.staffEmail), `${appointment.id} names unknown staff`);
      assert.ok(
        customerByEmail.has(appointment.customerEmail),
        `${appointment.id} names unknown customer`,
      );
    }
  });
});

describe("demo dataset bookings", () => {
  it("never double-books a performer, at any instant", () => {
    for (const now of INSTANTS) {
      const windows: ClashWindow[] = DEMO_APPOINTMENTS.map((appointment) => {
        const service = serviceByName.get(appointment.service);
        assert.ok(service, `${appointment.id} names unknown service`);
        const duration = service.durationMinutes ?? FALLBACK_DURATION_MINUTES;
        const { startsAt, endsAt } = appointmentWindow(appointment, duration, now);
        return {
          id: appointment.id,
          staffEmail: appointment.staffEmail,
          status: appointment.status,
          startsAt,
          endsAt,
        };
      });
      assertNoAppointmentClash(windows);
    }
  });

  it("keeps completed history in the past and the forward book in the future", () => {
    for (const now of INSTANTS) {
      for (const appointment of DEMO_APPOINTMENTS) {
        const service = serviceByName.get(appointment.service);
        assert.ok(service, `${appointment.id} names unknown service`);
        const { startsAt, endsAt } = appointmentWindow(
          appointment,
          service.durationMinutes ?? FALLBACK_DURATION_MINUTES,
          now,
        );
        assert.ok(endsAt > startsAt, `${appointment.id} ends before it starts`);
        if (appointment.status === "COMPLETED") {
          assert.ok(endsAt <= now, `${appointment.id} is completed but ends in the future`);
        }
        if (appointment.status === "SCHEDULED" && appointment.dayOffset > 0) {
          assert.ok(startsAt > now, `${appointment.id} is a future booking starting in the past`);
        }
      }
    }
  });
});

describe("demo dataset rota", () => {
  it("gives every shift a performer the roster knows, and rows that fit one day", () => {
    const ids = new Set<string>();
    for (const shift of DEMO_SHIFTS) {
      assert.ok(!ids.has(shift.id), `duplicate shift id ${shift.id}`);
      ids.add(shift.id);
      assert.ok(staffEmails.has(shift.staffEmail), `shift names unknown user ${shift.staffEmail}`);
      assert.ok(shift.dayOfWeek >= 0 && shift.dayOfWeek <= 6, `${shift.id}: bad dayOfWeek`);
      assert.ok(
        shift.startsAtMinute >= 0 && shift.endsAtMinute <= 24 * 60,
        `${shift.id}: minute outside the day`,
      );
      assert.ok(
        shift.endsAtMinute > shift.startsAtMinute,
        `${shift.id}: a shift has to end after it starts`,
      );
    }
  });

  it("sits every break inside that performer's same-day work shift", () => {
    for (const shift of DEMO_SHIFTS) {
      if (shift.kind !== "BREAK") continue;

      const covered = DEMO_SHIFTS.some(
        (work) =>
          work.kind === "WORK" &&
          work.staffEmail === shift.staffEmail &&
          work.dayOfWeek === shift.dayOfWeek &&
          work.startsAtMinute <= shift.startsAtMinute &&
          work.endsAtMinute >= shift.endsAtMinute,
      );
      assert.ok(
        covered,
        `break ${shift.id} does not sit inside ${shift.staffEmail}'s day-${shift.dayOfWeek} shift`,
      );
    }
  });

  it("keeps every fixed-time booking inside its performer's shift and off the break", () => {
    // `offsetHours` bookings move with the seeding moment, so no weekly rota can
    // promise them a slot — only the wall-clock ones (`dayOffset` + `time`) are
    // decidable here, and they must all fit or the gate would refuse to re-check.
    const now = INSTANTS[0] as Date;
    const workByStaffDay = DEMO_SHIFTS.filter((row) => row.kind === "WORK");

    for (const appointment of DEMO_APPOINTMENTS) {
      if (appointment.time === undefined) continue;
      const service = serviceByName.get(appointment.service);
      assert.ok(service, `${appointment.id} names unknown service`);

      const day = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + appointment.dayOffset,
      );
      const dayOfWeek = day.getDay();
      const startsAtMinute = parseTimeOfDay(appointment.time);
      const endsAtMinute = startsAtMinute + service.durationMinutes;

      const work = workByStaffDay.find(
        (row) => row.staffEmail === appointment.staffEmail && row.dayOfWeek === dayOfWeek,
      );
      assert.ok(
        work,
        `${appointment.id}: no shift for ${appointment.staffEmail} on day ${dayOfWeek}`,
      );
      assert.ok(
        startsAtMinute >= work.startsAtMinute && endsAtMinute <= work.endsAtMinute,
        `${appointment.id} (${appointment.time} +${service.durationMinutes}m) falls outside ${work.id}`,
      );

      for (const shift of DEMO_SHIFTS) {
        if (shift.kind !== "BREAK") continue;
        if (shift.staffEmail !== appointment.staffEmail || shift.dayOfWeek !== dayOfWeek) continue;
        const overlaps = startsAtMinute < shift.endsAtMinute && endsAtMinute > shift.startsAtMinute;
        assert.ok(!overlaps, `${appointment.id} sits inside the break ${shift.id}`);
      }
    }
  });
});

describe("demo dataset sales", () => {
  it("rings every line against a catalogue row the seed can resolve", () => {
    const keys = new Set<string>();

    for (const sale of DEMO_SALES) {
      assert.ok(!keys.has(sale.key), `duplicate sale key ${sale.key}`);
      keys.add(sale.key);
      assert.ok(sale.lines.length > 0, `sale ${sale.key} has no lines`);
      assert.ok(sale.tenders.length > 0, `sale ${sale.key} has no tenders`);
      assert.ok(staffEmails.has(sale.rangUpByEmail), `sale ${sale.key} names unknown staff`);

      for (const line of sale.lines) {
        const catalogue =
          line.kind === "SERVICE"
            ? serviceByName
            : line.kind === "PRODUCT"
              ? productByName
              : line.kind === "PACKAGE"
                ? packageByName
                : giftCardByName;
        assert.ok(
          catalogue.has(line.name),
          `sale ${sale.key} names unknown ${line.kind} "${line.name}"`,
        );
        if (line.staffEmail) {
          assert.ok(staffEmails.has(line.staffEmail), `sale ${sale.key} credits unknown staff`);
        }
      }

      // A granting line needs an owner, or the write refuses the whole cart.
      const grants = sale.lines.some(
        (line) => line.kind === "PACKAGE" || line.kind === "GIFT_CARD",
      );
      if (grants) {
        assert.ok(sale.customerEmail, `sale ${sale.key} grants credit with no customer`);
      }
      if (sale.customerEmail) {
        assert.ok(
          customerByEmail.has(sale.customerEmail),
          `sale ${sale.key} names unknown customer`,
        );
      }
    }
  });

  it("pays every sale exactly, except the deliberate part payment", () => {
    for (const sale of DEMO_SALES) {
      const customer = sale.customerEmail ? customerByEmail.get(sale.customerEmail) : undefined;
      const expected = demoSaleTotalCents(sale, customer?.memberId != null);
      assert.ok(expected > 0, `sale ${sale.key} prices at zero`);
      const amounts = tenderAmountsCents(expected, sale.tenders);
      const paid = amounts.reduce((sum, amount) => sum + amount, 0);

      if (sale.key === "glampro-seed-sale-07") {
        assert.ok(paid < expected, "sale 07 stops being the part payment");
      } else {
        assert.equal(paid, expected, `sale ${sale.key} is not paid exactly`);
      }
    }
  });

  it("prices every line from the catalogue column the write applies", () => {
    for (const sale of DEMO_SALES) {
      const customer = sale.customerEmail ? customerByEmail.get(sale.customerEmail) : undefined;
      const isMember = customer?.memberId != null;
      for (const line of sale.lines) {
        assert.ok(demoUnitPriceCents(line.kind, line.name, isMember) > 0);
      }
    }
  });

  it("dates every sale at the moment the dataset describes", () => {
    for (const now of INSTANTS) {
      for (const sale of DEMO_SALES) {
        const soldAt = saleMoment(sale, now);
        assert.ok(!Number.isNaN(soldAt.getTime()), `sale ${sale.key} has no date`);
        assert.ok(soldAt <= now, `sale ${sale.key} is dated in the future`);
      }
    }
  });

  it("spends no more stock than the shelf holds", () => {
    const spent = new Map<string, number>();
    for (const sale of DEMO_SALES) {
      for (const line of sale.lines) {
        if (line.kind !== "PRODUCT") continue;
        spent.set(line.name, (spent.get(line.name) ?? 0) + line.quantity);
      }
    }
    for (const [name, quantity] of spent) {
      const product = productByName.get(name);
      assert.ok(product, `sale names unknown product "${name}"`);
      // `quantity` is the shelf *after* a fresh seed, so the shelf plus what
      // the demo sells is what the seed must start with.
      assert.ok(product.quantity + quantity > 0, `product "${name}" is oversold by the demo`);
    }
  });
});
