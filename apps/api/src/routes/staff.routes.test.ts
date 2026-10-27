// Static, so the `DATABASE_URL` gate below reads `.env` instead of skipping silently
// (the reason the suite used to vanish from `npm run verify` — see `auth.routes.test.ts`).
import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { CORE_MODULE_CODES, MODULE_CODES, type StaffSummary } from "@glampro_suite/shared";

/**
 * Integration tests for the staff endpoints — handoff screen 09.
 *
 * One assertion here matters more than the rest: **`requireRole` has a caller.**
 * Q26 recorded that the middleware was implemented and unit-tested but mounted on
 * nothing, so "admin-only writes are gated in the API, not only in the UI" was a
 * claim no test could fail. Below, a `STAFF` token that POSTs must be refused and a
 * `MANAGER` token that POSTs must succeed — and the row must land in the caller's own
 * salon, which is the tenant-isolation half of the same story.
 *
 * Gated on `DATABASE_URL`, like `auth.routes.test.ts`: the suite creates two tenants,
 * signs in for real, and removes everything it made.
 */
const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "staff-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
const { verifyPosPin, posStaffFromToken } = await import("../services/pos-pin.service.js");
const { verifyAccessToken } = await import("../lib/tokens.js");
const { hashPassword } = await import("../lib/password.js");

const PASSWORD = "correct-horse-1";
const DOMAIN = "staff-rt.test";

const fixtureRun = `${process.pid}-${Date.now()}`;
const TENANTS = {
  a: `staffrt-tenant-a-${fixtureRun}`,
  b: `staffrt-tenant-b-${fixtureRun}`,
} as const;
const TENANT_IDS = Object.values(TENANTS);

const HAIR = "staffrt-dept-hair";
const NAILS = "staffrt-dept-nails";

/**
 * Explicit ids, so a test can PATCH a known person without reading the list first.
 * Everyone shares `PASSWORD`, so the hash is computed once.
 */
const USERS = [
  {
    id: "staffrt-owner",
    tenantId: TENANTS.a,
    email: `owner@${DOMAIN}`,
    name: "Zoe Owner",
    globalRole: "SUPER_ADMIN" as const,
    position: "Owner",
  },
  {
    id: "staffrt-manager",
    tenantId: TENANTS.a,
    email: `manager@${DOMAIN}`,
    name: "Mia Manager",
    globalRole: "MANAGER" as const,
    position: "Salon manager",
  },
  {
    id: "staffrt-stylist",
    tenantId: TENANTS.a,
    email: `stylist@${DOMAIN}`,
    name: "Sam Stylist",
    globalRole: "STAFF" as const,
    position: "Senior Stylist",
  },
  {
    id: "staffrt-retired",
    tenantId: TENANTS.a,
    email: `retired@${DOMAIN}`,
    name: "Rita Retired",
    globalRole: "STAFF" as const,
    disabled: true,
  },
  {
    id: "staffrt-other",
    tenantId: TENANTS.b,
    email: `other@${DOMAIN}`,
    name: "Otto Other",
    globalRole: "MANAGER" as const,
  },
];

/** Remove operational fixtures; retain synthetic tenants with immutable payroll audit. */
async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.staffDepartment.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.department.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    for (const tenantId of TENANT_IDS) {
      if (!(await prisma.payrollConfigurationEvent.count({ where: { tenantId } })))
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
  });
}

