import "dotenv/config";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";

const databaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "public-booking-test-secret";
process.env.NODE_ENV = "test";
const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform, runAsTenant, runAtOutlet } = await import("../lib/tenant-context.js");
const { createAppointment, updateAppointment, listAppointments, cancelAppointmentSeries } =
  await import("../services/appointment.service.js");
const { updateOutlet } = await import("../services/outlet.service.js");
const { Prisma } = await import("../../generated/prisma/client.js");
const { publicAvailabilitySchema, publicBookingSchema } =
  await import("../schemas/public-booking.js");

const tenantId = "public-booking-regression";
const slug = tenantId;
const date = "2099-06-15";
const startsAt = `${date}T02:00:00.000Z`; // 10:00 Singapore
let serviceId = "";
let noticeId = "";
let staffId = "";
let server: Server;
let origin: string;
const body = () => ({
  serviceId,
  startsAt,
  customerName: "Public Visitor",
  customerPhone: "+6591234567",
  consentGiven: true,
  noticeId,
});

describe("public booking validation", () => {
  it("accepts ISO dates and refuses impossible calendar dates", () => {
    assert.ok(publicAvailabilitySchema.safeParse({ serviceId: "s", date: "2026-10-23" }).success);
    for (const invalid of ["2026-02-30", "2026-13-01", "23/10/2026"])
      assert.equal(
        publicAvailabilitySchema.safeParse({ serviceId: "s", date: invalid }).success,
        false,
      );
  });
  it("requires an instant, a real name, contact details and explicit versioned consent", () => {
    const valid = { ...body(), serviceId: "s", noticeId: "n" };
    assert.ok(publicBookingSchema.safeParse(valid).success);
    for (const change of [
      { startsAt: "tomorrow" },
      { startsAt: "2099-06-15T10:00:00" },
      { customerName: "  " },
      { consentGiven: false },
      { noticeId: "" },
      { customerPhone: null, customerEmail: null },
    ])
      assert.equal(publicBookingSchema.safeParse({ ...valid, ...change }).success, false);
  });
});

