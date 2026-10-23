import { loginForRouteTest } from "../test-support/route-login.js";
// Static, so the `DATABASE_URL` gate below reads `.env` instead of skipping silently
// (the reason the suite used to vanish from `npm run verify` — see `auth.routes.test.ts`).
import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

/**
 * Integration tests for the catalogue reads behind screen 08 — `/api/products`,
 * `/api/services` and the `/api/departments` picker.
 *
 * These three mounts had **no HTTP-level test**: the API's suites covered auth,
 * staff, packages and sales, and the web suites mock the query hooks, so nothing
 * pinned what a list route actually puts on the wire. That gap is why a list could
 * be wrapped twice with every suite green and every browser screen empty — so the
 * assertion that matters most here is the **envelope**: exactly one wrap, around a
 * page carrying its own `total`, `page`, `pageSize` and `pageCount`.
 *
 * The filters (`?status=`, `?search=`, `?departmentId=`, `?lowStock=`) and tenant
 * isolation are pinned next to it, because the right envelope around the wrong rows
 * is not a working route. `/api/departments` is deliberately different and is
 * asserted to be: the picker is a bare array, because a salon has few branches and
 * nothing pages them.
 *
 * The catalogue is a **core** module, so a salon that has bought nothing must still
 * read it — the opposite of the `MODULE_NOT_ENTITLED` case `packages.routes.test.ts`
 * covers for a genuine add-on. Both are asserted, against the same guard.
 *
 * Gated on `DATABASE_URL`, like the other integration suites: it creates two salons,
 * signs in for real, and removes everything it made.
 */
const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "catalogue-reads-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");
const { hashPassword } = await import("../lib/password.js");
const { CORE_MODULE_CODES, DEFAULT_PAGE_SIZE, MODULE_CODES } =
  await import("@glampro_suite/shared");

const PASSWORD = "correct-horse-1";
const DOMAIN = "catalogue-reads-rt.test";

const TENANT_A = "catalogue-reads-a";
const TENANT_B = "catalogue-reads-b";
const TENANT_IDS = [TENANT_A, TENANT_B];

const EMAIL = `owner@${DOMAIN}`;
const OTHER_EMAIL = `other@${DOMAIN}`;

/** The page as `paginated()` builds it, nested in the route's `ApiResponse`. */
interface PageEnvelope<T> {
  data: {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
}

interface ProductRow {
  id: string;
  name: string;
  status: string;
  memberPrice: string;
  nonmemberPrice: string;
  quantity: number;
  lowStock: boolean;
  departmentId: string | null;
  departmentName: string | null;
}

interface ServiceRow {
  id: string;
  name: string;
  status: string;
  durationMinutes: number;
}

interface DepartmentRow {
  id: string;
  name: string;
}

/** Removes everything this file created, so runs are repeatable. */
async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.product.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.department.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.tenantModule.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
  });
}

/**
 * Two salons, an owner in each, and a catalogue whose rows each answer a different
 * question — one active, one inactive, one short of stock, one with a branch, one
 * with a searchable description — plus a row in B that A must never see.
 *
 * The module catalogue is upserted the way the real seed does it — `isCore` derived
 * from the shared constant and the same list the guard reads — so a missing
 * `catalogue` row cannot make this suite pass for the wrong reason
 * (`MODULE_UNKNOWN`).
 */
async function seed(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);

  await runAsPlatform(async () => {
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

    await prisma.tenant.create({
      data: { id: TENANT_A, name: "Catalogue Reads A", slug: TENANT_A },
    });
    await prisma.tenant.create({
      data: { id: TENANT_B, name: "Catalogue Reads B", slug: TENANT_B },
    });

    for (const [tenantId, email, name] of [
      [TENANT_A, EMAIL, "Ola Owner"],
      [TENANT_B, OTHER_EMAIL, "Odo Owner"],
    ] as const) {
      await prisma.user.create({
        data: { tenantId, email, name, passwordHash, globalRole: "SUPER_ADMIN" },
      });
    }

    const hair = await prisma.department.create({ data: { tenantId: TENANT_A, name: "Hair" } });
    await prisma.department.create({ data: { tenantId: TENANT_A, name: "Nails" } });
    await prisma.department.create({ data: { tenantId: TENANT_B, name: "Foreign Hair" } });

    await prisma.product.create({
      data: {
        tenantId: TENANT_A,
        name: "Argan Oil",
        description: "Cold pressed, unrefined",
        status: "ACTIVE",
        memberPrice: "45.00",
        nonmemberPrice: "52.00",
        points: 3,
        quantity: 5,
        departmentId: hair.id,
      },
    });
    await prisma.product.create({
      data: {
        tenantId: TENANT_A,
        name: "Shampoo",
        status: "ACTIVE",
        memberPrice: "12.50",
        nonmemberPrice: "15.00",
        quantity: 60,
      },
    });
    await prisma.product.create({
      data: {
        tenantId: TENANT_A,
        name: "Retired Gel",
        status: "INACTIVE",
        memberPrice: "9.00",
        nonmemberPrice: "11.00",
        quantity: 3,
      },
    });
    await prisma.product.create({
      data: {
        tenantId: TENANT_B,
        name: "Foreign Shampoo",
        status: "ACTIVE",
        memberPrice: "1.00",
        nonmemberPrice: "2.00",
        quantity: 1,
      },
    });

    await prisma.service.create({
      data: {
        tenantId: TENANT_A,
        name: "Argan Treatment",
        status: "ACTIVE",
        memberPrice: "45.00",
        nonmemberPrice: "52.00",
        points: 3,
        durationMinutes: 75,
        departmentId: hair.id,
      },
    });
    await prisma.service.create({
      data: {
        tenantId: TENANT_A,
        name: "Blow Dry",
        status: "INACTIVE",
        memberPrice: "20.00",
        nonmemberPrice: "25.00",
        durationMinutes: 30,
      },
    });
    await prisma.service.create({
      data: {
        tenantId: TENANT_B,
        name: "Foreign Cut",
        status: "ACTIVE",
        memberPrice: "10.00",
        nonmemberPrice: "12.00",
        durationMinutes: 20,
      },
    });
  });
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** The row names on a page, in the order the server sent them. */
function namesOf(body: PageEnvelope<{ name: string }>): string[] {
  return body.data.data.map((row) => row.name);
}

