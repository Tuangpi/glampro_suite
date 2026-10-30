import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import type { GlobalRole } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { signAccessToken } from "../lib/tokens.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { payrollCloseRouter } from "./payroll-close.routes.js";

const restorers: (() => void)[] = [];
function replace<T extends object>(target: T, key: keyof T, value: unknown) {
  const original = target[key];
  Reflect.set(target, key, value);
  restorers.push(() => {
    Reflect.set(target, key, original);
  });
}
const app = express();
app.use(express.json());
app.use("/payroll-close", payrollCloseRouter);
app.use(errorHandler);
let server: ReturnType<typeof app.listen>;
let base: string;
let role: GlobalRole;
let enabled: boolean;
let status: "ACTIVE" | "SUSPENDED";
let transactions: number;
const token = (overrides: Partial<Parameters<typeof signAccessToken>[0]> = {}) =>
  signAccessToken({
    id: "actor",
    email: "actor@example.test",
    globalRole: role,
    realm: "web",
    tenantId: "salon",
    tokenVersion: 0,
    ...overrides,
  }).token;
async function request(path = "/2026-09", body?: unknown, bearer: string | null = token()) {
  return fetch(`${base}/payroll-close${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
before(async () => {
  replace(prisma.user, "findUnique", async () => ({
    id: "actor",
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
    status,
    subscriptions: [{ endDate: new Date("2099-01-01") }],
  }));
  replace(prisma.module, "findMany", async () => [{ code: "staff", isCore: false }]);
  replace(prisma.outlet, "findFirst", async () => ({ id: "branch", status: "ACTIVE" }));
  replace(prisma.tenantModule, "findMany", async () =>
    enabled ? [{ expiresAt: null, module: { code: "staff" } }] : [],
  );
  replace(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => {
    transactions++;
    assert.deepEqual(currentScope(), { kind: "tenant", tenantId: "salon", actorId: "actor" });
    return callback({
      $executeRaw: async () => 1,
      $queryRaw: async () => [],
      user: {
        findFirst: async () => ({
          id: "actor",
          globalRole: role,
          disabled: false,
          twoFactorEnabled: true,
        }),
      },
      payrollClose: { findFirst: async () => null },
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
  status = "ACTIVE";
  transactions = 0;
});
after(async () => {
  for (const restore of restorers.reverse()) restore();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("real auth rejects missing, platform and cross-tenant tokens before close persistence", async () => {
  assert.equal((await request("/2026-09", undefined, null)).status, 401);
  assert.equal((await request("/2026-09", undefined, token({ realm: "platform" }))).status, 403);
  assert.equal((await request("/2026-09", undefined, token({ tenantId: "foreign" }))).status, 401);
  assert.equal(transactions, 0);
});
test("module and staff permissions deny management reads and owner actions", async () => {
  enabled = false;
  assert.equal((await request()).status, 403);
  enabled = true;
  role = "STAFF";
  assert.equal((await request()).status, 403);
  for (const action of ["calculate", "approve", "payout", "opening", "settlements", "adjustments"])
    assert.equal((await request(`/2026-09/${action}`, {})).status, 403);
  role = "MANAGER";
  for (const action of ["approve", "payout", "opening", "settlements"])
    assert.equal((await request(`/2026-09/${action}`, {})).status, 403);
  assert.equal(transactions, 0);
});
test("owner and manager reads use authenticated scope and never trigger calculation", async () => {
  for (const globalRole of ["SUPER_ADMIN", "MANAGER"] as const) {
    role = globalRole;
    const response = await request();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: {
        periodKey: "2026-09",
        revision: 0,
        status: "OPEN",
        adjustments: [],
        calculation: null,
        approval: null,
        payout: null,
      },
    });
  }
  assert.equal(transactions, 2);
});
test("strict requests reject injected inputs, actor identities and invalid revisions", async () => {
  for (const body of [
    { expectedRevision: -1 },
    { expectedRevision: 0, sources: [] },
    { expectedRevision: 0, loader: "client" },
    { expectedRevision: 0, actorId: "other" },
  ])
    assert.equal((await request("/2026-09/calculate", body)).status, 422);
  assert.equal((await request("/2026-13")).status, 422);
  assert.equal(
    (
      await request("/2026-09/adjustments", {
        expectedRevision: 0,
        adjustment: {
          id: "adjustment",
          staffId: "actor",
          actorId: "forged",
          kind: "ADDITION",
          amount: "1.00",
          reason: "Testing",
        },
      })
    ).status,
    422,
  );
  assert.equal(transactions, 0);
});
test("suspended salons cannot mutate payroll", async () => {
  status = "SUSPENDED";
  assert.equal((await request("/2026-09/calculate", { expectedRevision: 0 })).status, 403);
  assert.equal(transactions, 0);
});
test("outlet-scoped close reads refuse rather than exposing salon-wide payroll", async () => {
  const response = await fetch(`${base}/payroll-close/2026-09`, {
    headers: { Authorization: `Bearer ${token()}`, "x-outlet-id": "branch" },
  });
  assert.equal(response.status, 403);
  assert.equal(transactions, 0);
});
test("own-statement reads do not expose another staff route to staff or managers", async () => {
  for (const globalRole of ["STAFF", "MANAGER"] as const) {
    role = globalRole;
    assert.equal((await request("/2026-09/statements/other")).status, 403);
    assert.equal((await request("/2026-09/statement")).status, 404);
  }
});
