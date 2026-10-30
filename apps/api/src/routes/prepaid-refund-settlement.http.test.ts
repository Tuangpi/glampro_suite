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
import { errorHandler } from "../middleware/errorHandler.js";
import { payrollInputHash } from "../services/payroll-close-state.js";
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

type SettlementRow = {
  tenantId: string;
  sourceKey: string;
  holdingId: string;
  itemType: "PACKAGE" | "VALUE_PACKAGE";
  saleId: string;
  saleLineId: string;
  actorId: string;
  actorRole: string;
  reason: string;
  reference: string;
  requestHash: string;
  currency: string;
  payoutMethod: string;
  netCents: bigint;
  taxCents: bigint;
  grossCents: bigint;
  cancelledGrossCents: bigint;
  occurredAt: Date;
  evidence: {
    version: number;
    request: Record<string, unknown>;
    operational: Record<string, unknown>;
    operationalHash: string;
  };
};
type EventRow = {
  id: string;
  sourceKey: string;
  sourceType: string;
  sourceId?: string;
  evidence: unknown;
};

// Real HTTP/auth/route/service wiring; both persistence seams below are replaced before listening.
const app = express();
app.use(express.json());
app.use("/sales", salesRouter);
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
let settlements: SettlementRow[];
let events: EventRow[];
let transactionScope: ReturnType<typeof currentScope>;
const input = {
  idempotencyKey: "http-prepaid-settlement",
  expectedUpdatedAt: "2026-10-28T00:00:00.000Z",
  reason: "Cancel unused credit against a confirmed voucher",
  adminFeeNetCents: "0",
  payoutGrossCents: "0",
  payoutMethod: "NONE" as const,
  settlement: { confirmed: true as const, reference: "cash-voucher-001" },
};
const writePath = "/sales/value-package-holdings/holding-a/refund";
const decimal = (value: string) => new Prisma.Decimal(value);
const requestHash = (body: Record<string, unknown>) =>
  createHash("sha256")
    .update(JSON.stringify({ ...body, holdingId: "holding-a", actorId: "actor" }))
    .digest("hex");
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

function transaction() {
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
  return {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    user: {
      findFirst: async () => ({ id: "actor", globalRole: role, twoFactorEnabled }),
    },
    customerValuePackageHolding: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id === "holding-a" ? holding : null,
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
      findFirst: async ({ where }: { where: { sourceKey?: string; sourceId?: string } }) =>
        where.sourceKey
          ? (events.find((row) => row.sourceKey === where.sourceKey) ?? null)
          : (events.find((row) => row.sourceId === where.sourceId) ?? null),
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `event-${events.length + 1}`, ...data } as EventRow;
        events.push(row);
        return row;
      },
    },
    customerOutstanding: {
      findFirst: async () => ({ id: "debt", unpaidAmount: decimal("545") }),
      update: async (args: unknown) => {
        writes.push(args);
      },
    },
    tenant: { findUniqueOrThrow: async () => ({ timeZone: "Asia/Singapore" }) },
    prepaidRefundSettlement: {
      create: async ({ data }: { data: SettlementRow }) => {
        settlements.push(data);
        return data;
      },
      findFirst: async ({ where }: { where: { tenantId: string; sourceKey: string } }) =>
        settlements.find(
          (row) => row.tenantId === where.tenantId && row.sourceKey === where.sourceKey,
        ) ?? null,
    },
  };
}

test("manager-confirmed prepaid refund freezes one settlement journal row over HTTP", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(settlements.length, 1);
  const row = settlements[0];
  assert.equal(row.tenantId, "tenant-a");
  assert.equal(row.sourceKey, "value-package-refund:http-prepaid-settlement");
  assert.equal(row.holdingId, "holding-a");
  assert.equal(row.itemType, "VALUE_PACKAGE");
  assert.equal(row.saleId, "sale");
  assert.equal(row.saleLineId, "line");
  assert.equal(row.actorId, "actor");
  assert.equal(row.actorRole, "MANAGER");
  assert.equal(row.reason, input.reason);
  assert.equal(row.reference, "cash-voucher-001");
  assert.equal(row.requestHash, requestHash(input));
  assert.equal(row.currency, "SGD");
  assert.equal(row.payoutMethod, "NONE");
  assert.equal(row.netCents, 0n);
  assert.equal(row.taxCents, 0n);
  assert.equal(row.grossCents, 0n);
  assert.equal(row.cancelledGrossCents, 54500n);
  assert.equal(row.occurredAt instanceof Date, true);
  assert.equal(row.evidence.version, 1);
  assert.deepEqual(row.evidence.request, input);
  assert.equal(row.evidence.operationalHash, payrollInputHash(row.evidence.operational));
  assert.equal(events.length, 1);
  assert.equal(events[0].sourceType, "VALUE_PACKAGE_REFUND");
  assert.equal(events[0].sourceKey, "value-package-refund:http-prepaid-settlement");
});

