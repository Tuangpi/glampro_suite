import { loginForRouteTest } from "../test-support/route-login.js";
import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "settings-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { hashPassword } = await import("../lib/password.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");

const PASSWORD = "correct-horse-1";
const DOMAIN = "settings-rt.test";
const TENANT_A = "settings-rt-a";
const TENANT_B = "settings-rt-b";
const TENANT_SUSPENDED = "settings-rt-suspended";
const TENANT_IDS = [TENANT_A, TENANT_B, TENANT_SUSPENDED];

interface ProfileBody {
  id: string;
  name: string;
  slug: string;
  status: string;
  lowStockThreshold: number;
  timeZone: string;
  locale: string;
  gstEnabled: boolean;
  gstRegistrationNumber: string | null;
  owner: { id: string; name: string; email: string } | null;
}

interface ModuleBody {
  code: string;
  isCore: boolean;
  entitled: boolean;
  expiresAt: string | null;
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
    const dashboard = await prisma.module.upsert({
      where: { code: "dashboard" },
      update: { isCore: true, sortOrder: 1 },
      create: {
        code: "dashboard",
        name: "Dashboard",
        category: "Core",
        isCore: true,
        sortOrder: 1,
      },
    });
    const reports = await prisma.module.upsert({
      where: { code: "reports" },
      update: { isCore: false, sortOrder: 2 },
      create: {
        code: "reports",
        name: "Reports",
        category: "Add-on",
        isCore: false,
        sortOrder: 2,
      },
    });
    const inventory = await prisma.module.upsert({
      where: { code: "inventory" },
      update: { isCore: false, sortOrder: 3 },
      create: {
        code: "inventory",
        name: "Inventory",
        category: "Add-on",
        isCore: false,
        sortOrder: 3,
      },
    });

    await prisma.tenant.create({
      data: { id: TENANT_A, name: "Settings A", slug: TENANT_A, lowStockThreshold: 6 },
    });
    await prisma.tenant.create({ data: { id: TENANT_B, name: "Settings B", slug: TENANT_B } });
    await prisma.tenant.create({
      data: {
        id: TENANT_SUSPENDED,
        name: "Settings Suspended",
        slug: TENANT_SUSPENDED,
        status: "SUSPENDED",
      },
    });