describe(
  "public booking endpoints",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    async function request(path = "", data?: unknown) {
      return fetch(`${origin}/api/public/booking/${slug}${path}`, {
        method: data === undefined ? "GET" : "POST",
        ...(data === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(data),
            }),
      });
    }
    async function reset() {
      await runAsPlatform(async () => {
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
        await prisma.tenant.create({
          data: {
            id: tenantId,
            name: "Public Booking Regression",
            slug,
            onlineBookingEnabled: true,
            timeZone: "Asia/Singapore",
            onlineDepositAmount: 2000,
            onlineNoShowFee: 1000,
          },
        });
        const staff = await prisma.user.create({
          data: {
            tenantId,
            name: "Booking Performer",
            passwordHash: "unused-public-booking-test",
          },
        });
        staffId = staff.id;
        const service = await prisma.service.create({
          data: {
            tenantId,
            name: "Facial",
            memberPrice: "40.00",
            nonmemberPrice: "50.00",
            durationMinutes: 60,
          },
        });
        serviceId = service.id;
        const notice = await prisma.privacyNotice.create({
          data: {
            tenantId,
            version: "v1",
            dataConsentText: "Use my details to arrange this booking.",
            marketingConsentText: "Optional marketing",
            createdById: "test",
          },
        });
        noticeId = notice.id;
        const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
        await prisma.tenantOperatingHours.create({
          data: {
            tenantId,
            ...Object.fromEntries(
              days.flatMap((day) => [
                [`${day}Open`, "09:00"],
                [`${day}Close`, "18:00"],
              ]),
            ),
          },
        });
      });
    }
    before(async () => {
      server = createApp().listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    beforeEach(reset);
    after(async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await runAsPlatform(() => prisma.tenant.deleteMany({ where: { id: tenantId } }));
      await prisma.$disconnect();
    });

    it("publishes the notice and returns valid salon-local slots", async () => {
      const config = await request();
      assert.equal(config.status, 200);
      assert.equal((await config.json()).data.privacyNotice.id, noticeId);
      const response = await request(`/availability?serviceId=${serviceId}&date=${date}`);
      assert.equal(response.status, 200);
      assert.ok((await response.json()).data.slots.includes(startsAt));
      assert.equal(
        (await request(`/availability?serviceId=${serviceId}&date=2099-02-30`)).status,
        422,
      );
    });
    it("atomically records an assigned booking and versioned non-marketing consent", async () => {
      const response = await request("", body());
      assert.equal(response.status, 201, await response.clone().text());
      const result = (await response.json()).data;
      assert.match(result.message, /no payment was collected online/i);
      await runAsPlatform(async () => {
        const booking = await prisma.appointment.findUniqueOrThrow({
          where: { id: result.appointmentId },
          include: { customer: true },
        });
        assert.equal(booking.staffId, staffId);
        assert.equal(booking.source, "ONLINE");
        assert.equal(booking.depositAmount, 2000);
        assert.equal(booking.customer?.pdpaConsent, true);
        assert.equal(booking.customer?.marketingOptIn, false);
        const event = await prisma.customerConsentEvent.findFirstOrThrow({
          where: { customerId: booking.customerId! },
        });
        assert.equal(event.noticeId, noticeId);
        assert.equal(event.recordedById, "public-booking:self-reported");
      });
    });
    it("requires a tenant-owned active outlet and enforces overrides on listing and submission", async () => {
      const closed = {
        sunday: null,
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
      };
      const outlet = await runAsPlatform(() =>
        prisma.outlet.create({
          data: {
            tenantId,
            name: "East",
            slug: "east",
            operatingHours: { ...closed, monday: { open: "12:00", close: "18:00" } },
          },
        }),
      );
      assert.equal(
        (await request(`/availability?serviceId=${serviceId}&date=${date}`)).status,
        409,
      );
      assert.equal((await request("", body())).status, 409);
      assert.equal((await request("", { ...body(), outletId: "foreign-outlet" })).status, 404);
      const config = (await (await request()).json()).data;
      assert.equal(config.outlets[0].id, outlet.id);
      const path = `/availability?serviceId=${serviceId}&date=${date}&outletId=${outlet.id}`;
      assert.equal((await (await request(path)).json()).data.slots.includes(startsAt), false);
      assert.equal((await request("", { ...body(), outletId: outlet.id })).status, 409);
      await runAsTenant(tenantId, () => updateOutlet(outlet.id, { operatingHours: null }));
      assert.ok((await (await request(path)).json()).data.slots.includes(startsAt));
      const response = await request("", { ...body(), outletId: outlet.id });
      assert.equal(response.status, 201, await response.clone().text());
      const id = (await response.json()).data.appointmentId;
      assert.equal(
        (await runAsPlatform(() => prisma.appointment.findUniqueOrThrow({ where: { id } })))
          .outletId,
        outlet.id,
      );
      await runAsTenant(tenantId, () => updateOutlet(outlet.id, { status: "SUSPENDED" }));
      assert.equal((await request("", { ...body(), outletId: outlet.id })).status, 409);
    });
    it("retains branch identity for manual edits/series, shares conflicts and preserves legacy bookings", async () => {
      const [east, west] = await runAsPlatform(async () =>
        Promise.all(
          ["east", "west"].map((name) =>
            prisma.outlet.create({ data: { tenantId, name, slug: name } }),
          ),
        ),
      );
      const atOutlet = <T>(id: string, work: () => Promise<T>) =>
        runAsTenant(tenantId, () => runAtOutlet(id, work));
      const manual = { serviceId, staffId, startsAt };
      const branch = await atOutlet(east.id, () =>
        createAppointment({ ...manual, repeat: { intervalWeeks: 1, occurrences: 2 } }),
      );
      assert.equal(branch.appointment.outletId, east.id);
      assert.equal(branch.series?.created, 2);
      await assert.rejects(
        atOutlet(west.id, () => createAppointment(manual)),
        { code: "APPOINTMENT_CLASH" },
      );
      await assert.rejects(
        atOutlet(west.id, () =>
          updateAppointment(branch.appointment.id, { startsAt: `${date}T03:00:00Z` }),
        ),
        { code: "APPOINTMENT_NOT_FOUND" },
      );
      await assert.rejects(
        atOutlet(west.id, () => cancelAppointmentSeries(branch.series!.id)),
        { code: "APPOINTMENT_SERIES_NOT_FOUND" },
      );
      await assert.rejects(
        runAsTenant(tenantId, () =>
          updateAppointment(branch.appointment.id, { startsAt: `${date}T00:00:00Z` }),
        ),
        { code: "OUTLET_CLOSED" },
      );
      const moved = await runAsTenant(tenantId, () =>
        updateAppointment(branch.appointment.id, { startsAt: `${date}T03:00:00Z` }),
      );
      assert.equal(moved.outletId, east.id);
      await runAsTenant(tenantId, () =>
        updateOutlet(east.id, {
          operatingHours: {
            sunday: null,
            monday: null,
            tuesday: null,
            wednesday: null,
            thursday: null,
            friday: null,
            saturday: null,
          },
        }),
      );
      await runAsTenant(tenantId, () =>
        updateAppointment(branch.appointment.id, {
          comment: "Hours changed; keep existing booking.",
        }),
      );
      await assert.rejects(
        atOutlet(east.id, () => createAppointment({ serviceId, startsAt: `${date}T06:00:00Z` })),
        { code: "OUTLET_CLOSED" },
      );
      await runAsTenant(tenantId, () =>
        updateAppointment(branch.appointment.id, { status: "CANCELLED" }),
      );
      await assert.rejects(
        runAsTenant(tenantId, () =>
          updateAppointment(branch.appointment.id, { status: "SCHEDULED" }),
        ),
        { code: "OUTLET_CLOSED" },
      );
      await runAsTenant(tenantId, () => updateOutlet(east.id, { operatingHours: null }));
      // No outlet on old/company bookings: editing at a branch must not reattribute them.
      const legacy = await runAsTenant(tenantId, () =>
        createAppointment({ serviceId, startsAt: `${date}T00:00:00Z` }),
      );
      const edited = await atOutlet(west.id, () =>
        updateAppointment(legacy.appointment.id, { startsAt: `${date}T00:30:00Z` }),
      );
      assert.equal(edited.outletId, null);
      const visible = await atOutlet(west.id, () =>
        listAppointments({ page: 1, pageSize: 100, search: "Facial" }),
      );
      assert.ok(visible.data.some((row) => row.id === legacy.appointment.id));
      assert.equal(
        visible.data.some((row) => row.id === branch.appointment.id),
        false,
      );
    });
    it("uses outlet timezone even when inherited company hours and closes an explicit empty week", async () => {
      const outlet = await runAsPlatform(() =>
        prisma.outlet.create({
          data: { tenantId, name: "West", slug: "west", timeZone: "America/Los_Angeles" },
        }),
      );
      const path = `/availability?serviceId=${serviceId}&date=${date}&outletId=${outlet.id}`;
      const slots = (await (await request(path)).json()).data.slots;
      assert.ok(slots.includes(`${date}T16:00:00.000Z`));
      assert.equal(slots.includes(startsAt), false);
      await runAsPlatform(() =>
        prisma.outlet.update({
          where: { id: outlet.id },
          data: {
            operatingHours: {
              sunday: null,
              monday: null,
              tuesday: null,
              wednesday: null,
              thursday: null,
              friday: null,
              saturday: null,
            },
          },
        }),
      );
      assert.deepEqual((await (await request(path)).json()).data.slots, []);
      await runAsPlatform(() =>
        prisma.outlet.update({ where: { id: outlet.id }, data: { operatingHours: Prisma.DbNull } }),
      );
      assert.ok((await (await request(path)).json()).data.slots.length > 0);
    });
    it("refuses stale concurrent submissions without orphan customers or consent", async () => {
      const responses = await Promise.all([request("", body()), request("", body())]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      await runAsPlatform(async () => {
        assert.equal(await prisma.customer.count({ where: { tenantId } }), 1);
        assert.equal(await prisma.customerConsentEvent.count({ where: { tenantId } }), 1);
      });
    });
    it("refuses past, outside-hours, off-grid, and closing-time-overrun submissions", async () => {
      for (const time of [
        "2000-01-01T02:00:00Z",
        `${date}T00:00:00Z`,
        `${date}T02:15:00Z`,
        `${date}T09:30:00Z`,
      ]) {
        assert.equal((await request("", { ...body(), startsAt: time })).status, 409);
      }
      assert.equal(await runAsPlatform(() => prisma.customer.count({ where: { tenantId } })), 0);
    });
    it("never offers or creates unassigned bookings when no staff are available", async () => {
      await runAsPlatform(() =>
        prisma.user.update({ where: { id: staffId }, data: { disabled: true } }),
      );
      const response = await request(`/availability?serviceId=${serviceId}&date=${date}`);
      assert.deepEqual((await response.json()).data.slots, []);
      assert.equal((await request("", body())).status, 409);
    });
    it("checks resource capacity both when listing slots and submitting", async () => {
      await runAsPlatform(async () => {
        await prisma.resource.create({
          data: {
            tenantId,
            name: "Unavailable room",
            kind: "ROOM",
            status: "INACTIVE",
            services: { create: { tenantId, serviceId } },
          },
        });
      });
      const response = await request(`/availability?serviceId=${serviceId}&date=${date}`);
      assert.deepEqual((await response.json()).data.slots, []);
      assert.equal((await request("", body())).status, 409);
    });
    it("does not double-book one room even when a second performer is free", async () => {
      await runAsPlatform(async () => {
        await prisma.user.create({
          data: { tenantId, name: "Second performer", passwordHash: "unused" },
        });
        await prisma.resource.create({
          data: {
            tenantId,
            name: "Only room",
            kind: "ROOM",
            services: { create: { tenantId, serviceId } },
          },
        });
      });
      const responses = await Promise.all([request("", body()), request("", body())]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      const response = await request(`/availability?serviceId=${serviceId}&date=${date}`);
      assert.equal((await response.json()).data.slots.includes(startsAt), false);
      assert.equal(await runAsPlatform(() => prisma.customer.count({ where: { tenantId } })), 1);
    });
    it("checks staff working hours when listing slots and on submission", async () => {
      const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
      await runAsPlatform(() =>
        prisma.staffShift.create({
          data: {
            tenantId,
            userId: staffId,
            dayOfWeek,
            kind: "WORK",
            startsAtMinute: 12 * 60,
            endsAtMinute: 18 * 60,
          },
        }),
      );
      const response = await request(`/availability?serviceId=${serviceId}&date=${date}`);
      assert.equal((await response.json()).data.slots.includes(startsAt), false);
      assert.equal((await request("", body())).status, 409);
    });
    it("uses the appointment engine's 60-minute fallback at closing time", async () => {
      await runAsPlatform(() =>
        prisma.service.update({ where: { id: serviceId }, data: { durationMinutes: null } }),
      );
      const response = await request(`/availability?serviceId=${serviceId}&date=${date}`);
      const slots = (await response.json()).data.slots as string[];
      assert.ok(slots.includes(`${date}T09:00:00.000Z`));
      assert.equal(slots.includes(`${date}T09:30:00.000Z`), false);
      assert.equal((await request("", { ...body(), startsAt: `${date}T09:30:00Z` })).status, 409);
    });
    it("uses the requested local date in a timezone west of UTC", async () => {
      await runAsPlatform(() =>
        prisma.tenant.update({
          where: { id: tenantId },
          data: { timeZone: "America/Los_Angeles" },
        }),
      );
      const response = await request(`/availability?serviceId=${serviceId}&date=${date}`);
      const slots = (await response.json()).data.slots as string[];
      assert.ok(slots.includes(`${date}T16:00:00.000Z`)); // 09:00 PDT
      assert.equal(slots.includes(startsAt), false);
    });
    it("refuses unpublished or stale notice consent", async () => {
      assert.equal((await request("", { ...body(), noticeId: "old-version" })).status, 409);
      await runAsPlatform(() => prisma.privacyNotice.deleteMany({ where: { tenantId } }));
      assert.equal((await request("", body())).status, 409);
    });
    it("blocks suspended, cancelled, expired and disabled salons", async () => {
      for (const status of ["SUSPENDED", "CANCELLED", "EXPIRED"] as const) {
        await runAsPlatform(() =>
          prisma.tenant.update({ where: { id: tenantId }, data: { status } }),
        );
        assert.equal((await request()).status, 404);
        assert.equal((await request("", body())).status, 404);
      }
      await runAsPlatform(() =>
        prisma.tenant.update({
          where: { id: tenantId },
          data: { status: "ACTIVE", onlineBookingEnabled: false },
        }),
      );
      assert.equal((await request()).status, 404);
    });
    it("blocks an effectively expired subscription even if stored status is active", async () => {
      await runAsPlatform(() =>
        prisma.subscription.create({
          data: {
            tenantId,
            startDate: new Date("2000-01-01"),
            endDate: new Date("2001-01-01"),
            amount: "1.00",
          },
        }),
      );
      assert.equal((await request()).status, 404);
      assert.equal((await request("", body())).status, 404);
    });
    it("does not mutate an existing email customer's consent", async () => {
      const email = "existing@public-booking.test";
      const existing = await runAsPlatform(() =>
        prisma.customer.create({ data: { tenantId, name: "Existing", email } }),
      );
      assert.equal((await request("", { ...body(), customerEmail: email })).status, 409);
      const retained = await runAsPlatform(() =>
        prisma.customer.findUniqueOrThrow({ where: { id: existing.id } }),
      );
      assert.equal(retained.consentRevision, 0);
      assert.equal(await runAsPlatform(() => prisma.appointment.count({ where: { tenantId } })), 0);
    });
    it("does not attach bookings to an existing customer using an unverified phone", async () => {
      const existing = await runAsPlatform(() =>
        prisma.customer.create({
          data: {
            tenantId,
            name: "Existing customer",
            phone: body().customerPhone,
          },
        }),
      );
      assert.equal((await request("", body())).status, 201);
      const retained = await runAsPlatform(() =>
        prisma.customer.findUniqueOrThrow({ where: { id: existing.id } }),
      );
      assert.equal(retained.pdpaConsent, false);
      assert.equal(retained.consentRevision, 0);
    });
  },
);
