import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import type { GlobalRole } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { signAccessToken } from "../lib/tokens.js";
import { payrollInputHash, type PayrollCloseState } from "../services/payroll-close-state.js";
import {
  approvedPayrollExportState,
  calculatedPayrollExportState,
} from "../services/payroll-export.test-helper.js";

/**
 * CP-006 HTTP boundaries for MTD/POS progress (FR-RPT-04, FR-POS-09) and own-data staff
 * self-service (FR-RPT-05).
 *
 * The payroll store is mocked one layer below the router, so these tests are about the
 * things only the HTTP surface can get wrong: who may call each route, which scope the
 * answer is narrowed to, and that no salary field is in the body.
 */

const restorers: (() => void)[] = [];
function replace<T extends object>(target: T, key: keyof T, value: unknown) {
  const original = target[key];
  Reflect.set(target, key, value);
  restorers.push(() => {
    Reflect.set(target, key, original);
  });
}
const app = createApp();
let server: ReturnType<typeof app.listen>;
let base: string;
let role: GlobalRole;
let enabled: boolean;
/** The authenticated actor row the store resolves its own-data scope from. */
let actorId: string;
/** Approved/draft closes the payroll store reports, newest first. */
let closes: PayrollCloseState[];
let transactions: number;

const timeZone = "Asia/Singapore";
/** The frozen fixture, re-keyed to a period so history paging has more than one month. */
function frozen(periodKey: string): PayrollCloseState {
  const state = approvedPayrollExportState();
  return { ...state, periodKey };
}

const token = (overrides: Partial<Parameters<typeof signAccessToken>[0]> = {}) =>
  signAccessToken({
    id: actorId,
    email: "actor@example.test",
    globalRole: role,
    realm: "web",
    tenantId: "salon",
    tokenVersion: 0,
    ...overrides,
  }).token;

async function request(path: string, bearer: string | null = token(), outletId?: string) {
  return fetch(`${base}/api/payroll-close${path}`, {
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(outletId ? { "x-outlet-id": outletId } : {}),
    },
  });
}

test("commission detail refuses staff and cashiers before opening a report transaction", async () => {
  for (const denied of ["STAFF", "CASHIER"] as const) {
    role = denied;
    const count = transactions;
    const response = await request("/commission-detail?period=2026-09");
    assert.equal(response.status, 403);
    assert.equal(transactions, count);
  }
});

test("commission detail validates filters and does not parse its route as a month", async () => {
  role = "MANAGER";
  assert.equal((await request("/commission-detail?period=not-a-month")).status, 422);
  assert.equal((await request("/commission-detail?period=2026-09&unknown=1")).status, 422);
});

