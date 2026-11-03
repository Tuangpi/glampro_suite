import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import type { GlobalRole } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { signAccessToken } from "../lib/tokens.js";
import { payrollInputHash } from "../services/payroll-close-state.js";
import type { PayrollCloseState } from "../services/payroll-close-state.js";
import {
  approvedPayrollExportState,
  calculatedPayrollExportState,
} from "../services/payroll-export.test-helper.js";

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
let status: "ACTIVE" | "SUSPENDED";
let transactions: number;
/** Frozen close the payroll store reports for the current test, or null for none. */
let storedClose: {
  periodKey: string;
  revision: number;
  status: string;
  state: PayrollCloseState;
} | null = null;
/** Snapshots the store snapshot as approved or draft so export gating can be exercised. */
function storePayrollClose(approved: boolean) {
  const state = approved ? approvedPayrollExportState() : calculatedPayrollExportState();
  storedClose = {
    periodKey: state.periodKey,
    revision: state.revision,
    status: state.status,
    state,
  };
}
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
  return fetch(`${base}/api/payroll-close${path}`, {
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
      payrollClose: { findFirst: async () => storedClose },
      payrollCloseEvent: {
        findFirst: async () =>
          storedClose
            ? { stateHash: payrollInputHash(storedClose.state), state: storedClose.state }
            : null,
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
  status = "ACTIVE";
  transactions = 0;
  storedClose = null;
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
  const response = await fetch(`${base}/api/payroll-close/2026-09`, {
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

test("cashiers cannot read even their own payroll statement", async () => {
  role = "CASHIER";
  assert.equal((await request("/2026-09/statement")).status, 403);
  assert.equal((await request()).status, 403);
  assert.equal(transactions, 0);
});
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EXPORTS = ["workbook.xlsx", "payslips.pdf", "ledger.csv"] as const;
const exportPath = (kind: string, query = "") => `/2026-09/exports/${kind}${query}`;

test("frozen exports are owner-only and never open the payroll store for other roles", async () => {
  storePayrollClose(true);
  for (const globalRole of ["MANAGER", "STAFF", "CASHIER"] as const) {
    role = globalRole;
    for (const kind of EXPORTS)
      assert.equal((await request(exportPath(kind))).status, 403, `${globalRole} ${kind}`);
  }
  for (const kind of EXPORTS)
    assert.equal((await request(exportPath(kind), undefined, null)).status, 401, kind);
  assert.equal(transactions, 0);
});

test("exports refuse a close that is not an approved snapshot and write no file", async () => {
  storePayrollClose(false);
  for (const kind of EXPORTS) assert.equal((await request(exportPath(kind))).status, 409, kind);
  storedClose = null;
  assert.equal((await request(exportPath("workbook.xlsx"))).status, 409);
  assert.equal(transactions, 4);
});

test("approved close downloads a workbook, payslips and a filtered ledger as attachments", async () => {
  storePayrollClose(true);
  const workbook = await request(exportPath("workbook.xlsx"));
  assert.equal(workbook.status, 200);
  assert.equal(workbook.headers.get("content-type"), XLSX_TYPE);
  assert.equal(
    workbook.headers.get("content-disposition"),
    'attachment; filename="payroll-2026-09.xlsx"',
  );
  assert.equal(workbook.headers.get("cache-control"), "no-store");
  assert.equal(workbook.headers.get("x-content-type-options"), "nosniff");
  const bytes = Buffer.from(await workbook.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK");

  const payslips = await request(exportPath("payslips.pdf"));
  assert.equal(payslips.status, 200);
  assert.equal(payslips.headers.get("content-type"), "application/pdf");
  assert.equal(
    payslips.headers.get("content-disposition"),
    'attachment; filename="payroll-payslips-2026-09.pdf"',
  );
  assert.equal(
    Buffer.from(await payslips.arrayBuffer())
      .subarray(0, 5)
      .toString("latin1"),
    "%PDF-",
  );

  const ledger = await request(exportPath("ledger.csv", "?staffId=staff-a&commissionType=SVC"));
  assert.equal(ledger.status, 200);
  assert.equal(ledger.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(
    ledger.headers.get("content-disposition"),
    'attachment; filename="payroll-base-ledger-2026-09.csv"',
  );
  const ledgerBytes = Buffer.from(await ledger.arrayBuffer());
  assert.equal(
    ledgerBytes.subarray(0, 3).toString("hex"),
    "efbbbf",
    "ledger CSV keeps its UTF-8 BOM",
  );
  const csv = ledgerBytes.toString("utf8");
  assert.ok(csv.includes("line-a-1"), "matching line is exported");
  assert.ok(!csv.includes("line-a-2"), "filtered commission type is excluded");
  assert.ok(!csv.includes("line-b-1"), "filtered staff is excluded");
  assert.equal(transactions, 3);
});

test("ledger export validates filters before the store is opened", async () => {
  storePayrollClose(true);
  for (const query of [
    "?staffId=",
    "?commissionType=NOPE",
    "?status=OPEN",
    "?from=2026-09-30x",
    "?actorId=forged",
  ])
    assert.equal((await request(exportPath("ledger.csv", query))).status, 422, query);
  assert.equal(
    (await request(exportPath("ledger.csv", "?from=2026-09-30&to=2026-09-01"))).status,
    400,
    "reversed date range is a bad request",
  );
  assert.equal(transactions, 1);
});