let baseUrl = "";
let server: Server | undefined;

async function request(path: string, accessToken?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

async function signIn(email: string): Promise<string> {
  return loginForRouteTest(baseUrl, email, PASSWORD);
}

describe(
  "catalogue read endpoints",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    let token = "";
    let otherToken = "";

    before(async () => {
      await purge();
      await seed();

      await new Promise<void>((resolve) => {
        server = createApp().listen(0, "127.0.0.1", () => resolve());
      });
      baseUrl = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;

      token = await signIn(EMAIL);
      otherToken = await signIn(OTHER_EMAIL);
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

    it("mounts every screen-08 read behind auth", async () => {
      // A 401 rather than a 404 is what proves the mount exists at all.
      for (const path of ["/api/products", "/api/services", "/api/departments"]) {
        const response = await request(path);
        assert.equal(response.status, 401, `${path} must require a token`);
      }
    });

    it("wraps the page exactly once, and the page carries its own paging", async () => {
      const response = await request("/api/products", token);
      assert.equal(response.status, 200);

      const body = await bodyOf<PageEnvelope<ProductRow>>(response);

      // One wrap. A second one, or a flat body, is a body the browser reads as an
      // empty list — which is the whole reason this suite exists.
      assert.deepEqual(Object.keys(body), ["data"], "the body is the envelope and nothing else");
      assert.ok(
        Array.isArray(body.data.data),
        "`data.data` must be the row array, not another envelope",
      );
      assert.equal(body.data.total, 3);
      assert.equal(body.data.page, 1);
      assert.equal(body.data.pageSize, DEFAULT_PAGE_SIZE, "the query's default page size");
      assert.equal(body.data.pageCount, 1);
      assert.deepEqual(namesOf(body), ["Argan Oil", "Retired Gel", "Shampoo"], "ordered by name");

      // A row carries what the table draws — and prices as strings, because a
      // Decimal that became a float has already lost a cent.
      const [first] = body.data.data;
      assert.ok(first, "expected a first row");
      assert.equal(typeof first.memberPrice, "string");
      assert.equal(first.memberPrice, "45.00");
      assert.equal(first.departmentName, "Hair");
      assert.equal(first.quantity, 5);
      assert.equal("cost" in first, false, "the model has no cost column");
    });

    it("counts the salon, not the page", async () => {
      // `total` is the server's count over every matching row: the stat tiles and the
      // rail badge are queries of their own, and a single page cannot compute them.
      const response = await request("/api/products?pageSize=1&page=2", token);
      const body = await bodyOf<PageEnvelope<ProductRow>>(response);

      assert.equal(body.data.data.length, 1, "one row on this page");
      assert.equal(body.data.total, 3, "…but the total is the whole catalogue");
      assert.equal(body.data.pageCount, 3);
      assert.equal(body.data.page, 2);
      assert.deepEqual(namesOf(body), ["Retired Gel"], "paging is the server's, not the browser's");
    });

    it("filters server-side: status, search and branch", async () => {
      const active = await bodyOf<PageEnvelope<ProductRow>>(
        await request("/api/products?status=ACTIVE", token),
      );
      assert.deepEqual(namesOf(active), ["Argan Oil", "Shampoo"]);

      const inactive = await bodyOf<PageEnvelope<ProductRow>>(
        await request("/api/products?status=INACTIVE", token),
      );
      assert.deepEqual(namesOf(inactive), ["Retired Gel"]);

      // Case-insensitively, and over the description as well as the name — one box,
      // two fields, which is the search the table draws.
      const byName = await bodyOf<PageEnvelope<ProductRow>>(
        await request("/api/products?search=ARGAN", token),
      );
      assert.deepEqual(namesOf(byName), ["Argan Oil"]);

      const byDescription = await bodyOf<PageEnvelope<ProductRow>>(
        await request("/api/products?search=pressed", token),
      );
      assert.deepEqual(namesOf(byDescription), ["Argan Oil"]);

      const branches = await bodyOf<{ data: DepartmentRow[] }>(
        await request("/api/departments", token),
      );
      const hair = branches.data.find((row) => row.name === "Hair");
      assert.ok(hair, "the seeded branch must be in the picker");

      const inHair = await bodyOf<PageEnvelope<ProductRow>>(
        await request(`/api/products?departmentId=${hair.id}`, token),
      );
      assert.deepEqual(namesOf(inHair), ["Argan Oil"]);
    });

    it("takes the low-stock threshold from the request, and flags the rows it sends", async () => {
      // `?lowStock=true` is the rail badge's question. It is a **server-side** filter
      // against the tenant's own threshold, so the request's `threshold` is what has
      // to answer it: a bucket of three and a bucket of four are one query asked
      // differently, and only the server can count either.
      const upToFour = await bodyOf<PageEnvelope<ProductRow>>(
        await request("/api/products?lowStock=true&threshold=4", token),
      );
      assert.deepEqual(namesOf(upToFour), ["Retired Gel"]);

      const upToFive = await bodyOf<PageEnvelope<ProductRow>>(
        await request("/api/products?lowStock=true&threshold=5", token),
      );
      assert.deepEqual(namesOf(upToFive), ["Argan Oil", "Retired Gel"]);
      assert.ok(
        upToFive.data.data.every((row) => row.lowStock),
        "every row the filter returns is flagged low",
      );
    });

    it("serves services with a duration and no stock at all", async () => {
      const response = await request("/api/services", token);
      const body = await bodyOf<PageEnvelope<ServiceRow>>(response);

      assert.equal(response.status, 200);
      assert.deepEqual(namesOf(body), ["Argan Treatment", "Blow Dry"]);

      const [first] = body.data.data;
      assert.ok(first, "expected a first service");
      assert.equal(first.durationMinutes, 75);
      assert.equal("quantity" in first, false, "a service is not stock");

      // The tab and the table share one query string, so `?lowStock` reaches this
      // route too — and is ignored rather than refused.
      const stockFiltered = await bodyOf<PageEnvelope<ServiceRow>>(
        await request("/api/services?lowStock=true&threshold=0", token),
      );
      assert.equal(stockFiltered.data.total, 2);
    });

    it("answers the branch picker with a bare array, because nothing pages it", async () => {
      const response = await request("/api/departments", token);
      const body = await bodyOf<{ data: DepartmentRow[] }>(response);

      assert.equal(response.status, 200);
      assert.ok(Array.isArray(body.data), "the picker is a list, not a page");
      assert.deepEqual(
        body.data.map((row) => row.name),
        ["Hair", "Nails"],
      );

      const [first] = body.data;
      assert.ok(first, "expected a first branch");
      assert.deepEqual(Object.keys(first), ["id", "name"], "the picker takes two fields");
    });

    it("never returns another salon's rows, in any of the three", async () => {
      const products = await bodyOf<PageEnvelope<ProductRow>>(
        await request("/api/products", otherToken),
      );
      assert.deepEqual(namesOf(products), ["Foreign Shampoo"]);
      assert.equal(products.data.total, 1, "the total is scoped too, or the tiles would leak");

      const services = await bodyOf<PageEnvelope<ServiceRow>>(
        await request("/api/services", otherToken),
      );
      assert.deepEqual(namesOf(services), ["Foreign Cut"]);

      const branches = await bodyOf<{ data: DepartmentRow[] }>(
        await request("/api/departments", otherToken),
      );
      assert.deepEqual(
        branches.data.map((row) => row.name),
        ["Foreign Hair"],
      );
    });

    it("lets a salon that has bought nothing read the catalogue, because it is core", async () => {
      // The other side of the entitlement branch: `packages.routes.test.ts` pins the
      // 403 for an add-on, and this pins that core is not refused the same way. A
      // guard that refused everything would pass that suite and fail this one.
      const entitlements = await runAsPlatform(() =>
        prisma.tenantModule.count({ where: { tenantId: { in: TENANT_IDS } } }),
      );
      assert.equal(entitlements, 0, "the fixture salons have bought no add-ons at all");

      for (const path of ["/api/products", "/api/services", "/api/departments"]) {
        const response = await request(path, token);
        assert.equal(response.status, 200, `${path} must not gate a core module`);
      }
    });
  },
);
