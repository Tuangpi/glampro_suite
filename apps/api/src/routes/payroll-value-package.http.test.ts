import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { signAccessToken } from "../lib/tokens.js";
import { salesRouter } from "./sales.routes.js";
import { customersRouter } from "./customers.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import type { GlobalRole } from "@glampro_suite/shared";

const restorers: (() => void)[] = [];
// Prisma delegates expose callable methods through a proxy, not own descriptors.
function replaceMethod<T extends object>(target: T, name: keyof T, implementation: unknown) {
  const original = target[name];
  Reflect.set(target, name, implementation);
  restorers.push(() => {
    Reflect.set(target, name, original);
  });
}

// Real HTTP/auth/route middleware; all persistence seams are replaced before listening.
const app = express();
app.use(express.json());
app.use("/sales", salesRouter);
app.use("/customers", customersRouter);
app.use(errorHandler);
let server: ReturnType<typeof app.listen>;
let base: string;
let role: GlobalRole;
let disabled: boolean;
let twoFactorEnabled: boolean;
let grantExpired: boolean;
let status: "ACTIVE" | "SUSPENDED";
let packages: boolean;
let outletStatus: "ACTIVE" | "SUSPENDED";
let transactions: number;
let writes: unknown[];
let requests: unknown[];
let transactionScope: ReturnType<typeof currentScope>;
const input = {
  idempotencyKey: "http-value-refund",
  expectedUpdatedAt: "2026-10-28T00:00:00.000Z",
  reason: "Cancel unused credit without payout",
  adminFeeNetCents: "0",
  payoutGrossCents: "0",
  payoutMethod: "NONE",
};
const decimal = (value: string) => new Prisma.Decimal(value);
const token = (overrides: Partial<Parameters<typeof signAccessToken>[0]> = {}) =>
  signAccessToken({
    id: "actor",
    email: "synthetic@example.invalid",
    globalRole: "SUPER_ADMIN",
    realm: "web",
    tenantId: "tenant-a",
    tokenVersion: 1,
    ...overrides,
  }).token;
const readPath = "/customers/customer-a/prepaid/holding-a/payroll";
const writePath = "/sales/value-package-holdings/holding-a/refund";

