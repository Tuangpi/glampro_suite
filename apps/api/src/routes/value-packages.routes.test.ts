import { loginForRouteTest } from "../test-support/route-login.js";
// Static, so the `DATABASE_URL` gate below reads `.env` instead of skipping silently.
import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

/**
 * Integration tests for `/api/value-packages` — screen 08's fifth tab.
 *
 * The questions worth asking here are the ones the screen cannot answer for itself:
 *
 * - the mount is behind the **`packages` add-on**, so a salon without it is refused
 *   with `403 MODULE_NOT_ENTITLED` for reads *and* writes even though it is signed in
 *   and the rows would be its own;
 * - `credit: 0` is refused, because credit that grants nothing is a price with no
 *   promise, while `credit < price` is allowed — that is a bad deal, not an invalid
 *   one;
 * - a `serviceId` from another salon is refused with a 422 naming `body.serviceIds`,
 *   so the link table cannot become a cross-tenant join;
 * - there is **no `DELETE`**, because `ValuePackageService` and
 *   `CustomerValuePackageHolding` cascade from the row and a delete would erase
 *   purchase history. `status: INACTIVE` is the retirement path.
 *
 * Gated on `DATABASE_URL`, like `packages.routes.test.ts`: the suite creates two
 * salons, signs in for real, and removes everything it made.
 */
const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "value-packages-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");
const { hashPassword } = await import("../lib/password.js");
const { CORE_MODULE_CODES, MODULE_CODES } = await import("@glampro_suite/shared");

const PASSWORD = "correct-horse-1";
const DOMAIN = "value-packages-rt.test";

const TENANTS = { a: "value-packages-a", b: "value-packages-b" } as const;
const TENANT_IDS = Object.values(TENANTS);

const EMAIL = `owner@${DOMAIN}`;
/** One service in each salon, so "a service id from elsewhere" is a real id. */
const SERVICES = { a: "value-packages-svc-a", b: "value-packages-svc-b" } as const;

/** Removes everything this file created, so runs are repeatable. */
async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.valuePackageService.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.valuePackage.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.service.deleteMany({ where: { id: { in: Object.values(SERVICES) } } });
    await prisma.tenantModule.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
  });
}

/** Two salons, one owner and one service in each. A is granted nothing to begin with. */
async function seed(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);

  await runAsPlatform(async () => {
    await prisma.tenant.create({
      data: { id: TENANTS.a, name: "Value Packages A", slug: "value-packages-a" },
    });
    await prisma.tenant.create({
      data: { id: TENANTS.b, name: "Value Packages B", slug: "value-packages-b" },
    });

    await prisma.user.create({
      data: {
        tenantId: TENANTS.a,
        email: EMAIL,
        name: "Ola Owner",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });

    await prisma.service.create({
      data: {
        id: SERVICES.a,
        tenantId: TENANTS.a,
        name: "Balayage",
        memberPrice: "120.00",
        nonmemberPrice: "140.00",
      },
    });
    await prisma.service.create({
      data: {
        id: SERVICES.b,
        tenantId: TENANTS.b,
        name: "Another Salon's Cut",
        memberPrice: "40.00",
        nonmemberPrice: "50.00",
      },
    });

    // `requireModule` refuses an **unknown** module loudly (`MODULE_UNKNOWN`), which is
    // a different refusal from "your salon has not bought this". Without the catalogue
    // seeded the not-entitled assertion would pass for the wrong reason.
    for (const [index, code] of MODULE_CODES.entries()) {
      const isCore = (CORE_MODULE_CODES as readonly string[]).includes(code);
      await prisma.module.upsert({
        where: { code },
        update: { isCore },
        create: {
          code,
          name: code,
          category: isCore ? "Core" : "Add-on",
          isCore,
          sortOrder: index,
        },
      });
    }
  });
}

/** Grants or revokes the `packages` add-on for tenant A. */
async function setEntitlement(code: string, entitled: boolean): Promise<void> {
  await runAsPlatform(async () => {
    const module = await prisma.module.findUniqueOrThrow({
      where: { code },
      select: { id: true },
    });

    if (entitled) {
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId: TENANTS.a, moduleId: module.id } },
        update: { expiresAt: null },
        create: { tenantId: TENANTS.a, moduleId: module.id },
      });
      return;
    }

    await prisma.tenantModule.deleteMany({ where: { tenantId: TENANTS.a, moduleId: module.id } });
  });
}

interface Envelope {
  data?: unknown;
  statusCode?: number;
  message?: string;
  code?: string;
  details?: { module?: string } | { path: string; message: string }[];
}

async function envelope(response: Response): Promise<Envelope> {
  return (await response.json()) as Envelope;
}

async function dataOf<T>(response: Response): Promise<T> {
  const body = await envelope(response);
  assert.ok(body.data !== undefined, `expected a data envelope, got ${JSON.stringify(body)}`);
  return body.data as T;
}

/** A 422's `details[].path` names the control the browser must highlight. */
function detailPaths(body: Envelope): string[] {
  return Array.isArray(body.details) ? body.details.map((detail) => detail.path) : [];
}

let baseUrl = "";
let server: Server | undefined;

