// Static, so the `DATABASE_URL` gate below reads `.env` instead of skipping silently
// (the reason the suite used to vanish from `npm run verify` — see `auth.routes.test.ts`).
import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { CORE_MODULE_CODES, MODULE_CODES, type ShiftSummary } from "@glampro_suite/shared";

/**
 * Integration tests for the rota endpoints — `/api/shifts`.
 *
 * Three claims are asserted here because none can be checked any other way:
 *
 * 1. **`requireRole` has a caller for this router too.** A `STAFF` token that
 *    POSTs a shift onto itself must be refused — otherwise "only a manager
 *    publishes the rota" is a comment, not a rule. The same token must still be
 *    able to **read**: knowing your own hours is not a management action.
 * 2. **The tenant scope reaches `StaffShift`**, so a shift created in salon A is
 *    invisible to salon B *and* naming a performer of salon B when creating in
 *    salon A is a 404 rather than a cross-tenant row (AGENTS.md rule 1).
 * 3. **The window filter and the break containment are real.** `?on=` decides a
 *    row by its `effectiveFrom`/`effectiveTo` and a `BREAK` outside a `WORK` row
 *    is refused at write time — both are logic, not schema, so only a test can
 *    fail them.
 *
 * Gated on `DATABASE_URL`, like `staff.routes.test.ts`: the suite creates two
 * tenants, signs in for real, and removes everything it made.
 */
const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "shift-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");
const { hashPassword } = await import("../lib/password.js");

const PASSWORD = "correct-horse-1";
const DOMAIN = "shifts-rt.test";

const TENANTS = { a: "shiftsrt-tenant-a", b: "shiftsrt-tenant-b" } as const;
const TENANT_IDS = Object.values(TENANTS);

const STYLIST = "shiftsrt-stylist";
const OTHER = "shiftsrt-other";

/** Seeded rota rows, referenced by id so PATCH assertions need no list read first. */
const SHIFTS = {
  monday: "shiftsrt-mon",
  tuesday: "shiftsrt-tue",
  break: "shiftsrt-tue-break",
  windowed: "shiftsrt-nov",
  other: "shiftsrt-other-mon",
} as const;

const USERS = [
  {
    id: "shiftsrt-manager",
    tenantId: TENANTS.a,
    email: `manager@${DOMAIN}`,
    name: "Mia Manager",
    globalRole: "MANAGER" as const,
    position: "Salon manager",
  },
  {
    id: STYLIST,
    tenantId: TENANTS.a,
    email: `stylist@${DOMAIN}`,
    name: "Sam Stylist",
    globalRole: "STAFF" as const,
    position: "Senior Stylist",
  },
  {
    id: OTHER,
    tenantId: TENANTS.b,
    email: `other@${DOMAIN}`,
    name: "Otto Other",
    globalRole: "MANAGER" as const,
  },
];

/** Removes everything this file created, so runs are repeatable. */
async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.staffShift.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
  });
}

/**
 * Two salons and a five-row rota: Mon–Fri work for the stylist, a lunch break
 * inside Tuesday, and a Friday row that only applies during November 2026 —
 * which is the row `?on=` has to know about.
 */