    const owner = await prisma.user.create({
      data: {
        id: "settings-rt-owner",
        tenantId: TENANT_A,
        email: `owner@${DOMAIN}`,
        name: "Sonia Owner",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });
    await prisma.user.create({
      data: {
        id: "settings-rt-staff",
        tenantId: TENANT_A,
        email: `staff@${DOMAIN}`,
        name: "Stan Staff",
        passwordHash,
        globalRole: "STAFF",
      },
    });
    await prisma.user.create({
      data: {
        id: "settings-rt-foreign-owner",
        tenantId: TENANT_B,
        email: `foreign@${DOMAIN}`,
        name: "Foreign Owner",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });
    await prisma.user.create({
      data: {
        id: "settings-rt-suspended-owner",
        tenantId: TENANT_SUSPENDED,
        email: `suspended@${DOMAIN}`,
        name: "Suspended Owner",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });

    await prisma.tenant.update({ where: { id: TENANT_A }, data: { ownerUserId: owner.id } });
    await prisma.tenantModule.createMany({
      data: [
        {
          tenantId: TENANT_A,
          moduleId: reports.id,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        },
        {
          tenantId: TENANT_A,
          moduleId: inventory.id,
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      ],
    });

    assert.equal(dashboard.isCore, true);
  });
}

async function dataOf<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

let baseUrl = "";
let server: Server | undefined;
let ownerToken = "";
let staffToken = "";
let suspendedToken = "";

async function login(email: string): Promise<string> {
  return loginForRouteTest(baseUrl, email, PASSWORD);
}

function request(
  method: "GET" | "PATCH",
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

describe("settings endpoints", { skip: databaseUrl ? false : "DATABASE_URL is not set" }, () => {
  before(async () => {
    await purge();
    await seed();
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
    ownerToken = await login(`owner@${DOMAIN}`);
    staffToken = await login(`staff@${DOMAIN}`);
    suspendedToken = await login(`suspended@${DOMAIN}`);
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await purge();
  });

  it("protects both reads and returns only the signed-in salon's profile", async () => {
    assert.equal((await request("GET", "/api/settings/profile")).status, 401);
    assert.equal((await request("GET", "/api/settings/modules")).status, 401);

    const response = await request("GET", "/api/settings/profile", ownerToken);
    const profile = await dataOf<ProfileBody>(response);

    assert.equal(response.status, 200);
    assert.equal(profile.id, TENANT_A);
    assert.equal(profile.name, "Settings A");
    assert.equal(profile.slug, TENANT_A);
    assert.equal(profile.lowStockThreshold, 6);
    assert.equal(profile.timeZone, "Asia/Singapore");
    assert.equal(profile.locale, "en-SG");
    assert.deepEqual(profile.owner, {
      id: "settings-rt-owner",
      name: "Sonia Owner",
      email: `owner@${DOMAIN}`,
    });
  });

  it("resolves core, live and expired module entitlements", async () => {
    const response = await request("GET", "/api/settings/modules", ownerToken);
    const modules = await dataOf<ModuleBody[]>(response);
    const byCode = new Map(modules.map((module) => [module.code, module]));

    assert.equal(response.status, 200);
    assert.equal(byCode.get("dashboard")?.entitled, true);
    assert.equal(byCode.get("dashboard")?.isCore, true);
    assert.equal(byCode.get("reports")?.entitled, true);
    assert.equal(byCode.get("reports")?.expiresAt, "2099-01-01T00:00:00.000Z");
    assert.equal(byCode.get("inventory")?.entitled, false);
  });

  it("accepts salon-editable profile fields while preserving platform fields", async () => {
    const invalid = await request("PATCH", "/api/settings/profile", ownerToken, {
      name: "Renamed Salon",
      lowStockThreshold: 9,
      slug: "forged-slug",
    });
    assert.equal(invalid.status, 422);

    const response = await request("PATCH", "/api/settings/profile", ownerToken, {
      name: "Renamed Salon",
      lowStockThreshold: 9,
    });
    const profile = await dataOf<ProfileBody>(response);

    assert.equal(response.status, 200);
    assert.equal(profile.name, "Renamed Salon");
    assert.equal(profile.lowStockThreshold, 9);
    assert.equal(profile.slug, TENANT_A);
    assert.equal(profile.status, "ACTIVE");
  });

  it("persists localisation, preserves it for older clients and isolates other salons", async () => {
    const response = await request("PATCH", "/api/settings/profile", ownerToken, {
      name: "Renamed Salon",
      lowStockThreshold: 9,
      timeZone: "Europe/London",
      locale: "en-GB",
    });
    assert.equal(response.status, 200);
    const saved = await dataOf<ProfileBody>(response);
    assert.equal(saved.timeZone, "Europe/London");
    assert.equal(saved.locale, "en-GB");

    const legacy = await request("PATCH", "/api/settings/profile", ownerToken, {
      name: "Renamed Salon",
      lowStockThreshold: 9,
    });
    assert.equal(legacy.status, 200);
    const reread = await dataOf<ProfileBody>(
      await request("GET", "/api/settings/profile", ownerToken),
    );
    assert.equal(reread.timeZone, "Europe/London");
    assert.equal(reread.locale, "en-GB");
    const other = await runAsPlatform(() =>
      prisma.tenant.findUniqueOrThrow({ where: { id: TENANT_B } }),
    );
    assert.equal(other.timeZone, "Asia/Singapore");
    assert.equal(other.locale, "en-SG");
  });

  it("rejects invalid localisation without changing the stored preferences", async () => {
    for (const preference of [{ timeZone: "Mars/Olympus" }, { locale: "en_SG" }]) {
      const response = await request("PATCH", "/api/settings/profile", ownerToken, {
        name: "Renamed Salon",
        lowStockThreshold: 9,
        ...preference,
      });
      assert.equal(response.status, 422);
    }
    const profile = await dataOf<ProfileBody>(
      await request("GET", "/api/settings/profile", ownerToken),
    );
    assert.equal(profile.timeZone, "Europe/London");
    assert.equal(profile.locale, "en-GB");
  });

  it("persists the GST pair and refuses an enabled salon without a registration number", async () => {
    const enabled = await request("PATCH", "/api/settings/profile", ownerToken, {
      name: "Renamed Salon",
      lowStockThreshold: 9,
      gstEnabled: true,
      gstRegistrationNumber: "M90312345X",
    });
    assert.equal(enabled.status, 200);
    const saved = await dataOf<ProfileBody>(enabled);
    assert.equal(saved.gstEnabled, true);
    assert.equal(saved.gstRegistrationNumber, "M90312345X");

    // A toggle-only PATCH keeps working because the service sees the stored number.
    const toggleOnly = await request("PATCH", "/api/settings/profile", ownerToken, {
      name: "Renamed Salon",
      lowStockThreshold: 9,
      gstEnabled: true,
    });
    assert.equal(toggleOnly.status, 200);

    // Clearing the number while GST stays enabled is refused: revenue would be
    // taxed with nothing to print on the receipt.
    const clearing = await request("PATCH", "/api/settings/profile", ownerToken, {
      name: "Renamed Salon",
      lowStockThreshold: 9,
      gstRegistrationNumber: null,
    });
    assert.equal(clearing.status, 400);
    assert.equal(((await clearing.json()) as ErrorEnvelope).code, "BAD_REQUEST");

    // Turn GST off and clear the pair, then enabling has nothing to fall back on.
    const cleared = await request("PATCH", "/api/settings/profile", ownerToken, {
      name: "Renamed Salon",
      lowStockThreshold: 9,
      gstEnabled: false,
      gstRegistrationNumber: null,
    });
    assert.equal(cleared.status, 200);
    const unregistered = await dataOf<ProfileBody>(cleared);
    assert.equal(unregistered.gstEnabled, false);
    assert.equal(unregistered.gstRegistrationNumber, null);

    const enabledAgain = await request("PATCH", "/api/settings/profile", ownerToken, {
      name: "Renamed Salon",
      lowStockThreshold: 9,
      gstEnabled: true,
    });
    assert.equal(enabledAgain.status, 400);
    assert.equal(((await enabledAgain.json()) as ErrorEnvelope).code, "BAD_REQUEST");
  });

  it("leaves GST off for a salon that never configured it", async () => {
    const other = await runAsPlatform(() =>
      prisma.tenant.findUniqueOrThrow({ where: { id: TENANT_B } }),
    );
    assert.equal(other.gstEnabled, false);
    assert.equal(other.gstRegistrationNumber, null);
  });

  it("refuses profile writes by staff and suspended salons", async () => {
    const staffResponse = await request("PATCH", "/api/settings/profile", staffToken, {
      name: "Staff Rename",
      lowStockThreshold: 1,
      timeZone: "America/New_York",
      locale: "en-US",
    });
    assert.equal(staffResponse.status, 403);

    const suspendedResponse = await request("PATCH", "/api/settings/profile", suspendedToken, {
      name: "Suspended Rename",
      lowStockThreshold: 1,
      timeZone: "America/New_York",
      locale: "en-US",
    });
    assert.equal(suspendedResponse.status, 403);
    assert.equal(((await suspendedResponse.json()) as ErrorEnvelope).code, "TENANT_SUSPENDED");
  });
});