async function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  accessToken?: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe(
  "value-packages endpoints",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    let token = "";
    let createdId = "";

    before(async () => {
      await purge();
      await seed();

      await new Promise<void>((resolve) => {
        server = createApp().listen(0, "127.0.0.1", () => resolve());
      });
      baseUrl = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;

      token = await loginForRouteTest(baseUrl, EMAIL, PASSWORD);
    });

    after(async () => {
      await new Promise<void>((resolve, reject) => {
        if (!server) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await purge();
    });

    /** The fields the tab and the editor read, as they arrive on the wire. */
    interface ValuePackageShape {
      id: string;
      status: string;
      price: string;
      credit: string;
      validityDays: number | null;
      serviceCount: number;
      services: { id: string; name: string }[];
    }

    it("refuses reads and writes until the packages add-on is bought", async () => {
      await setEntitlement("packages", false);

      const list = await request("GET", "/api/value-packages", token);
      assert.equal(list.status, 403);
      const listBody = await envelope(list);
      assert.equal(listBody.code, "MODULE_NOT_ENTITLED");
      assert.deepEqual(listBody.details, { module: "packages" }, "the body names the add-on");

      // The write is gated too: a module check that only guarded `GET` would leave a
      // salon able to create rows it cannot read.
      const create = await request("POST", "/api/value-packages", token, {
        name: "Blocked",
        price: 10,
        credit: 12,
      });
      assert.equal(create.status, 403);
      assert.equal((await envelope(create)).code, "MODULE_NOT_ENTITLED");
    });

    it("serves the list once the add-on is granted", async () => {
      await setEntitlement("packages", true);

      const response = await request("GET", "/api/value-packages", token);
      assert.equal(response.status, 200);

      const page = await dataOf<{ total: number }>(response);
      assert.equal(page.total, 0);
    });

    it("creates prepaid credit and links the services it is designed for", async () => {
      const created = await request("POST", "/api/value-packages", token, {
        name: "$600 credit for $545",
        price: 545,
        credit: 600,
        validityDays: 365,
        description: "Spend like cash on any service",
        serviceIds: [SERVICES.a],
      });

      assert.equal(created.status, 201);
      const valuePackage = await dataOf<ValuePackageShape>(created);
      createdId = valuePackage.id;

      // A `Decimal(12,2)` must reach the browser as a string, or a cent is lost to a
      // float somewhere between here and the till.
      assert.equal(valuePackage.price, "545.00");
      assert.equal(valuePackage.credit, "600.00");
      assert.equal(valuePackage.status, "ACTIVE");
      assert.equal(valuePackage.validityDays, 365);
      assert.equal(valuePackage.serviceCount, 1);
      assert.deepEqual(valuePackage.services, [{ id: SERVICES.a, name: "Balayage" }]);

      const read = await request("GET", `/api/value-packages/${valuePackage.id}`, token);
      assert.equal(read.status, 200);
      assert.equal((await dataOf<ValuePackageShape>(read)).credit, "600.00");
    });

    it("refuses credit of zero, which is a price with no promise", async () => {
      const response = await request("POST", "/api/value-packages", token, {
        name: "Nothings",
        price: 100,
        credit: 0,
      });

      assert.equal(response.status, 422);
      const body = await envelope(response);
      assert.equal(body.code, "VALIDATION_FAILED");
      assert.ok(
        detailPaths(body).includes("body.credit"),
        `expected a detail for body.credit, got ${JSON.stringify(body.details)}`,
      );
    });

    it("refuses a service id that belongs to another salon", async () => {
      const response = await request("POST", "/api/value-packages", token, {
        name: "Cross-tenant",
        price: 100,
        credit: 120,
        serviceIds: [SERVICES.a, SERVICES.b],
      });

      assert.equal(response.status, 422);
      const body = await envelope(response);
      // The path is the contract: the drawer puts this message on the picker rather
      // than in a banner (`fieldError("serviceIds")`).
      assert.deepEqual(detailPaths(body), ["body.serviceIds"]);
    });

    it("updates price, credit and status, and re-links services", async () => {
      const response = await request("PATCH", `/api/value-packages/${createdId}`, token, {
        price: 500,
        status: "INACTIVE",
        serviceIds: [],
      });

      assert.equal(response.status, 200);
      const valuePackage = await dataOf<ValuePackageShape>(response);
      assert.equal(valuePackage.price, "500.00");
      // Absent means unchanged, which is why the credit is still the created value.
      assert.equal(valuePackage.credit, "600.00");
      assert.equal(valuePackage.status, "INACTIVE");
      // An explicit `[]` is "designed for nothing in particular", which is a real
      // answer rather than an absent key.
      assert.equal(valuePackage.serviceCount, 0);
      assert.deepEqual(valuePackage.services, []);
    });

    it("filters by status, which the tab's toolbar can ask for", async () => {
      const inactive = await request("GET", "/api/value-packages?status=INACTIVE", token);
      assert.equal((await dataOf<{ total: number }>(inactive)).total, 1);

      const active = await request("GET", "/api/value-packages?status=ACTIVE", token);
      assert.equal((await dataOf<{ total: number }>(active)).total, 0);
    });

    it("answers 404 VALUE_PACKAGE_NOT_FOUND for an id it does not have", async () => {
      const response = await request("PATCH", "/api/value-packages/does-not-exist", token, {
        price: 1,
      });

      assert.equal(response.status, 404);
      assert.equal((await envelope(response)).code, "VALUE_PACKAGE_NOT_FOUND");
    });

    it("has no DELETE: retiring a package must not erase its purchase history", async () => {
      const response = await request("DELETE", `/api/value-packages/${createdId}`, token);

      assert.equal(response.status, 404, "the route must not exist");

      // And the row is still there, so a `status` change is the only way out.
      const read = await request("GET", `/api/value-packages/${createdId}`, token);
      assert.equal(read.status, 200);
    });
  },
);