test("settlement journal keeps the authenticated salon-wide transaction scope", async () => {
  assert.equal((await request()).status, 200);
  assert.deepEqual(transactionScope, { kind: "tenant", tenantId: "tenant-a", actorId: "actor" });
  assert.equal(settlements[0].actorId, transactionScope?.actorId);
});

test("identical retry replays the frozen journal and never settles twice", async () => {
  const first = await request();
  const eventsAfterFirst = events.length;
  const writesAfterFirst = writes.length;
  const second = await request();
  assert.equal(second.status, 200);
  assert.equal(second.body.data?.id, first.body.data?.id);
  assert.equal(settlements.length, 1);
  assert.equal(events.length, eventsAfterFirst);
  assert.equal(writes.length, writesAfterFirst);
});

test("retry with a changed confirmation reference is refused without a second row", async () => {
  assert.equal((await request()).status, 200);
  const retry = await request({
    ...input,
    settlement: { confirmed: true, reference: "cash-voucher-002" },
  });
  assert.equal(retry.status, 409);
  assert.equal(settlements.length, 1);
  assert.equal(events.length, 1);
});

test("retry fails closed when the frozen journal reference was altered", async () => {
  assert.equal((await request()).status, 200);
  settlements[0].reference = "altered-voucher";
  const retry = await request();
  assert.equal(retry.status, 409);
  assert.match(retry.body.message ?? "", /unavailable/);
  assert.equal(settlements.length, 1);
});

test("retry fails closed when frozen settlement money evidence was altered", async () => {
  assert.equal((await request()).status, 200);
  settlements[0].grossCents = 1n;
  settlements[0].evidence.operational.amounts = { net: "1", tax: "0" };
  const retry = await request();
  assert.equal(retry.status, 409);
  assert.equal(settlements.length, 1);
});

test("outlet-scoped session cannot record a salon-wide prepaid settlement", async () => {
  const response = await request(input, token(), { "x-outlet-id": "outlet-a" });
  assert.equal(response.status, 403);
  assert.match(response.body.message ?? "", /salon-wide/);
  assert.equal(settlements.length, 0);
  assert.equal(events.length, 0);
});

for (const denied of ["STAFF", "CASHIER"] as const) {
  test(`${denied} cannot confirm a prepaid settlement`, async () => {
    role = denied;
    assert.equal((await request()).status, 403);
    assert.equal(transactions, 0);
    assert.equal(settlements.length, 0);
  });
}

test("refund without confirmation stays a legacy capture and creates no journal row", async () => {
  const { settlement: _omitted, ...legacy } = input;
  const response = await request(legacy);
  assert.equal(response.status, 200);
  assert.equal(settlements.length, 0);
  assert.equal(events.length, 1);
});

test("confirmation cannot be added after a legacy capture", async () => {
  const { settlement: _omitted, ...legacy } = input;
  assert.equal((await request(legacy)).status, 200);
  const retry = await request();
  assert.equal(retry.status, 409);
  assert.equal(settlements.length, 0);
  assert.equal(events.length, 1);
});

test("disabled session and foreign outlet are refused before settlement persistence", async () => {
  disabled = true;
  assert.equal((await request()).status, 401);
  assert.equal(settlements.length, 0);
  disabled = false;
  const foreign = await request(input, token(), { "x-outlet-id": "foreign-outlet" });
  assert.equal(foreign.status, 404);
  assert.equal(settlements.length, 0);
  assert.equal(transactions, 0);
});

for (const patch of [{ settlement: { confirmed: true, reference: "ab" } }, { settlement: true }])
  test(`strict validation refuses ${JSON.stringify(patch)}`, async () => {
    assert.equal((await request({ ...input, ...patch })).status, 422);
    assert.equal(transactions, 0);
    assert.equal(settlements.length, 0);
  });

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
    return callback(transaction());
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
  settlements = [];
  events = [];
  transactionScope = undefined;
});
async function request(
  body: unknown = input,
  bearer: string | null = token(),
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${base}${writePath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as {
      data?: EventRow;
      code?: string;
      message?: string;
    },
  };
}
