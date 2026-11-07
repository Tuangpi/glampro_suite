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
    await prisma.auditLog.deleteMany({
      where: { tenantId: { in: TENANT_IDS }, action: "department.delete" },
    });
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

    it("creates and renames departments with tenant isolation and useful validation", async () => {
      const write = (path: string, method: string, body: unknown, accessToken = token) =>
        fetch(`${baseUrl}${path}`, {
          method,
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const created = await write("/api/departments", "POST", { name: "  Beauty  " });
      assert.equal(created.status, 201);
      const { data } = (await created.json()) as { data: DepartmentRow };
      assert.equal(data.name, "Beauty");
      const foreign = await write(
        `/api/departments/${data.id}`,
        "PATCH",
        { name: "Stolen" },
        otherToken,
      );
      assert.equal(foreign.status, 404);
      const renamed = await write(`/api/departments/${data.id}`, "PATCH", { name: "Skin" });
      assert.equal(renamed.status, 200);
      assert.equal(((await renamed.json()) as { data: DepartmentRow }).data.name, "Skin");
      for (const method of ["POST", "PATCH"]) {
        const path = method === "POST" ? "/api/departments" : `/api/departments/${data.id}`;
        assert.equal((await write(path, method, { name: "Hair" })).status, 409);
        for (const body of [
          { name: " " },
          { name: "a".repeat(101) },
          { name: "Hair", tenantId: TENANT_B },
        ]) {
          assert.equal((await write(path, method, body)).status, 422);
        }
      }
      assert.equal(
        (await write("/api/departments/missing", "PATCH", { name: "Missing" })).status,
        404,
      );
      await runAsPlatform(() => prisma.department.delete({ where: { id: data.id } }));
    });

    it("permits manager writes, refuses staff/cashier writes and preserves picker reads", async () => {
      const passwordHash = await hashPassword(PASSWORD);
      for (const globalRole of ["MANAGER", "STAFF", "CASHIER"] as const) {
        const email = `${globalRole.toLowerCase()}@${DOMAIN}`;
        await runAsPlatform(() =>
          prisma.user.create({
            data: {
              tenantId: TENANT_A,
              email,
              name: globalRole,
              passwordHash,
              globalRole,
            },
          }),
        );
        const accessToken = await signIn(email);
        assert.equal((await request("/api/departments", accessToken)).status, 200);
        assert.equal(
          (await request("/api/departments/missing/deletion-impact", accessToken)).status,
          globalRole === "MANAGER" ? 404 : 403,
        );
        for (const method of ["POST", "PATCH", "DELETE"]) {
          const path = method === "POST" ? "/api/departments" : "/api/departments/missing";
          const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
            body: JSON.stringify({ name: "Manager department" }),
          });
          assert.equal(
            response.status,
            globalRole === "MANAGER" ? (method === "POST" ? 201 : 404) : 403,
          );
          if (response.status === 201) {
            const { data } = (await response.json()) as { data: DepartmentRow };
            await runAsPlatform(() => prisma.department.delete({ where: { id: data.id } }));
          }
        }
      }
    });

    it("requires authentication and refuses department writes for suspended salons", async () => {
      for (const method of ["POST", "PATCH", "DELETE"]) {
        const path = method === "POST" ? "/api/departments" : "/api/departments/missing";
        assert.equal((await fetch(`${baseUrl}${path}`, { method })).status, 401);
      }
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: TENANT_A }, data: { status: "SUSPENDED" } }),
      );
      try {
        assert.equal((await request("/api/departments", token)).status, 200);
        for (const method of ["POST", "PATCH", "DELETE"]) {
          const path = method === "POST" ? "/api/departments" : "/api/departments/missing";
          const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ name: "Blocked" }),
          });
          assert.equal(response.status, 403);
          assert.equal(((await response.json()) as { code: string }).code, "TENANT_SUSPENDED");
        }
      } finally {
        await runAsPlatform(() =>
          prisma.tenant.update({ where: { id: TENANT_A }, data: { status: "ACTIVE" } }),
        );
      }
    });

    it("deletes and unassigns related records while preserving other assignments and auditing impact", async () => {
      const fixture = await runAsPlatform(async () => {
        const department = await prisma.department.create({
          data: { tenantId: TENANT_A, name: "Delete section" },
        });
        const other = await prisma.department.findFirstOrThrow({
          where: { tenantId: TENANT_A, name: "Hair" },
        });
        const staff = await prisma.user.findFirstOrThrow({
          where: { tenantId: TENANT_A, email: EMAIL },
        });
        const customer = await prisma.customer.create({
          data: { tenantId: TENANT_A, name: "Delete test customer", phone: "12345678" },
        });
        for (const departmentId of [department.id, other.id]) {
          await prisma.staffDepartment.create({
            data: { tenantId: TENANT_A, departmentId, userId: staff.id },
          });
          await prisma.customerDepartment.create({
            data: { tenantId: TENANT_A, departmentId, customerId: customer.id },
          });
        }
        const product = await prisma.product.create({
          data: {
            tenantId: TENANT_A,
            departmentId: department.id,
            name: "Delete test product",
            memberPrice: "1",
            nonmemberPrice: "2",
          },
        });
        const service = await prisma.service.create({
          data: {
            tenantId: TENANT_A,
            departmentId: department.id,
            name: "Delete test service",
            memberPrice: "1",
            nonmemberPrice: "2",
          },
        });
        return { department, other, staff, customer, product, service };
      });
      const path = `/api/departments/${fixture.department.id}`;
      try {
        const preview = await request(`${path}/deletion-impact`, token);
        assert.equal(preview.status, 200);
        assert.deepEqual(((await preview.json()) as { data: unknown }).data, {
          id: fixture.department.id,
          name: "Delete section",
          products: 1,
          services: 1,
          staff: 1,
          customers: 1,
          commissionRules: 0,
        });
        assert.equal((await request(`${path}/deletion-impact`, otherToken)).status, 404);
        assert.equal(
          (
            await fetch(`${baseUrl}${path}`, {
              method: "DELETE",
              headers: { authorization: `Bearer ${otherToken}` },
            })
          ).status,
          404,
        );
        const deleted = await fetch(`${baseUrl}${path}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(deleted.status, 200);
        await runAsPlatform(async () => {
          assert.equal(
            await prisma.department.findUnique({ where: { id: fixture.department.id } }),
            null,
          );
          assert.equal(
            (await prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } }))
              .departmentId,
            null,
          );
          assert.equal(
            (await prisma.service.findUniqueOrThrow({ where: { id: fixture.service.id } }))
              .departmentId,
            null,
          );
          assert.ok(await prisma.user.findUnique({ where: { id: fixture.staff.id } }));
          assert.ok(await prisma.customer.findUnique({ where: { id: fixture.customer.id } }));
          assert.equal(
            await prisma.staffDepartment.count({
              where: { userId: fixture.staff.id, departmentId: fixture.department.id },
            }),
            0,
          );
          assert.equal(
            await prisma.customerDepartment.count({
              where: { customerId: fixture.customer.id, departmentId: fixture.department.id },
            }),
            0,
          );
          assert.equal(
            await prisma.staffDepartment.count({
              where: { userId: fixture.staff.id, departmentId: fixture.other.id },
            }),
            1,
          );
          assert.equal(
            await prisma.customerDepartment.count({
              where: { customerId: fixture.customer.id, departmentId: fixture.other.id },
            }),
            1,
          );
          const audit = await prisma.auditLog.findFirstOrThrow({
            where: {
              tenantId: TENANT_A,
              targetId: fixture.department.id,
              action: "department.delete",
            },
          });
          assert.equal((audit.metadata as { actorId: string }).actorId, fixture.staff.id);
          assert.equal((audit.metadata as { products: number }).products, 1);
        });
        assert.equal(
          (
            await fetch(`${baseUrl}${path}`, {
              method: "DELETE",
              headers: { authorization: `Bearer ${token}` },
            })
          ).status,
          404,
        );
      } finally {
        await runAsPlatform(async () => {
          await prisma.product.delete({ where: { id: fixture.product.id } });
          await prisma.service.delete({ where: { id: fixture.service.id } });
          await prisma.customer.delete({ where: { id: fixture.customer.id } });
          await prisma.staffDepartment.deleteMany({ where: { userId: fixture.staff.id } });
          await prisma.department.deleteMany({ where: { id: fixture.department.id } });
        });
      }
    });

    it("rechecks commission references at deletion and preserves even historical null-rate rules", async () => {
      const tenantId = "department-delete-rules-rt";
      const email = `delete-rules@${DOMAIN}`;
      const passwordHash = await hashPassword(PASSWORD);
      await runAsPlatform(async () => {
        await prisma.tenant.create({
          data: { id: tenantId, slug: tenantId, name: "Deletion rules fixture" },
        });
        await prisma.user.create({
          data: {
            tenantId,
            email,
            name: "Deletion owner",
            passwordHash,
            globalRole: "SUPER_ADMIN",
          },
        });
      });
      const accessToken = await signIn(email);
      const department = await runAsPlatform(() =>
        prisma.department.create({ data: { tenantId, name: "Protected section" } }),
      );
      try {
        const preview = await request(
          `/api/departments/${department.id}/deletion-impact`,
          accessToken,
        );
        assert.equal(
          ((await preview.json()) as { data: { commissionRules: number } }).data.commissionRules,
          0,
        );
        await runAsPlatform(() =>
          prisma.commissionRule.create({
            data: {
              staffId: "department-delete-test-staff",
              tenantId,
              scope: "DEPARTMENT",
              targetId: department.id,
              scopeKey: "department-delete-test",
              itemKind: "SERVICE",
              rate: null,
              actorId: "test",
              reason: "Historical rule",
              effectiveAt: new Date("2020-01-01"),
            },
          }),
        );
        const blocked = await fetch(`${baseUrl}/api/departments/${department.id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${accessToken}` },
        });
        assert.equal(blocked.status, 409);
        assert.equal(
          ((await blocked.json()) as { code: string }).code,
          "DEPARTMENT_HAS_COMMISSION_RULES",
        );
        await runAsPlatform(async () => {
          assert.ok(await prisma.department.findUnique({ where: { id: department.id } }));
          assert.equal(
            await prisma.commissionRule.count({ where: { targetId: department.id } }),
            1,
          );
          assert.equal(
            await prisma.auditLog.count({
              where: { targetId: department.id, action: "department.delete" },
            }),
            0,
          );
        });
      } finally {
        await runAsPlatform(async () => {
          // Rules are append-only: clean up only through the fixture tenant cascade.
          await prisma.tenant.delete({ where: { id: tenantId } });
        });
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
