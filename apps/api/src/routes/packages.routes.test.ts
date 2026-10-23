import { loginForRouteTest } from "../test-support/route-login.js";
// Static, so the `DATABASE_URL` gate below reads `.env` instead of skipping silently
// (the reason the suite used to vanish from `npm run verify` — see `auth.routes.test.ts`).
import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

/**
 * Integration tests for the packages and gift-cards mounts — screen 08's last two
 * tabs.
 *
 * The assertion that matters most here is the **add-on branch of `requireModule`**,
 * which nothing has exercised until now: `catalogue`, `customers`, `staff` and
 * `sales` are all core, so `requireModule` has only ever returned "pass". `packages`
 * and `giftCards` are add-ons, so a salon without an entitlement must be refused with
 * `403 MODULE_NOT_ENTITLED` **even though it is signed in and the rows are its own** —
 * and the same request must succeed once the `TenantModule` row exists. A test that
 * only checked the happy path would pass with the guard removed entirely.
 *
 * Both mounts are covered by one file because they are the same middleware path
 * differing only in model: the gate is tested in depth against `/api/packages`, and
 * `/api/gift-cards` is asserted to be mounted and gated identically.
 *
 * Gated on `DATABASE_URL`, like `staff.routes.test.ts`: the suite creates two salons,
 * signs in for real, and removes everything it made.
 */
const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "catalogue-tabs-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");
const { hashPassword } = await import("../lib/password.js");
const { CORE_MODULE_CODES, MODULE_CODES } = await import("@glampro_suite/shared");

const PASSWORD = "correct-horse-1";
const DOMAIN = "catalogue-tabs-rt.test";

const TENANTS = { a: "catalogue-tabs-a", b: "catalogue-tabs-b" } as const;
const TENANT_IDS = Object.values(TENANTS);

const EMAIL = `owner@${DOMAIN}`;

/** Removes everything this file created, so runs are repeatable. */
async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.packageService.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.package.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.giftCard.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.tenantModule.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
  });
}

/** Two salons, one owner and one card in A. A is granted nothing to begin with. */
async function seed(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);

  await runAsPlatform(async () => {
    await prisma.tenant.create({
      data: { id: TENANTS.a, name: "Catalogue Tabs A", slug: "catalogue-tabs-a" },
    });
    await prisma.tenant.create({
      data: { id: TENANTS.b, name: "Catalogue Tabs B", slug: "catalogue-tabs-b" },
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

    await prisma.giftCard.create({
      data: { tenantId: TENANTS.a, name: "Aloha Card", value: "100.00" },
    });

    // `requireModule` refuses an **unknown** module loudly (403 `MODULE_UNKNOWN`),
    // which is a different refusal from "your salon has not bought this". Without
    // this the not-entitled assertion below would pass for the wrong reason, so the
    // catalogue is seeded here the way `staff.routes.test.ts` and the real seed do it
    // — `isCore` derived from the shared constant, so the two cannot disagree.
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

/**
 * Grants or revokes an add-on for tenant A.
 *
 * `Module` rows are platform data seeded once, so this reads the row rather than
 * creating one: if the module catalogue is not seeded the test says so instead of
 * failing on a foreign key.
 */
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
  details?: { module?: string };
}

async function envelope(response: Response): Promise<Envelope> {
  return (await response.json()) as Envelope;
}

async function dataOf<T>(response: Response): Promise<T> {
  const body = await envelope(response);
  assert.ok(body.data !== undefined, `expected a data envelope, got ${JSON.stringify(body)}`);
  return body.data as T;
}

let baseUrl = "";
let server: Server | undefined;

async function request(
  method: "GET" | "POST" | "PATCH",
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
  "packages and gift-cards endpoints",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    let token = "";

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

    it("mounts both tabs behind auth", async () => {
      // A 401 rather than a 404 is what proves the mount exists at all.
      for (const path of ["/api/packages", "/api/gift-cards"]) {
        const response = await request("GET", path);
        assert.equal(response.status, 401, `${path} must require a token`);
      }
    });

    it("refuses a signed-in salon that has not bought the add-on", async () => {
      // The rows are this salon's own and the caller is its owner; the refusal is
      // about entitlement, not about identity or tenancy. This is the first route in
      // the app where that is the reason for a 403.
      for (const [path, module] of [
        ["/api/packages", "packages"],
        ["/api/gift-cards", "giftCards"],
      ] as const) {
        const response = await request("GET", path, token);
        const body = await envelope(response);

        assert.equal(response.status, 403, `${path} must be refused`);
        assert.equal(body.code, "MODULE_NOT_ENTITLED");
        assert.equal(body.details?.module, module, "the body names the add-on to buy");
      }
    });

    it("refuses the writes too, not only the reads", async () => {
      const response = await request("POST", "/api/packages", token, {
        name: "Sneaky Bundle",
        sessionCount: 1,
        memberPrice: 10,
        nonmemberPrice: 12,
      });

      assert.equal(response.status, 403);
      assert.equal((await envelope(response)).code, "MODULE_NOT_ENTITLED");
    });

    it("serves the list once the add-on is granted, and does not open the other tab", async () => {
      await setEntitlement("packages", true);

      const packages = await request("GET", "/api/packages", token);
      assert.equal(packages.status, 200);
      assert.equal((await dataOf<{ total: number }>(packages)).total, 0);

      // One entitlement is not the other: `giftCards` is a separate purchase.
      const giftCards = await request("GET", "/api/gift-cards", token);
      assert.equal(giftCards.status, 403);
    });

    it("creates a bundle and reads it back", async () => {
      const created = await request("POST", "/api/packages", token, {
        name: "Aloha Bundle",
        sessionCount: 10,
        memberPrice: 250,
        nonmemberPrice: 300,
        description: "Ten sessions of anything",
      });

      assert.equal(created.status, 201);
      const bundle = await dataOf<{ id: string; memberPrice: string; serviceCount: number }>(
        created,
      );
      assert.equal(bundle.memberPrice, "250.00");
      assert.equal(bundle.serviceCount, 0);

      const read = await request("GET", `/api/packages/${bundle.id}`, token);
      assert.equal(read.status, 200);

      const list = await request("GET", "/api/packages", token);
      assert.equal((await dataOf<{ total: number }>(list)).total, 1);
    });

    it("names the field a rejected body got wrong", async () => {
      const response = await request("POST", "/api/packages", token, {
        name: "No Price Bundle",
        sessionCount: 3,
      });

      assert.equal(response.status, 422);
      const body = await envelope(response);
      assert.equal(body.code, "VALIDATION_FAILED");
      // The browser puts a 422's `path` on the control that caused it, so the path
      // is part of the contract rather than an implementation detail.
      assert.ok(
        (body.details as unknown as { path: string }[]).some(
          (detail) => detail.path === "body.memberPrice",
        ),
        `expected a detail for body.memberPrice, got ${JSON.stringify(body.details)}`,
      );
    });

    it("lists gift cards with no status key at all once that add-on is granted", async () => {
      await setEntitlement("giftCards", true);

      const response = await request("GET", "/api/gift-cards", token);
      assert.equal(response.status, 200);

      const page = await dataOf<{ total: number; data: Record<string, unknown>[] }>(response);
      assert.equal(page.total, 1);
      const card = page.data[0];
      assert.ok(card, "the seeded card must be listed");
      assert.equal(card["value"], "100.00");
      assert.equal(card["expiresAt"], null, "no expiry is never-expiring, not today");
      // Screen 08 draws a Status cell in this tab's table; the model has no column
      // behind it, so the field must be absent rather than invented.
      assert.equal("status" in card, false);
    });
  },
);