before(async () => {
  replace(prisma.user, "findUnique", async () => ({
    id: actorId,
    tenantId: "salon",
    email: "actor@example.test",
    name: "Actor",
    globalRole: role,
    tokenVersion: 0,
    disabled: false,
    twoFactorEnabled: true,
  }));
  replace(prisma.tenant, "findUnique", async () => ({
    id: "salon",
    name: "Salon",
    slug: "salon",
    status: "ACTIVE" as const,
    timeZone,
    subscriptions: [{ endDate: new Date("2099-01-01") }],
  }));
  replace(prisma.module, "findMany", async () => [{ code: "staff", isCore: false }]);
  replace(prisma.outlet, "findFirst", async () => ({ id: "branch", status: "ACTIVE" }));
  replace(prisma.tenantModule, "findMany", async () =>
    enabled ? [{ expiresAt: null, module: { code: "staff" } }] : [],
  );
  replace(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => {
    transactions++;
    const scope = currentScope();
    assert.equal(scope?.kind, "tenant");
    const close = (periodKey: string) => closes.find((row) => row.periodKey === periodKey) ?? null;
    const stored = (state: PayrollCloseState) => ({
      periodKey: state.periodKey,
      revision: state.revision,
      status: state.status,
      state,
    });
    return callback({
      $executeRaw: async () => 1,
      $queryRaw: async () => [],
      tenant: { findUnique: async () => ({ timeZone }) },
      user: { findFirst: async () => ({ id: actorId, globalRole: role }) },
      payrollClose: {
        findFirst: async (args: { where: { periodKey: string } }) => {
          const state = close(args.where.periodKey);
          return state ? stored(state) : null;
        },
        findMany: async (args: { skip?: number; take?: number }) => {
          const page = closes.filter((state) => state.status === "APPROVED");
          const skip = args.skip ?? 0;
          return page.slice(skip, skip + (args.take ?? page.length)).map(stored);
        },
      },
      payrollCloseEvent: {
        findFirst: async (args: { where: { periodKey: string } }) => {
          const state = close(args.where.periodKey);
          return state ? { stateHash: payrollInputHash(state), state } : null;
        },
      },
      payrollPlan: {
        findMany: async (args: { where: { id: { in: string[] } } }) =>
          args.where.id.in.includes("plan") ? [{ id: "plan", name: "Service plan" }] : [],
      },
    });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  role = "SUPER_ADMIN";
  enabled = true;
  actorId = "manager";
  closes = [];
  transactions = 0;
});
after(async () => {
  for (const restore of restorers.reverse()) restore();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("anonymous, unentitled and cashier callers never reach the payroll store", async () => {
  assert.equal((await request("/progress", null)).status, 401);
  assert.equal((await request("/statements", null)).status, 401);
  enabled = false;
  assert.equal((await request("/progress")).status, 403);
  assert.equal((await request("/statements")).status, 403);
  enabled = true;
  role = "CASHIER";
  assert.equal((await request("/progress")).status, 403);
  assert.equal((await request("/statements")).status, 403);
  assert.equal(transactions, 0);
});

test("progress rejects an impossible period and an unknown query key", async () => {
  assert.equal((await request("/progress?period=2026-13")).status, 422);
  assert.equal((await request("/progress?period=2026-09&staffId=other")).status, 422);
  assert.equal((await request("/statements?limit=99")).status, 422);
  assert.equal((await request("/statements?limit=0")).status, 422);
  assert.equal(transactions, 0);
});

test("management reads the salon table and an unapproved month is labelled estimated", async () => {
  role = "MANAGER";
  closes = [calculatedPayrollExportState()];
  const response = await request("/progress?period=2026-09");
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Record<string, unknown> };
  assert.equal(body.data.scope, "SALON");
  assert.equal(body.data.basis, "ESTIMATED");
  assert.equal(body.data.estimated, true);
  assert.equal(body.data.periodKey, "2026-09");
  assert.equal((body.data.rows as unknown[]).length, 2);
  assert.deepEqual(body.data.totals, {
    staff: 2,
    lines: 3,
    baseAmount: "2400.7500",
    units: "6.0000",
    commission: "200.00",
    incentive: "50.00",
    estimate: "250.00",
  });
  // Salary never crosses this boundary, whatever the month's status.
  for (const forbidden of ["basicSalary", "takeHome", "fixedOvertime"])
    assert.equal(JSON.stringify(body).includes(forbidden), false, forbidden);
});

test("an approved month is frozen and names the plan from the salon's own table", async () => {
  closes = [frozen("2026-09")];
  const response = await request("/progress?period=2026-09");
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { basis: string; rows: { planName: string }[] } };
  assert.equal(body.data.basis, "APPROVED");
  assert.equal(body.data.rows[0]?.planName, "Service plan");
  assert.equal(body.data.rows[1]?.planName, null);
});

test("a staff member reads only their own line, never the salon table", async () => {
  role = "STAFF";
  actorId = "staff-a";
  closes = [frozen("2026-09")];
  const response = await request("/progress?period=2026-09");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { scope: string; rows: { staff: { id: string } }[]; totals: { staff: number } };
  };
  assert.equal(body.data.scope, "SELF");
  assert.deepEqual(
    body.data.rows.map((row) => row.staff.id),
    ["staff-a"],
  );
  assert.equal(body.data.totals.staff, 1);
});

test("an outlet-scoped caller is narrowed to their own line instead of a salon table", async () => {
  role = "MANAGER";
  actorId = "branch-manager";
  closes = [frozen("2026-09")];
  const response = await request("/progress?period=2026-09", token(), "branch");
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { scope: string; rows: unknown[] } };
  assert.equal(body.data.scope, "SELF");
  // The manager has no statement in this month, so the narrowed read is empty rather
  // than leaking the salon-wide figures of the two staff members who do.
  assert.deepEqual(body.data.rows, []);
});