/** Two salons, five accounts, two branches and one existing link. */
async function seed(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);

  await runAsPlatform(async () => {
    await prisma.tenant.create({ data: { id: TENANTS.a, name: "Staff RT A", slug: TENANTS.a } });
    await prisma.tenant.create({ data: { id: TENANTS.b, name: "Staff RT B", slug: TENANTS.b } });

    for (const user of USERS) {
      await prisma.user.create({ data: { ...user, passwordHash } });
    }

    // Explicit synthetic payroll setup for the profile-edit fixture, independent of login role.
    await prisma.user.update({
      where: { id: "staffrt-stylist" },
      data: { startDate: new Date("2026-01-01T00:00:00Z") },
    });
    await prisma.payrollConfigurationEvent.create({
      data: {
        tenantId: TENANTS.a,
        kind: "STAFF",
        targetId: "staffrt-stylist",
        revision: 1,
        actorId: "staffrt-owner",
        reason: "Synthetic profile-edit fixture classification",
        payload: {
          commissionRole: "NON_COMMISSION",
          joinDate: "2026-01-01",
          stageEndOverride: null,
        },
      },
    });

    await prisma.department.create({ data: { id: HAIR, tenantId: TENANTS.a, name: "Hair" } });
    await prisma.department.create({ data: { id: NAILS, tenantId: TENANTS.b, name: "Nails" } });

    // One person is already in a branch, so the update path has a link to replace.
    await prisma.staffDepartment.create({
      data: {
        id: "staffrt-link-1",
        tenantId: TENANTS.a,
        userId: "staffrt-stylist",
        departmentId: HAIR,
      },
    });

    // `requireModule("staff")` refuses an unknown module loudly, so the catalogue has
    // to exist. `isCore` comes from the shared constant, exactly as the seed does it.
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

interface Envelope {
  data?: unknown;
  statusCode?: number;
  message?: string;
  code?: string;
  details?: Array<{ path: string; message: string }>;
}

async function envelope(response: Response): Promise<Envelope> {
  return (await response.json()) as Envelope;
}

async function dataOf<T>(response: Response): Promise<T> {
  const body = await envelope(response);
  assert.ok(body.data !== undefined, `expected a data envelope, got ${JSON.stringify(body)}`);
  return body.data as T;
}

/** The fields a 409 or a 422 named, for the assertions that care where the error went. */
function fieldPaths(body: Envelope): string[] {
  return (body.details ?? []).map((detail) => detail.path);
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

/** Signs in and returns an access token for a fixture account. */
async function tokenFor(email: string, password = PASSWORD): Promise<string> {
  const response = await request("POST", "/api/auth/login", undefined, { email, password });
  assert.equal(response.status, 200, `could not sign in as ${email}`);
  return (await dataOf<{ accessToken: string }>(response)).accessToken;
}

describe("staff endpoints", { skip: databaseUrl ? false : "DATABASE_URL is not set" }, () => {
  let managerToken = "";
  let stylistToken = "";
  let otherTenantToken = "";

  before(async () => {
    await purge();
    await seed();

    await new Promise<void>((resolve) => {
      server = createApp().listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;

    managerToken = await tokenFor(`manager@${DOMAIN}`);
    stylistToken = await tokenFor(`stylist@${DOMAIN}`);
    otherTenantToken = await tokenFor(`other@${DOMAIN}`);
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
    await prisma.$disconnect();
  });

  describe("POS PIN identities", () => {
    it("creates email-free staff with hashed PIN, scoped verification and immediate reset revocation", async () => {
      const response = await request("POST", "/api/staff", managerToken, {
        name: "PIN-only colleague",
        posPin: "246810",
        commissionRate: 12.5,
      });
      assert.equal(response.status, 201);
      const staff = await dataOf<StaffSummary>(response);
      try {
        assert.equal(staff.email, null);
        assert.equal(staff.commissionRate, "12.50");
        const stored = await runAsPlatform(() =>
          prisma.user.findUniqueOrThrow({ where: { id: staff.id } }),
        );
        assert.notEqual(stored.posPinHash, "246810");
        assert.ok(stored.posPinHash?.startsWith("$2"));
        const identity = await runAsTenant(TENANTS.a, () =>
          verifyPosPin(staff.id, "246810", "staffrt-manager", "session-a"),
        );
        assert.equal(
          await runAsTenant(TENANTS.a, () =>
            posStaffFromToken(identity.token, "staffrt-manager", "session-a"),
          ),
          staff.id,
        );
        await assert.rejects(
          runAsTenant(TENANTS.a, () =>
            posStaffFromToken(identity.token, "staffrt-stylist", "session-a"),
          ),
        );
        await assert.rejects(
          runAsTenant(TENANTS.b, () =>
            posStaffFromToken(identity.token, "staffrt-manager", "session-a"),
          ),
        );
        assert.throws(() => verifyAccessToken(identity.token));
        // Creation remains unclassified; an active edit must fail until owner setup is recorded.
        assert.equal(
          (await request("PATCH", `/api/staff/${staff.id}`, managerToken, { posPin: "135790" }))
            .status,
          400,
        );
        await runAsPlatform(async () => {
          await prisma.user.update({
            where: { id: staff.id },
            data: { startDate: new Date("2026-01-01T00:00:00Z") },
          });
          await prisma.payrollConfigurationEvent.create({
            data: {
              tenantId: TENANTS.a,
              kind: "STAFF",
              targetId: staff.id,
              revision: 1,
              actorId: "staffrt-owner",
              reason: "Synthetic PIN-edit fixture classification",
              payload: {
                commissionRole: "NON_COMMISSION",
                joinDate: "2026-01-01",
                stageEndOverride: null,
              },
            },
          });
        });
        await assert.rejects(
          runAsTenant(TENANTS.a, () =>
            posStaffFromToken(identity.token, "staffrt-manager", "session-b"),
          ),
        );
        await assert.rejects(
          runAsTenant(TENANTS.a, () =>
            verifyPosPin(staff.id, "000000", "staffrt-manager", "session-a"),
          ),
        );
        assert.equal(
          (await request("PATCH", `/api/staff/${staff.id}`, managerToken, { posPin: "135790" }))
            .status,
          200,
        );
        await assert.rejects(
          runAsTenant(TENANTS.a, () =>
            posStaffFromToken(identity.token, "staffrt-manager", "session-a"),
          ),
        );
        assert.equal(
          (
            await request("PATCH", `/api/staff/${staff.id}`, managerToken, {
              globalRole: "MANAGER",
            })
          ).status,
          400,
        );
        const updated = await runAsTenant(TENANTS.a, () =>
          verifyPosPin(staff.id, "135790", "staffrt-manager", "session-a"),
        );
        await request("PATCH", `/api/staff/${staff.id}`, managerToken, { disabled: true });
        await assert.rejects(
          runAsTenant(TENANTS.a, () =>
            posStaffFromToken(updated.token, "staffrt-manager", "session-a"),
          ),
        );
      } finally {
        await runAsPlatform(() => prisma.user.delete({ where: { id: staff.id } }));
      }
    });
    it("refuses PIN setup and privileged email-free accounts from staff callers", async () => {
      assert.equal(
        (
          await request("POST", "/api/staff", stylistToken, {
            name: "Not authorized",
            posPin: "123456",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("POST", "/api/staff", managerToken, {
            name: "Not permitted",
            posPin: "123456",
            globalRole: "SUPER_ADMIN",
          })
        ).status,
        422,
      );
    });
    it("rate limits failed PIN attempts without issuing login credentials", async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await request("POST", "/api/staff/pos-pin/verify", managerToken, {
          staffId: "staffrt-stylist",
          pin: "000000",
        });
        assert.equal(response.status, 403);
      }
      assert.equal(
        (
          await request("POST", "/api/staff/pos-pin/verify", managerToken, {
            staffId: "staffrt-stylist",
            pin: "000000",
          })
        ).status,
        429,
      );
    });
  });

  describe("GET /api/staff", () => {
    it("lists the salon's team by name, with the branches each person works in", async () => {
      const response = await request("GET", "/api/staff", stylistToken);

      assert.equal(response.status, 200);
      const page = await dataOf<{
        data: StaffSummary[];
        total: number;
        pageCount: number;
      }>(response);

      assert.equal(page.total, 4);
      assert.deepEqual(
        page.data.map((row) => row.name),
        ["Mia Manager", "Rita Retired", "Sam Stylist", "Zoe Owner"],
      );
      assert.deepEqual(page.data.find((row) => row.id === "staffrt-stylist")?.departments, [
        { id: HAIR, name: "Hair" },
      ]);
    });

    it("carries no credential material at all", async () => {
      const page = await dataOf<{ data: Array<Record<string, unknown>> }>(
        await request("GET", "/api/staff", managerToken),
      );
      const row = page.data.find((entry) => entry["id"] === "staffrt-manager");

      assert.ok(row);
      for (const secret of ["passwordHash", "tokenVersion", "googleCalendarId"]) {
        assert.equal(secret in row, false, `${secret} must not reach the browser`);
      }
    });

    it("shows everyone by default, and separates active from disabled on request", async () => {
      const all = await dataOf<{ total: number }>(await request("GET", "/api/staff", managerToken));
      assert.equal(all.total, 4);

      const disabled = await dataOf<{ data: StaffSummary[]; total: number }>(
        await request("GET", "/api/staff?status=disabled", managerToken),
      );
      assert.equal(disabled.total, 1);
      assert.equal(disabled.data[0]?.id, "staffrt-retired");
      assert.equal(disabled.data[0]?.disabled, true);

      const active = await dataOf<{ total: number }>(
        await request("GET", "/api/staff?status=active", managerToken),
      );
      assert.equal(active.total, 3);
    });

    it("filters by role, and searches the name or the email", async () => {
      const managers = await dataOf<{ data: StaffSummary[] }>(
        await request("GET", "/api/staff?role=MANAGER", managerToken),
      );
      assert.deepEqual(
        managers.data.map((row) => row.name),
        ["Mia Manager"],
      );

      // "stylist" is in both the name and the email of one person, which is what one
      // box searching either column is for.
      const searched = await dataOf<{ data: StaffSummary[] }>(
        await request("GET", "/api/staff?search=stylist", managerToken),
      );
      assert.deepEqual(
        searched.data.map((row) => row.id),
        ["staffrt-stylist"],
      );
    });

    it("never shows another salon's staff, even to that salon's own manager", async () => {
      const page = await dataOf<{ data: StaffSummary[]; total: number }>(
        await request("GET", "/api/staff", otherTenantToken),
      );

      assert.equal(page.total, 1);
      assert.deepEqual(
        page.data.map((row) => row.id),
        ["staffrt-other"],
      );
    });

    it("404s for a person who is not in this salon", async () => {
      const foreign = await request("GET", "/api/staff/staffrt-other", managerToken);

      assert.equal(foreign.status, 404);
      assert.equal((await envelope(foreign)).code, "STAFF_NOT_FOUND");
    });
  });

  describe("POST /api/staff", () => {
    const newHire = {
      name: "Nina Newhire",
      email: `nina@${DOMAIN}`,
      password: "brand-new-pass-9",
      position: "Colourist",
      departmentIds: [HAIR],
    };

    it("refuses a staff member's token, which is the whole point of requireRole", async () => {
      const response = await request("POST", "/api/staff", stylistToken, newHire);

      assert.equal(response.status, 403);
      const body = await envelope(response);
      assert.equal(body.code, "FORBIDDEN");
      assert.match(String(body.message), /role does not permit/i);
    });

    it("refuses an anonymous caller before any of that", async () => {
      const response = await request("POST", "/api/staff", undefined, newHire);
      assert.equal(response.status, 401);
    });

    it("creates the person in the caller's salon, and never echoes a hash", async () => {
      const response = await request("POST", "/api/staff", managerToken, newHire);

      assert.equal(response.status, 201);
      const created = await dataOf<StaffSummary>(response);
      assert.equal(created.name, "Nina Newhire");
      assert.equal(created.position, "Colourist");
      // The contract's least-privileged default, applied server-side.
      assert.equal(created.globalRole, "STAFF");
      assert.equal(created.disabled, false);
      assert.deepEqual(created.departments, [{ id: HAIR, name: "Hair" }]);
      assert.equal("passwordHash" in (created as unknown as Record<string, unknown>), false);

      // The tenant comes from the token, never the body: this read is unscoped, so it
      // would happily show a row that landed in the wrong salon.
      const stored = await runAsPlatform(() =>
        prisma.user.findUnique({
          where: { id: created.id },
          select: { tenantId: true, passwordHash: true },
        }),
      );
      assert.equal(stored?.tenantId, TENANTS.a);
      assert.notEqual(stored?.passwordHash, newHire.password);

      // The new account can sign in, which is the only proof the hash is usable.
      const token = await tokenFor(newHire.email, newHire.password);
      assert.equal((await request("GET", "/api/auth/me", token)).status, 200);
    });

    it("409s on an email this salon already uses, naming the field", async () => {
      const response = await request("POST", "/api/staff", managerToken, {
        ...newHire,
        email: `stylist@${DOMAIN}`,
      });

      const body = await envelope(response);
      assert.equal(response.status, 409);
      assert.equal(body.code, "EMAIL_TAKEN");
      assert.deepEqual(fieldPaths(body), ["body.email"]);
    });

    it("409s on an email another salon uses, which the scoped read cannot see", async () => {
      const response = await request("POST", "/api/staff", managerToken, {
        ...newHire,
        email: `other@${DOMAIN}`,
      });

      // `users.email` is unique globally, so this is a real collision the tenant
      // scope hides — and it must arrive as the same 409, on the same field.
      const body = await envelope(response);
      assert.equal(response.status, 409);
      assert.equal(body.code, "EMAIL_TAKEN");
      assert.deepEqual(fieldPaths(body), ["body.email"]);
    });

    it("422s on a branch that belongs to another salon", async () => {
      const response = await request("POST", "/api/staff", managerToken, {
        ...newHire,
        email: `newbranch@${DOMAIN}`,
        departmentIds: [NAILS],
      });

      const body = await envelope(response);
      assert.equal(response.status, 422);
      assert.deepEqual(fieldPaths(body), ["body.departmentIds"]);
    });

    it("422s when neither an email login nor a POS PIN is provided", async () => {
      const response = await request("POST", "/api/staff", managerToken, {
        name: "No Login",
        position: "Colourist",
      });

      const body = await envelope(response);
      assert.equal(response.status, 422);
      assert.deepEqual(fieldPaths(body), ["body.posPin"]);
    });
  });

  describe("PATCH /api/staff/:id", () => {
    it("refuses a staff member's token, so a stylist cannot edit the team", async () => {
      const response = await request("PATCH", "/api/staff/staffrt-stylist", stylistToken, {
        position: "Colourist",
      });

      assert.equal(response.status, 403);
      assert.equal((await envelope(response)).code, "FORBIDDEN");
    });

    it("changes only what was sent, and clears what was sent as null", async () => {
      const response = await request("PATCH", "/api/staff/staffrt-stylist", managerToken, {
        position: "Colourist",
        phone: null,
      });

      assert.equal(response.status, 200);
      const updated = await dataOf<StaffSummary>(response);
      assert.equal(updated.position, "Colourist");
      assert.equal(updated.phone, null);
      // Absent fields are untouched — the name and the branch link survive a partial
      // update, which is the whole reason the contract distinguishes absent from null.
      assert.equal(updated.name, "Sam Stylist");
      assert.deepEqual(updated.departments, [{ id: HAIR, name: "Hair" }]);
    });

    it("replaces the branch links, and an empty array clears them", async () => {
      const cleared = await dataOf<StaffSummary>(
        await request("PATCH", "/api/staff/staffrt-stylist", managerToken, { departmentIds: [] }),
      );

      assert.deepEqual(cleared.departments, []);
    });

    it("disables without deleting, and the disabled login is refused at once", async () => {
      const disabled = await dataOf<StaffSummary>(
        await request("PATCH", "/api/staff/staffrt-stylist", managerToken, { disabled: true }),
      );
      assert.equal(disabled.disabled, true);

      // The session ends because `auth` re-reads the row on every request, not
      // because anything bumped a token version (ADR 0007 is about signing out).
      const me = await request("GET", "/api/auth/me", stylistToken);
      assert.equal(me.status, 401);
      assert.equal((await envelope(me)).code, "SESSION_INVALIDATED");

      // Not a delete: the person's history is the reason `disabled` exists, and this
      // is the archive the Phase 4 criterion asks for on this screen.
      const signIn = await request("POST", "/api/auth/login", undefined, {
        email: `stylist@${DOMAIN}`,
        password: PASSWORD,
      });
      assert.equal(signIn.status, 401);
    });

    it("does not touch another salon's staff", async () => {
      const response = await request("PATCH", "/api/staff/staffrt-other", managerToken, {
        position: "Nope",
      });

      assert.equal(response.status, 404);
      assert.equal((await envelope(response)).code, "STAFF_NOT_FOUND");
    });

    it("404s for an id that does not exist", async () => {
      const response = await request("PATCH", "/api/staff/staffrt-missing", managerToken, {
        name: "Ghost",
      });

      assert.equal(response.status, 404);
    });
  });
});
