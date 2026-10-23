import { loginForRouteTest } from "../test-support/route-login.js";
import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "resources-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { hashPassword } = await import("../lib/password.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");

const PASSWORD = "correct-horse-1";
const DOMAIN = "resources-rt.test";
const TENANT_A = "resources-rt-a";
const TENANT_B = "resources-rt-b";
const TENANT_IDS = [TENANT_A, TENANT_B];

interface ResourceBody {
  id: string;
  name: string;
  kind: string;
  status: string;
  serviceIds: string[];
}

interface ErrorEnvelope {
  code?: string;
  details?: { path: string; message: string }[];
}

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
    await prisma.user.deleteMany({ where: { email: { contains: `@${DOMAIN}` } } });
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

    await prisma.tenant.create({ data: { id: TENANT_A, name: "Resources A", slug: TENANT_A } });
    await prisma.tenant.create({ data: { id: TENANT_B, name: "Resources B", slug: TENANT_B } });

    const manager = await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: `manager@${DOMAIN}`,
        name: "Mona Manager",
        passwordHash,
        globalRole: "MANAGER",
      },
    });
    await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: `stylist@${DOMAIN}`,
        name: "Sam Stylist",
        passwordHash,
      },
    });
    await prisma.user.create({
      data: {
        tenantId: TENANT_B,
        email: `foreign@${DOMAIN}`,
        name: "Fiona Foreign",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });

    const service = await prisma.service.create({
      data: {
        tenantId: TENANT_A,
        name: "Colour",
        memberPrice: "35.00",
        nonmemberPrice: "40.00",
        durationMinutes: 60,
      },
    });
    const room = await prisma.resource.create({
      data: {
        tenantId: TENANT_A,
        name: "Room 1",
        kind: "ROOM",
        services: { create: [{ tenantId: TENANT_A, serviceId: service.id }] },
      },
    });
    await prisma.resource.create({
      data: { tenantId: TENANT_B, name: "Room 1", kind: "ROOM" },
    });

    await prisma.tenant.update({ where: { id: TENANT_A }, data: { ownerUserId: manager.id } });
    // Kept for the tests that need the seeded ids.
    SERVICE_ID = service.id;
    ROOM_ID = room.id;
  });
}

let SERVICE_ID = "";
let ROOM_ID = "";

async function dataOf<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

let baseUrl = "";
let server: Server | undefined;
let managerToken = "";
let stylistToken = "";
let foreignToken = "";

async function login(email: string): Promise<string> {
  return loginForRouteTest(baseUrl, email, PASSWORD);
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

describe("resources endpoints", { skip: databaseUrl ? false : "DATABASE_URL is not set" }, () => {
  before(async () => {
    await purge();
    await seed();
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
    managerToken = await login(`manager@${DOMAIN}`);
    stylistToken = await login(`stylist@${DOMAIN}`);
    foreignToken = await login(`foreign@${DOMAIN}`);
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await purge();
  });

  it("lets every signed-in member read the rooms", async () => {
    assert.equal((await request("GET", "/api/resources")).status, 401);

    const response = await request("GET", "/api/resources", stylistToken);
    const rows = await dataOf<ResourceBody[]>(response);

    assert.equal(response.status, 200);
    assert.deepEqual(
      rows.map((row) => row.name),
      ["Room 1"],
    );
    assert.deepEqual(rows[0]?.serviceIds, [SERVICE_ID]);
  });

  it("refuses a write from a stylist and accepts the manager's", async () => {
    assert.equal(
      (
        await request("POST", "/api/resources", stylistToken, {
          name: "Room 2",
        })
      ).status,
      403,
    );

    const response = await request("POST", "/api/resources", managerToken, {
      name: "Room 2",
      serviceIds: [SERVICE_ID],
    });
    const created = await dataOf<ResourceBody>(response);

    assert.equal(response.status, 201);
    assert.equal(created.name, "Room 2");
    // The contract's default, not an invented one.
    assert.equal(created.kind, "ROOM");
    assert.equal(created.status, "ACTIVE");
    assert.deepEqual(created.serviceIds, [SERVICE_ID]);
  });

  it("puts a duplicate name on the name field", async () => {
    const response = await request("POST", "/api/resources", managerToken, {
      name: "Room 1",
    });
    const body = (await response.json()) as ErrorEnvelope;

    assert.equal(response.status, 409);
    assert.equal(body.code, "RESOURCE_NAME_TAKEN");
    assert.equal(body.details?.[0]?.path, "body.name");
  });

  it("archives a room by status and replaces the service set", async () => {
    const response = await request("PATCH", `/api/resources/${ROOM_ID}`, managerToken, {
      status: "INACTIVE",
      serviceIds: [],
    });
    const updated = await dataOf<ResourceBody>(response);

    assert.equal(response.status, 200);
    assert.equal(updated.status, "INACTIVE");
    assert.deepEqual(updated.serviceIds, []);

    // Put the fixture back: a later read of the seeded room expects it active.
    await request("PATCH", `/api/resources/${ROOM_ID}`, managerToken, {
      status: "ACTIVE",
      serviceIds: [SERVICE_ID],
    });
  });

  it("does not let another salon read the room by id", async () => {
    const response = await request("GET", `/api/resources/${ROOM_ID}`, foreignToken);
    const body = (await response.json()) as ErrorEnvelope;

    assert.equal(response.status, 404);
    assert.equal(body.code, "RESOURCE_NOT_FOUND");
  });

  it("refuses a service id the salon does not have", async () => {
    const response = await request("POST", "/api/resources", managerToken, {
      name: "Room 3",
      serviceIds: ["no-such-service"],
    });
    const body = (await response.json()) as ErrorEnvelope;

    assert.equal(response.status, 400);
    assert.equal(body.code, "SERVICE_NOT_FOUND");
  });

  it("refuses cross-tenant writes and eligibility references", async () => {
    const update = await request("PATCH", `/api/resources/${ROOM_ID}`, foreignToken, {
      name: "Foreign change",
      serviceIds: [],
    });
    assert.equal(update.status, 404);

    const create = await request("POST", "/api/resources", foreignToken, {
      name: "Foreign room",
      serviceIds: [SERVICE_ID],
    });
    assert.equal(create.status, 400);
    assert.equal(((await create.json()) as ErrorEnvelope).code, "SERVICE_NOT_FOUND");

    const original = await dataOf<ResourceBody>(
      await request("GET", `/api/resources/${ROOM_ID}`, managerToken),
    );
    assert.equal(original.name, "Room 1");
    assert.deepEqual(original.serviceIds, [SERVICE_ID]);
  });
});