test("an owner asking for their own line is not given someone else's", async () => {
  role = "SUPER_ADMIN";
  actorId = "owner";
  closes = [frozen("2026-09")];
  const response = await request("/progress?period=2026-09&scope=SELF");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { scope: string; rows: { staff: { id: string } }[]; totals: { staff: number } };
  };
  // The owner holds no statement, so the answer is empty rather than the two staff rows
  // a salon read returns — that table is what a "Your …" card must never show.
  assert.equal(body.data.scope, "SELF");
  assert.deepEqual(body.data.rows, []);
  assert.equal(body.data.totals.staff, 0);
});

test("a manager can ask for their own line while still being allowed the salon table", async () => {
  role = "MANAGER";
  actorId = "manager";
  closes = [frozen("2026-09")];
  const own = await request("/progress?period=2026-09&scope=SELF");
  assert.equal(own.status, 200);
  const ownBody = (await own.json()) as { data: { scope: string; rows: unknown[] } };
  assert.equal(ownBody.data.scope, "SELF");
  assert.deepEqual(ownBody.data.rows, []);
  // Without the flag the same caller still gets the salon table, so the flag narrowed.
  const salon = await request("/progress?period=2026-09");
  assert.equal(salon.status, 200);
  const salonBody = (await salon.json()) as { data: { scope: string; rows: unknown[] } };
  assert.equal(salonBody.data.scope, "SALON");
  assert.equal(salonBody.data.rows.length, 2);
});

test("the scope flag can only narrow: a salon read is refused", async () => {
  role = "MANAGER";
  closes = [frozen("2026-09")];
  assert.equal((await request("/progress?period=2026-09&scope=SALON")).status, 422);
  assert.equal((await request("/progress?period=2026-09&scope=self")).status, 422);
  assert.equal(transactions, 0);
});

test("an uncalculated month reports nothing and defaults to the salon's current month", async () => {
  const response = await request("/progress");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { periodKey: string; basis: string; rows: unknown[]; calculation: unknown };
  };
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  assert.equal(body.data.periodKey, today.slice(0, 7));
  assert.equal(body.data.basis, "NOT_CALCULATED");
  assert.equal(body.data.calculation, null);
  assert.deepEqual(body.data.rows, []);
});

test("own statement history lists the caller's frozen months newest first", async () => {
  role = "STAFF";
  actorId = "staff-b";
  closes = [frozen("2026-09"), frozen("2026-08"), calculatedPayrollExportState()];
  const response = await request("/statements");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { statements: { periodKey: string; status: string }[]; limit: number; hasMore: boolean };
  };
  assert.deepEqual(
    body.data.statements.map((row) => row.periodKey),
    ["2026-09", "2026-08"],
  );
  assert.equal(
    body.data.statements.every((row) => row.status === "APPROVED"),
    true,
  );
  assert.equal(body.data.limit, 12);
  assert.equal(body.data.hasMore, false);
  for (const forbidden of ["basicSalary", "takeHome", "staff-a"])
    assert.equal(JSON.stringify(body).includes(forbidden), false, forbidden);
});

test("own statement history honours the limit and says when more exist", async () => {
  role = "STAFF";
  actorId = "staff-a";
  closes = [frozen("2026-09"), frozen("2026-08")];
  const response = await request("/statements?limit=1");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { statements: { periodKey: string }[]; limit: number; hasMore: boolean };
  };
  assert.deepEqual(
    body.data.statements.map((row) => row.periodKey),
    ["2026-09"],
  );
  assert.equal(body.data.limit, 1);
  assert.equal(body.data.hasMore, true);
});

test("a caller with no frozen statement gets an empty history, not someone else's", async () => {
  role = "MANAGER";
  actorId = "manager";
  closes = [frozen("2026-09")];
  const response = await request("/statements");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()) as unknown, {
    data: { statements: [], limit: 12, hasMore: false },
  });
});
