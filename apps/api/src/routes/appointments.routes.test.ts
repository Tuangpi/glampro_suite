import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "appointments-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { hashPassword } = await import("../lib/password.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");

const PASSWORD = "correct-horse-1";
const DOMAIN = "appointments-rt.test";
const TENANT_A = "appointments-rt-a";
const TENANT_B = "appointments-rt-b";
const TENANT_SUSPENDED = "appointments-rt-suspended";
const TENANT_IDS = [TENANT_A, TENANT_B, TENANT_SUSPENDED];

interface AppointmentBody {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  durationMinutes: number | null;
  customerName: string | null;
  staffName: string | null;
  serviceName: string | null;
  services: {
    serviceName: string | null;
    staffName: string | null;
    startsAt: string;
    endsAt: string;
    durationMinutes: number;
  }[];
  finishedAt?: string | null;
}

interface ErrorEnvelope {
  code?: string;
}

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
  });
}

async function seed(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);

  await runAsPlatform(async () => {
    await prisma.module.upsert({
      where: { code: "appointments" },
      update: { isCore: true },
      create: {
        code: "appointments",
        name: "Appointments",
        category: "Core",
        isCore: true,
      },
    });

    await prisma.tenant.create({ data: { id: TENANT_A, name: "Appointments A", slug: TENANT_A } });
    await prisma.tenant.create({ data: { id: TENANT_B, name: "Appointments B", slug: TENANT_B } });
    await prisma.tenant.create({
      data: {
        id: TENANT_SUSPENDED,
        name: "Appointments Suspended",
        slug: TENANT_SUSPENDED,
        status: "SUSPENDED",
      },
    });

    const owner = await prisma.user.create({
      data: {
        id: "appointments-rt-owner",
        tenantId: TENANT_A,
        email: `owner@${DOMAIN}`,
        name: "Olivia Owner",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });
    const stylist = await prisma.user.create({
      data: {
        id: "appointments-rt-stylist",
        tenantId: TENANT_A,
        email: `stylist@${DOMAIN}`,
        name: "Sam Stylist",
        passwordHash,
      },
    });
    const foreignOwner = await prisma.user.create({
      data: {
        id: "appointments-rt-foreign-owner",
        tenantId: TENANT_B,
        email: `foreign@${DOMAIN}`,
        name: "Foreign Owner",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });
    await prisma.user.create({
      data: {
        id: "appointments-rt-suspended-owner",
        tenantId: TENANT_SUSPENDED,
        email: `suspended@${DOMAIN}`,
        name: "Suspended Owner",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });

    const department = await prisma.department.create({
      data: { id: "appointments-rt-department", tenantId: TENANT_A, name: "Hair" },
    });
    await prisma.staffDepartment.create({
      data: { tenantId: TENANT_A, userId: stylist.id, departmentId: department.id },
    });
    const service = await prisma.service.create({
      data: {
        id: "appointments-rt-service",
        tenantId: TENANT_A,
        departmentId: department.id,
        name: "Cut and finish",
        memberPrice: "35.00",
        nonmemberPrice: "40.00",
        durationMinutes: 45,
      },
    });
    const customer = await prisma.customer.create({
      data: { id: "appointments-rt-customer", tenantId: TENANT_A, name: "Casey Client" },
    });
    // A second service in the same branch, so a booking can be a chain of two
    // lengths rather than the same one twice.
    await prisma.service.create({
      data: {
        id: "appointments-rt-manicure",
        tenantId: TENANT_A,
        departmentId: department.id,
        name: "Manicure",
        memberPrice: "25.00",
        nonmemberPrice: "28.00",
        durationMinutes: 30,
      },
    });

    await prisma.appointment.create({
      data: {
        id: "appointments-rt-existing",
        tenantId: TENANT_A,
        customerId: customer.id,
        staffId: stylist.id,
        serviceId: service.id,
        startsAt: new Date("2026-10-09T09:00:00.000Z"),
        endsAt: new Date("2026-10-09T09:45:00.000Z"),
        durationMinutes: 45,
      },
    });
    await prisma.appointment.create({
      data: {
        id: "appointments-rt-foreign",
        tenantId: TENANT_B,
        staffId: foreignOwner.id,
        startsAt: new Date("2026-10-09T10:00:00.000Z"),
        endsAt: new Date("2026-10-09T11:00:00.000Z"),
        durationMinutes: 60,
      },
    });

    await prisma.tenant.update({ where: { id: TENANT_A }, data: { ownerUserId: owner.id } });
  });
}

async function dataOf<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

let baseUrl = "";
let server: Server | undefined;
let token = "";
let suspendedToken = "";

async function login(email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.equal(response.status, 200);
  return (await dataOf<{ accessToken: string }>(response)).accessToken;
}

function request(
  method: "GET" | "POST" | "PATCH",
  path: string,
  accessToken?: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe(
  "appointments endpoints",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    before(async () => {
      await purge();
      await seed();
      await new Promise<void>((resolve) => {
        server = createApp().listen(0, "127.0.0.1", () => resolve());
      });
      baseUrl = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
      token = await login(`owner@${DOMAIN}`);
      suspendedToken = await login(`suspended@${DOMAIN}`);
    });

    after(async () => {
      await new Promise<void>((resolve, reject) => {
        if (!server) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await purge();
    });

    it("protects the list and returns one tenant-scoped pagination envelope", async () => {
      assert.equal((await request("GET", "/api/appointments")).status, 401);

      const response = await request("GET", "/api/appointments?page=1&pageSize=20", token);
      const page = await dataOf<{
        data: AppointmentBody[];
        total: number;
        page: number;
        pageSize: number;
      }>(response);

      assert.equal(response.status, 200);
      assert.equal(page.total, 1);
      assert.equal(page.page, 1);
      assert.equal(page.pageSize, 20);
      assert.deepEqual(
        page.data.map((appointment) => appointment.id),
        ["appointments-rt-existing"],
      );
      assert.equal(page.data[0]?.customerName, "Casey Client");
    });

    it("does not expose another tenant's appointment by id", async () => {
      const response = await request("GET", "/api/appointments/appointments-rt-foreign", token);
      assert.equal(response.status, 404);
    });

    it("derives the end time from the service and stamps completion", async () => {
      const createdResponse = await request("POST", "/api/appointments", token, {
        customerId: "appointments-rt-customer",
        staffId: "appointments-rt-stylist",
        serviceId: "appointments-rt-service",
        startsAt: "2026-10-09T12:00:00.000Z",
        comment: "Route-test booking",
      });
      const created = await dataOf<AppointmentBody>(createdResponse);

      assert.equal(createdResponse.status, 201);
      assert.equal(created.durationMinutes, 45);
      assert.equal(created.endsAt, "2026-10-09T12:45:00.000Z");
      assert.equal(created.staffName, "Sam Stylist");
      assert.equal(created.serviceName, "Cut and finish");

      const completedResponse = await request("PATCH", `/api/appointments/${created.id}`, token, {
        status: "COMPLETED",
      });
      const completed = await dataOf<AppointmentBody>(completedResponse);

      assert.equal(completedResponse.status, 200);
      assert.equal(completed.status, "COMPLETED");
      assert.equal(typeof completed.finishedAt, "string");
    });

    it("books several services as one chained booking and refuses the ambiguous shapes", async () => {
      const response = await request("POST", "/api/appointments", token, {
        customerId: "appointments-rt-customer",
        staffId: "appointments-rt-stylist",
        startsAt: "2026-10-09T13:00:00.000Z",
        services: [
          { serviceId: "appointments-rt-manicure" },
          { serviceId: "appointments-rt-service" },
        ],
      });
      const created = await dataOf<AppointmentBody>(response);

      assert.equal(response.status, 201);
      assert.equal(created.durationMinutes, 75, "30 + 45 minutes");
      assert.equal(created.endsAt, "2026-10-09T14:15:00.000Z");
      // The flat columns are line 0, so a single-service reader is still right.
      assert.equal(created.serviceName, "Manicure");
      assert.deepEqual(
        created.services.map((line) => [line.serviceName, line.startsAt, line.endsAt]),
        [
          ["Manicure", "2026-10-09T13:00:00.000Z", "2026-10-09T13:30:00.000Z"],
          ["Cut and finish", "2026-10-09T13:30:00.000Z", "2026-10-09T14:15:00.000Z"],
        ],
      );

      // The contract refuses a body that names its services twice, so the server
      // never has to guess which of the two the booking is.
      const both = await request("POST", "/api/appointments", token, {
        serviceId: "appointments-rt-service",
        services: [{ serviceId: "appointments-rt-service" }],
        startsAt: "2026-10-09T16:00:00.000Z",
      });
      assert.equal(both.status, 422);
      assert.deepEqual(
        ((await both.json()) as { details?: { path?: string }[] }).details?.map(
          (detail) => detail.path,
        ),
        ["body.services"],
      );

      const neither = await request("POST", "/api/appointments", token, {
        startsAt: "2026-10-09T16:00:00.000Z",
      });
      assert.equal(neither.status, 422);
    });

    it("keeps suspended salons read-only", async () => {
      const response = await request("POST", "/api/appointments", suspendedToken, {
        serviceId: "appointments-rt-service",
        startsAt: "2026-10-09T14:00:00.000Z",
      });

      assert.equal(response.status, 403);
      assert.equal(((await response.json()) as ErrorEnvelope).code, "TENANT_SUSPENDED");
    });

    it("includes overnight occupancy only for overlap reads and excludes exact end boundaries", async () => {
      await runAsPlatform(() =>
        prisma.appointment.create({
          data: {
            id: "appointments-rt-overnight",
            tenantId: TENANT_A,
            startsAt: new Date("2026-10-08T15:00:00.000Z"),
            endsAt: new Date("2026-10-09T01:00:00.000Z"),
          },
        }),
      );
      const range = "from=2026-10-08T16:00:00.000Z&to=2026-10-09T15:59:59.999Z";
      const read = async (suffix: string) =>
        dataOf<{ data: AppointmentBody[] }>(
          await request("GET", `/api/appointments?${suffix}`, token),
        );
      assert.equal(
        (await read(range)).data.some((row) => row.id === "appointments-rt-overnight"),
        false,
      );
      assert.equal(
        (await read(`${range}&overlap=true`)).data.some(
          (row) => row.id === "appointments-rt-overnight",
        ),
        true,
      );
      assert.equal(
        (await read("from=2026-10-09T01:00:00.000Z&overlap=true")).data.some(
          (row) => row.id === "appointments-rt-overnight",
        ),
        false,
      );
    });

    it("preserves duration snapshots on reschedule and rejects clashes and foreign writes", async () => {
      await runAsPlatform(() =>
        prisma.service.update({
          where: { id: "appointments-rt-service" },
          data: { durationMinutes: 90 },
        }),
      );
      const moved = await request("PATCH", "/api/appointments/appointments-rt-existing", token, {
        startsAt: "2026-10-10T01:00:00.000Z",
      });
      const row = await dataOf<AppointmentBody>(moved);
      assert.equal(moved.status, 200);
      assert.equal(row.durationMinutes, 45);
      assert.equal(row.endsAt, "2026-10-10T01:45:00.000Z");
      const clash = await request("POST", "/api/appointments", token, {
        startsAt: "2026-10-10T01:15:00.000Z",
        staffId: "appointments-rt-stylist",
        serviceId: "appointments-rt-service",
      });
      assert.equal(clash.status, 409);
      assert.equal(
        (
          await request("PATCH", "/api/appointments/appointments-rt-foreign", token, {
            startsAt: row.startsAt,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request("PATCH", "/api/appointments/appointments-rt-existing", suspendedToken, {
            startsAt: row.startsAt,
          })
        ).status,
        403,
      );
      await runAsPlatform(() =>
        prisma.service.update({
          where: { id: "appointments-rt-service" },
          data: { durationMinutes: 45 },
        }),
      );
    });

    it("refuses booking an inactive service and names the service field", async () => {
      await runAsPlatform(() =>
        prisma.service.update({
          where: { id: "appointments-rt-service" },
          data: { status: "INACTIVE" },
        }),
      );
      try {
        const response = await request("POST", "/api/appointments", token, {
          serviceId: "appointments-rt-service",
          startsAt: "2026-10-11T09:00:00.000Z",
        });
        const body = (await response.json()) as ErrorEnvelope & {
          details?: { path: string; message: string }[];
        };

        assert.equal(response.status, 400);
        assert.equal(body.code, "SERVICE_INACTIVE");
        assert.deepEqual(
          body.details?.map((detail) => detail.path),
          ["serviceId"],
        );
      } finally {
        await runAsPlatform(() =>
          prisma.service.update({
            where: { id: "appointments-rt-service" },
            data: { status: "ACTIVE" },
          }),
        );
      }
    });

    it("pages a calendar window beyond 200 rows without tenant leakage", async () => {
      await runAsPlatform(() =>
        prisma.appointment.createMany({
          data: Array.from({ length: 205 }, (_, index) => ({
            id: `appointments-rt-page-${index}`,
            tenantId: TENANT_A,
            startsAt: new Date("2026-11-01T01:00:00.000Z"),
            endsAt: new Date("2026-11-01T02:00:00.000Z"),
          })),
        }),
      );
      const read = async (page: number) =>
        dataOf<{ data: AppointmentBody[]; total: number }>(
          await request(
            "GET",
            `/api/appointments?overlap=true&from=2026-11-01T00:00:00.000Z&to=2026-11-01T23:59:59.999Z&pageSize=200&page=${page}`,
            token,
          ),
        );
      const first = await read(1);
      const second = await read(2);
      assert.equal(first.total, 205);
      assert.equal(first.data.length, 200);
      assert.equal(second.data.length, 5);
      assert.equal(new Set([...first.data, ...second.data].map((row) => row.id)).size, 205);
    });
  },
);