before(() => {
  replaceMethod(prisma.user, "findUnique", async () => ({
    id: "actor",
    tenantId: "tenant-a",
    email: "synthetic@example.invalid",
    name: "Actor",
    globalRole: role,
    tokenVersion: 1,
    disabled,
    twoFactorEnabled,
  }));
  replaceMethod(prisma.tenant, "findUnique", async () => ({
    id: "tenant-a",
    name: "Synthetic",
    slug: "synthetic",
    status,
    subscriptions: [{ endDate: new Date("2099-01-01") }],
  }));
  replaceMethod(prisma.module, "findMany", async () => [
    { code: "sales", isCore: true },
    { code: "customers", isCore: true },
    { code: "packages", isCore: false },
  ]);
  replaceMethod(prisma.tenantModule, "findMany", async () => {
    assert.equal(currentScope()?.kind, "tenant");
    return packages
      ? [{ expiresAt: grantExpired ? new Date("2000-01-01") : null, module: { code: "packages" } }]
      : [];
  });
  replaceMethod(prisma.outlet, "findFirst", async ({ where }: { where: { id: string } }) =>
    where.id === "outlet-a" ? { id: "outlet-a", status: outletStatus } : null,
  );
  replaceMethod(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => {
    transactions++;
    transactionScope = currentScope();
    const holding = {
      id: "holding-a",
      valuePackageId: "catalogue",
      saleLineId: "line",
      updatedAt: new Date(input.expectedUpdatedAt),
      amount: decimal("600"),
      amountRemaining: decimal("600"),
      payrollPurchaseSnapshot: {
        version: 1,
        saleId: "sale",
        saleLineId: "line",
        currency: "SGD",
        paidNet: "500.00",
        credit: "600.00",
        sellers: [{ staffId: "seller", share: 10000 }],
      },
    };
    return callback({
      $executeRaw: async () => 0,
      $queryRaw: async () => [],
      user: { findFirst: async () => ({ id: "actor", globalRole: role }) },
      customerValuePackageHolding: {
        findFirst: async ({ where }: { where: { id: string; customerId?: string } }) => {
          requests.push(where);
          return where.id === "holding-a" &&
            (!where.customerId || where.customerId === "customer-a")
            ? holding
            : null;
        },
        update: async (args: unknown) => {
          writes.push(args);
          return holding;
        },
      },
      sale: {
        findFirst: async () => ({
          id: "sale",
          status: "COMPLETED",
          collectionCurrency: "SGD",
          outletId: null,
          refund: null,
        }),
      },
      saleLine: {
        findFirst: async () => ({
          id: "line",
          lineTotal: decimal("545"),
          taxAmount: decimal("45"),
          voucherDiscountAmount: decimal("0"),
          attribution: { sellers: holding.payrollPurchaseSnapshot.sellers },
        }),
      },
      customerRedemption: { findMany: async () => [] },
      commissionCollectionAllocation: { findMany: async () => [] },
      payrollSourceEvent: {
        findFirst: async () => null,
        findMany: async () => [],
        create: async ({ data }: { data: unknown }) => {
          writes.push(data);
          return { id: "refund", evidence: data };
        },
      },
      customerOutstanding: {
        findFirst: async () => ({ id: "debt", unpaidAmount: decimal("545") }),
        update: async (args: unknown) => {
          writes.push(args);
        },
      },
      tenant: { findUniqueOrThrow: async () => ({ timeZone: "Asia/Singapore" }) },
    });
  });
  server = app.listen(0, "127.0.0.1");
  return new Promise<void>((resolve) =>
    server.once("listening", () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    }),
  );
});
after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  for (const restore of restorers.reverse()) restore();
});
beforeEach(() => {
  role = "MANAGER";
  twoFactorEnabled = true;
  grantExpired = false;
  disabled = false;
  status = "ACTIVE";
  packages = true;
  outletStatus = "ACTIVE";
  transactions = 0;
  writes = [];
  requests = [];
  transactionScope = undefined;
});
async function request(
  path: string,
  body?: unknown,
  bearer: string | null = token(),
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

test("detail route reads customer-bound evidence under token tenant and actor scope", async () => {
  const response = await request(readPath);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.purchase.paidNet, "500.00");
  assert.deepEqual(requests, [{ id: "holding-a", customerId: "customer-a" }]);
  assert.deepEqual(transactionScope, { kind: "tenant", tenantId: "tenant-a", actorId: "actor" });
  assert.equal(writes.length, 0);
});
test("manager records zero/NONE cancellation using real validation and service", async () => {
  const response = await request(writePath, input);
  assert.equal(response.status, 200);
  assert.equal(writes.length, 3);
  const event = writes[0] as {
    sourceType: string;
    evidence: { requestHash: string; lines: unknown[]; payoutMethod: string };
  };
  assert.equal(event.sourceType, "VALUE_PACKAGE_REFUND");
  assert.deepEqual(event.evidence.lines, []);
  assert.equal(event.evidence.payoutMethod, "NONE");
  assert.equal(
    event.evidence.requestHash,
    createHash("sha256")
      .update(JSON.stringify({ ...input, holdingId: "holding-a", actorId: "actor" }))
      .digest("hex"),
  );
});
for (const path of [readPath, writePath]) {
  const body = path === writePath ? input : undefined;
  test(`missing token refuses ${path} before persistence`, async () => {
    assert.equal((await request(path, body, null)).status, 401);
    assert.equal(transactions, 0);
  });
  test(`invalid token refuses ${path}`, async () => {
    assert.equal((await request(path, body, "not-a-token")).status, 401);
    assert.equal(transactions, 0);
  });
  test(`disabled session refuses ${path}`, async () => {
    disabled = true;
    assert.equal((await request(path, body)).status, 401);
    assert.equal(transactions, 0);
  });
  test(`revoked token refuses ${path}`, async () => {
    assert.equal((await request(path, body, token({ tokenVersion: 0 }))).status, 401);
    assert.equal(transactions, 0);
  });
  test(`expired package entitlement refuses ${path}`, async () => {
    grantExpired = true;
    const response = await request(path, body);
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "MODULE_NOT_ENTITLED");
    assert.equal(transactions, 0);
  });
  test(`invalid outlet selection refuses ${path}`, async () => {
    assert.equal((await request(path, body, token(), { "x-outlet-id": "../outlet" })).status, 422);
    assert.equal(transactions, 0);
  });
  test(`tenant claim mismatch refuses ${path}`, async () => {
    assert.equal((await request(path, body, token({ tenantId: "tenant-b" }))).status, 401);
    assert.equal(transactions, 0);
  });
  test(`platform realm cannot reach ${path}`, async () => {
    const response = await request(path, body, token({ realm: "platform" }));
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "REALM_NOT_SUPPORTED");
    assert.equal(transactions, 0);
  });
  test(`missing package entitlement refuses ${path}`, async () => {
    packages = false;
    const response = await request(path, body);
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "MODULE_NOT_ENTITLED");
    assert.equal(transactions, 0);
  });
  test(`foreign outlet refuses ${path} before transaction`, async () => {
    assert.equal(
      (await request(path, body, token(), { "x-outlet-id": "foreign-outlet" })).status,
      404,
    );
    assert.equal(transactions, 0);
  });
  test(`suspended outlet refuses ${path}`, async () => {
    outletStatus = "SUSPENDED";
    assert.equal((await request(path, body, token(), { "x-outlet-id": "outlet-a" })).status, 403);
    assert.equal(transactions, 0);
  });
}
for (const denied of ["STAFF", "CASHIER"] as const) {
  test(`${denied} reads evidence but cannot refund even with owner role in token`, async () => {
    role = denied;
    assert.equal((await request(readPath)).status, 200);
    transactions = 0;
    assert.equal((await request(writePath, input)).status, 403);
    assert.equal(transactions, 0);
    assert.equal(writes.length, 0);
  });
}
test("suspended tenant reads evidence but cannot refund", async () => {
  status = "SUSPENDED";
  assert.equal((await request(readPath)).status, 200);
  transactions = 0;
  const response = await request(writePath, input);
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "TENANT_SUSPENDED");
  assert.equal(transactions, 0);
});
test("enabled two-factor owner can refund", async () => {
  role = "SUPER_ADMIN";
  assert.equal((await request(writePath, input)).status, 200);
});
test("owner without verified two-factor session cannot refund", async () => {
  role = "SUPER_ADMIN";
  twoFactorEnabled = false;
  const response = await request(writePath, input);
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "TWO_FACTOR_REQUIRED");
  assert.equal(transactions, 0);
});
test("unknown holding refund returns 404 without writes", async () => {
  const response = await request(writePath.replace("holding-a", "foreign-holding"), input);
  assert.equal(response.status, 404);
  assert.equal(writes.length, 0);
});
test("server payout mismatch returns expected exact amount without writes", async () => {
  const response = await request(writePath, {
    ...input,
    payoutGrossCents: "1",
    payoutMethod: "CASH",
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "VALUE_PACKAGE_REFUND_PAYOUT_MISMATCH");
  assert.deepEqual(response.body.details, { expectedGrossCents: "0" });
  assert.equal(writes.length, 0);
});
test("stale holding revision returns conflict without writes", async () => {
  const response = await request(writePath, {
    ...input,
    expectedUpdatedAt: "2026-10-27T00:00:00.000Z",
  });
  assert.equal(response.status, 409);
  assert.match(response.body.message, /Holding changed/);
  assert.equal(writes.length, 0);
});
test("validated outlet propagates into service scope and spoofed tenant header is ignored", async () => {
  assert.equal(
    (
      await request(readPath, undefined, token(), {
        "x-outlet-id": "outlet-a",
        "x-tenant-id": "tenant-b",
      })
    ).status,
    200,
  );
  assert.deepEqual(transactionScope, {
    kind: "tenant",
    tenantId: "tenant-a",
    actorId: "actor",
    outletId: "outlet-a",
  });
});
test("other customer holding read returns 404 without fallback", async () => {
  assert.equal((await request(readPath.replace("customer-a", "customer-b"))).status, 404);
  assert.equal(writes.length, 0);
});
for (const patch of [
  { payoutMethod: "CASH" },
  { payoutGrossCents: "1.1" },
  { adminFeeNetCents: "-1" },
  { reason: "x" },
  { expectedUpdatedAt: "yesterday" },
  { tenantId: "tenant-b" },
  { payoutMethod: "PREPAID_CREDIT" },
])
  test(`strict refund validation refuses ${JSON.stringify(patch)}`, async () => {
    assert.equal((await request(writePath, { ...input, ...patch })).status, 422);
    assert.equal(transactions, 0);
    assert.equal(writes.length, 0);
  });