async function seed(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);

  await runAsPlatform(async () => {
    await prisma.tenant.create({
      data: { id: TENANTS.a, name: "Shifts RT A", slug: "shiftsrt-a" },
    });
    await prisma.tenant.create({
      data: { id: TENANTS.b, name: "Shifts RT B", slug: "shiftsrt-b" },
    });

    for (const user of USERS) {
      await prisma.user.create({ data: { ...user, passwordHash } });
    }

    const work = {
      kind: "WORK" as const,
      startsAtMinute: 9 * 60,
      endsAtMinute: 18 * 60,
    };

    await prisma.staffShift.create({
      data: { id: SHIFTS.monday, tenantId: TENANTS.a, userId: STYLIST, dayOfWeek: 1, ...work },
    });
    await prisma.staffShift.create({
      data: { id: SHIFTS.tuesday, tenantId: TENANTS.a, userId: STYLIST, dayOfWeek: 2, ...work },
    });
    // Inside Tuesday's shift — `assertBreakInsideShift` must accept this one.
    await prisma.staffShift.create({
      data: {
        id: SHIFTS.break,
        tenantId: TENANTS.a,
        userId: STYLIST,
        dayOfWeek: 2,
        kind: "BREAK",
        startsAtMinute: 12 * 60,
        endsAtMinute: 13 * 60,
      },
    });
    await prisma.staffShift.create({
      data: {
        id: SHIFTS.windowed,
        tenantId: TENANTS.a,
        userId: STYLIST,
        dayOfWeek: 5,
        kind: "WORK",
        startsAtMinute: 10 * 60,
        endsAtMinute: 16 * 60,
        effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-11-30T00:00:00.000Z"),
      },
    });
    // Salon B's own Monday, which no salon-A token may ever see.
    await prisma.staffShift.create({
      data: { id: SHIFTS.other, tenantId: TENANTS.b, userId: OTHER, dayOfWeek: 1, ...work },
    });

    // `requireModule("staff")` refuses an unknown module loudly, so the catalogue
    // has to exist. `isCore` comes from the shared constant, exactly as the seed does.
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

/** The fields a 400 or a 422 named, for the assertions that care where the error went. */
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

describe("shift endpoints", { skip: databaseUrl ? false : "DATABASE_URL is not set" }, () => {
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
    if (databaseUrl) await purge();
  });

  describe("GET /api/shifts", () => {
    it("enforces salon-local work and breaks, leaving no-roster staff unrestricted", async () => {
      const { assertStaffAvailable } = await import("../services/staff-availability.service.js");
      const { runAsTenant } = await import("../lib/tenant-context.js");
      const tenant = await runAsPlatform(() =>
        prisma.tenant.findUniqueOrThrow({ where: { id: TENANTS.a } }),
      );
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: TENANTS.a }, data: { timeZone: "Asia/Singapore" } }),
      );
      try {
        await runAsTenant(TENANTS.a, async () => {
          await assertStaffAvailable(
            STYLIST,
            new Date("2026-10-20T01:00:00Z"),
            new Date("2026-10-20T04:00:00Z"),
          );
          await assert.rejects(
            assertStaffAvailable(
              STYLIST,
              new Date("2026-10-20T04:00:00Z"),
              new Date("2026-10-20T05:00:00Z"),
            ),
            (error: unknown) =>
              error instanceof Error && "code" in error && error.code === "STAFF_UNAVAILABLE",
          );
          await assert.rejects(
            assertStaffAvailable(
              STYLIST,
              new Date("2026-10-20T00:00:00Z"),
              new Date("2026-10-20T01:00:00Z"),
            ),
          );
          await assert.rejects(
            assertStaffAvailable(
              STYLIST,
              new Date("2026-10-21T01:00:00Z"),
              new Date("2026-10-21T02:00:00Z"),
            ),
          );
          await assert.rejects(
            assertStaffAvailable(
              STYLIST,
              new Date("2026-10-23T02:00:00Z"),
              new Date("2026-10-23T03:00:00Z"),
            ),
          );
          await assertStaffAvailable(
            STYLIST,
            new Date("2026-11-06T02:00:00Z"),
            new Date("2026-11-06T03:00:00Z"),
          );
          await assertStaffAvailable(
            OTHER,
            new Date("2026-10-20T00:00:00Z"),
            new Date("2026-10-20T01:00:00Z"),
          );
        });
      } finally {
        await runAsPlatform(() =>
          prisma.tenant.update({ where: { id: TENANTS.a }, data: { timeZone: tenant.timeZone } }),
        );
      }
    });
    it("reads every day of the week down the page in order, with the name denormalised", async () => {
      const page = await dataOf<{ data: ShiftSummary[]; total: number }>(
        await request("GET", "/api/shifts", managerToken),
      );

      assert.equal(page.total, 4);
      // Monday, Tuesday work, Tuesday break, Friday — day first, then start. The
      // break sorts after the shift it sits inside because it starts later.
      assert.deepEqual(
        page.data.map((row) => row.id),
        [SHIFTS.monday, SHIFTS.tuesday, SHIFTS.break, SHIFTS.windowed],
      );
      assert.equal(page.data[0]?.userName, "Sam Stylist");
    });

    it("is readable by the stylist it belongs to — hours are not a management secret", async () => {
      const page = await dataOf<{ total: number }>(
        await request("GET", "/api/shifts", stylistToken),
      );

      assert.equal(page.total, 4);
    });

    it("never shows another salon's rota", async () => {
      const page = await dataOf<{ data: ShiftSummary[]; total: number }>(
        await request("GET", "/api/shifts", otherTenantToken),
      );

      assert.equal(page.total, 1);
      assert.deepEqual(
        page.data.map((row) => row.id),
        [SHIFTS.other],
      );
    });

    it("filters by performer, weekday and kind", async () => {
      const breaks = await dataOf<{ data: ShiftSummary[] }>(
        await request("GET", "/api/shifts?kind=BREAK", managerToken),
      );
      assert.deepEqual(
        breaks.data.map((row) => row.id),
        [SHIFTS.break],
      );

      const saturdays = await dataOf<{ total: number }>(
        await request("GET", "/api/shifts?dayOfWeek=6", managerToken),
      );
      assert.equal(saturdays.total, 0);

      const nobody = await dataOf<{ total: number }>(
        await request("GET", `/api/shifts?userId=shiftsrt-nobody`, managerToken),
      );
      assert.equal(nobody.total, 0);
    });

    it("applies ?on= inclusively at both ends of the effective window", async () => {
      // 2026-11-06 is inside the window; 2026-10-14 and 2026-12-04 are before and after.
      const inside = await dataOf<{ data: ShiftSummary[] }>(
        await request("GET", "/api/shifts?on=2026-11-06", managerToken),
      );
      assert.ok(inside.data.some((row) => row.id === SHIFTS.windowed));

      const edges = await dataOf<{ data: ShiftSummary[] }>(
        await request("GET", "/api/shifts?on=2026-11-01", managerToken),
      );
      assert.ok(edges.data.some((row) => row.id === SHIFTS.windowed));

      for (const outside of ["2026-10-14", "2026-12-04"]) {
        const page = await dataOf<{ data: ShiftSummary[] }>(
          await request(`GET`, `/api/shifts?on=${outside}`, managerToken),
        );
        assert.ok(
          !page.data.some((row) => row.id === SHIFTS.windowed),
          `the November rota must not show on ${outside}`,
        );
      }

      // Rows with no window at all apply on any date — `null` means "always".
      const always = await dataOf<{ data: ShiftSummary[] }>(
        await request("GET", "/api/shifts?on=2030-01-07", managerToken),
      );
      assert.deepEqual(
        always.data.map((row) => row.id),
        [SHIFTS.monday, SHIFTS.tuesday, SHIFTS.break],
      );
    });
  });

  describe("POST /api/shifts", () => {
    const thursday = {
      userId: STYLIST,
      dayOfWeek: 4,
      startsAtMinute: 9 * 60,
      endsAtMinute: 17 * 60,
    };

    it("refuses a staff member's token — publishing the rota is a manager's action", async () => {
      const response = await request("POST", "/api/shifts", stylistToken, thursday);

      assert.equal(response.status, 403);
      const body = await envelope(response);
      assert.equal(body.code, "FORBIDDEN");
      assert.match(String(body.message), /role does not permit/i);
    });

    it("publishes a shift and lands it in the caller's own salon", async () => {
      const response = await request("POST", "/api/shifts", managerToken, thursday);

      assert.equal(response.status, 201);
      const shift = await dataOf<ShiftSummary>(response);
      assert.equal(shift.userId, STYLIST);
      assert.equal(shift.userName, "Sam Stylist");
      assert.equal(shift.startsAtMinute, 540);
      assert.equal(shift.effectiveFrom, null);

      // Salon B must not acquire Thursday's row with it (AGENTS.md rule 1).
      const theirs = await dataOf<{ data: ShiftSummary[]; total: number }>(
        await request("GET", "/api/shifts?dayOfWeek=4", otherTenantToken),
      );
      assert.equal(theirs.total, 0);
    });

    it("refuses a performer from another salon rather than cross-tenanting a row", async () => {
      const response = await request("POST", "/api/shifts", managerToken, {
        ...thursday,
        userId: OTHER,
      });

      assert.equal(response.status, 404);
      assert.equal((await envelope(response)).code, "STAFF_NOT_FOUND");
    });

    it("422s a shift that would cross midnight", async () => {
      const response = await request("POST", "/api/shifts", managerToken, {
        userId: STYLIST,
        dayOfWeek: 4,
        startsAtMinute: 22 * 60,
        endsAtMinute: 2 * 60,
      });

      assert.equal(response.status, 422);
      assert.deepEqual(fieldPaths(await envelope(response)), ["body.endsAtMinute"]);
    });

    it("refuses a break that does not sit inside a work shift of the same day", async () => {
      // No work row at all on Saturday, so a break there hangs outside everything.
      const nowhere = await request("POST", "/api/shifts", managerToken, {
        userId: STYLIST,
        dayOfWeek: 6,
        kind: "BREAK",
        startsAtMinute: 12 * 60,
        endsAtMinute: 13 * 60,
      });
      assert.equal(nowhere.status, 400);
      assert.equal((await envelope(nowhere)).code, "BREAK_OUTSIDE_SHIFT");
    });

    it("accepts a break inside a shift, then refuses to shrink the shift out from under it", async () => {
      const good = await request("POST", "/api/shifts", managerToken, {
        userId: STYLIST,
        dayOfWeek: 4,
        kind: "BREAK",
        startsAtMinute: 12 * 60,
        endsAtMinute: 13 * 60,
      });
      assert.equal(good.status, 201);

      // Thursday's own row is the one POST above created; look it up rather than
      // guessing an auto-generated id.
      const thursdays = await dataOf<{ data: ShiftSummary[] }>(
        await request("GET", "/api/shifts?dayOfWeek=4&kind=WORK", managerToken),
      );
      const thursday = thursdays.data[0];
      assert.ok(thursday);

      // The merged view is re-checked on PATCH, not just the field that changed:
      // ending Thursday's shift at 10:00 leaves the 12:00 break stranded.
      const shrunk = await request("PATCH", `/api/shifts/${thursday.id}`, managerToken, {
        endsAtMinute: 10 * 60,
      });
      assert.equal(shrunk.status, 400);
      assert.equal((await envelope(shrunk)).code, "BREAK_OUTSIDE_SHIFT");
    });
  });

  describe("GET /api/shifts/:id and PATCH /api/shifts/:id", () => {
    it("rejects a reversed merged time window without changing the row", async () => {
      const response = await request("PATCH", `/api/shifts/${SHIFTS.monday}`, managerToken, {
        endsAtMinute: 1,
      });
      assert.equal(response.status, 400);
      assert.equal((await envelope(response)).code, "INVALID_SHIFT_WINDOW");
      const row = await dataOf<ShiftSummary>(
        await request("GET", `/api/shifts/${SHIFTS.monday}`, managerToken),
      );
      assert.ok(row.endsAtMinute > row.startsAtMinute);
    });

    it("rejects reversed merged effective dates", async () => {
      const response = await request("PATCH", `/api/shifts/${SHIFTS.windowed}`, managerToken, {
        effectiveTo: "2026-10-31",
      });
      assert.equal(response.status, 400);
      assert.equal((await envelope(response)).code, "INVALID_SHIFT_WINDOW");
    });

    it("refuses a break whose effective dates outlive its covering work", async () => {
      const response = await request("POST", "/api/shifts", managerToken, {
        userId: STYLIST,
        dayOfWeek: 6,
        startsAtMinute: 600,
        endsAtMinute: 660,
        kind: "WORK",
        effectiveFrom: "2026-11-01",
        effectiveTo: "2026-11-30",
      });
      assert.equal(response.status, 201);
      const invalid = await request("POST", "/api/shifts", managerToken, {
        userId: STYLIST,
        dayOfWeek: 6,
        startsAtMinute: 610,
        endsAtMinute: 620,
        kind: "BREAK",
      });
      assert.equal(invalid.status, 400);
      assert.equal((await envelope(invalid)).code, "BREAK_OUTSIDE_SHIFT");
      const valid = await request("POST", "/api/shifts", managerToken, {
        userId: STYLIST,
        dayOfWeek: 6,
        startsAtMinute: 610,
        endsAtMinute: 620,
        kind: "BREAK",
        effectiveFrom: "2026-11-01",
        effectiveTo: "2026-11-30",
      });
      assert.equal(valid.status, 201);
      const work = await dataOf<ShiftSummary>(response);
      const shortened = await request("PATCH", `/api/shifts/${work.id}`, managerToken, {
        effectiveTo: "2026-11-15",
      });
      assert.equal(shortened.status, 400);
      assert.equal((await envelope(shortened)).code, "BREAK_OUTSIDE_SHIFT");
    });

    it("404s for another salon's row, so ids are not guessable across tenants", async () => {
      const response = await request("GET", `/api/shifts/${SHIFTS.other}`, managerToken);

      assert.equal(response.status, 404);
      assert.equal((await envelope(response)).code, "SHIFT_NOT_FOUND");
    });

    it("returns one row with its window, readable by the stylist it belongs to", async () => {
      const response = await request("GET", `/api/shifts/${SHIFTS.windowed}`, stylistToken);

      assert.equal(response.status, 200);
      const shift = await dataOf<ShiftSummary>(response);
      assert.equal(shift.effectiveFrom, "2026-11-01");
      assert.equal(shift.effectiveTo, "2026-11-30");
      assert.equal(shift.kind, "WORK");
    });

    it("refuses a staff member's edit", async () => {
      const response = await request("PATCH", `/api/shifts/${SHIFTS.monday}`, stylistToken, {
        startsAtMinute: 600,
      });

      assert.equal(response.status, 403);
      assert.equal((await envelope(response)).code, "FORBIDDEN");
    });

    it("changes only what was sent, and clears what was sent as null", async () => {
      const response = await request("PATCH", `/api/shifts/${SHIFTS.windowed}`, managerToken, {
        note: "November hours",
        effectiveTo: null,
      });

      assert.equal(response.status, 200);
      const updated = await dataOf<ShiftSummary>(response);
      assert.equal(updated.note, "November hours");
      assert.equal(updated.effectiveTo, null);
      // Absent fields survive a partial update — the same contract every editor here keeps.
      assert.equal(updated.effectiveFrom, "2026-11-01");
      assert.equal(updated.startsAtMinute, 600);
    });

    it("re-checks break containment when the shift under it moves", async () => {
      // Tuesday's break is 12:00–13:00; trimming the shift to end at 12:00 strands it.
      const response = await request("PATCH", `/api/shifts/${SHIFTS.tuesday}`, managerToken, {
        endsAtMinute: 12 * 60,
      });

      assert.equal(response.status, 400);
      assert.equal((await envelope(response)).code, "BREAK_OUTSIDE_SHIFT");
    });

    it("404s for an id that does not exist", async () => {
      const response = await request("PATCH", "/api/shifts/shiftsrt-missing", managerToken, {
        note: "Ghost",
      });

      assert.equal(response.status, 404);
    });
  });
});
